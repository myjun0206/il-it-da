import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  BASELINE_THRESHOLDS,
  WARNING_CODES,
  analyzeThresholds,
  calculateMetrics,
  classifySimilarity,
  generateThresholdPairs,
  rankThresholdCandidates,
  validateCalibrationDataset,
} from "../../scripts/rag-eval/threshold-calibration.mjs";

const BASELINE = BASELINE_THRESHOLDS;

function makeCase(overrides) {
  return {
    caseId: "case-1",
    questionId: "q-1",
    groupId: "group-1",
    partition: "calibration",
    expectedStatus: "answered",
    similarity: 0.7,
    answerCorrect: true,
    scopeSafe: true,
    ...overrides,
  };
}

describe("classifySimilarity", () => {
  test("returns insufficient for null similarity", () => {
    assert.equal(classifySimilarity(null, BASELINE), "insufficient");
  });

  test("returns insufficient for non-finite similarity", () => {
    assert.equal(classifySimilarity(Number.NaN, BASELINE), "insufficient");
    assert.equal(classifySimilarity(undefined, BASELINE), "insufficient");
  });

  test("classifies the exact 0.60/0.40 boundary correctly", () => {
    assert.equal(classifySimilarity(0.60, BASELINE), "answered");
    assert.equal(classifySimilarity(0.40, BASELINE), "cautious");
  });

  test("classifies values just below each boundary", () => {
    assert.equal(classifySimilarity(0.5999, BASELINE), "cautious");
    assert.equal(classifySimilarity(0.3999, BASELINE), "insufficient");
  });

  test("classifies a negative similarity (real API/DB contract allows down to -1) as insufficient", () => {
    assert.equal(classifySimilarity(-1, BASELINE), "insufficient");
    assert.equal(classifySimilarity(-0.2, BASELINE), "insufficient");
  });
});

describe("generateThresholdPairs", () => {
  test("only generates cautious < answered combinations", () => {
    const pairs = generateThresholdPairs({ answeredMin: 0.5, answeredMax: 0.55, cautiousMin: 0.4, cautiousMax: 0.6, step: 0.05 });
    for (const pair of pairs) {
      assert.equal(pair.cautiousThreshold < pair.answeredThreshold, true);
    }
  });

  test("always includes the 0.60/0.40 baseline even outside the requested range", () => {
    const pairs = generateThresholdPairs({ answeredMin: 0.8, answeredMax: 0.85, cautiousMin: 0.75, cautiousMax: 0.79, step: 0.01 });
    const baseline = pairs.find((pair) => pair.isBaseline);
    assert.ok(baseline);
    assert.equal(baseline.answeredThreshold, 0.60);
    assert.equal(baseline.cautiousThreshold, 0.40);
  });

  test("produces exact floating point step values without drift", () => {
    const pairs = generateThresholdPairs({ answeredMin: 0.5, answeredMax: 0.5, cautiousMin: 0.1, cautiousMax: 0.4, step: 0.1 });
    const cautiousValues = pairs.filter((pair) => !pair.isBaseline).map((pair) => pair.cautiousThreshold).sort();
    assert.deepEqual(cautiousValues, [0.1, 0.2, 0.3, 0.4]);
  });

  test("rejects an invalid range where min > max", () => {
    assert.throws(
      () => generateThresholdPairs({ answeredMin: 0.9, answeredMax: 0.5 }),
      (error) => error.code === "THRESHOLD_RANGE_MIN_GREATER_THAN_MAX",
    );
  });

  test("rejects a non-positive step", () => {
    assert.throws(
      () => generateThresholdPairs({ step: 0 }),
      (error) => error.code === "THRESHOLD_STEP_INVALID",
    );
  });

  test("rejects an out-of-bounds range", () => {
    assert.throws(
      () => generateThresholdPairs({ answeredMax: 1.5 }),
      (error) => error.code === "THRESHOLD_RANGE_OUT_OF_BOUNDS",
    );
  });
});

describe("calculateMetrics", () => {
  test("builds a correct confusion matrix", () => {
    const cases = [
      makeCase({ caseId: "a", expectedStatus: "answered", similarity: 0.9 }),
      makeCase({ caseId: "b", expectedStatus: "answered", similarity: 0.3 }),
      makeCase({ caseId: "c", expectedStatus: "cautious", similarity: 0.5 }),
      makeCase({ caseId: "d", expectedStatus: "insufficient", similarity: null }),
    ];
    const metrics = calculateMetrics(cases, BASELINE);

    assert.equal(metrics.confusionMatrix.answered.answered, 1);
    assert.equal(metrics.confusionMatrix.answered.insufficient, 1);
    assert.equal(metrics.confusionMatrix.cautious.cautious, 1);
    assert.equal(metrics.confusionMatrix.insufficient.insufficient, 1);
    assert.equal(metrics.total, 4);
  });

  test("counts falseAnswered when predicted answered but expected status differs", () => {
    const cases = [makeCase({ expectedStatus: "cautious", similarity: 0.9, answerCorrect: true })];
    const metrics = calculateMetrics(cases, BASELINE);
    assert.equal(metrics.falseAnsweredCount, 1);
    assert.equal(metrics.incorrectAnsweredCount, 0);
  });

  test("counts incorrectAnswered when status matches but the content was wrong", () => {
    const cases = [makeCase({ expectedStatus: "answered", similarity: 0.9, answerCorrect: false })];
    const metrics = calculateMetrics(cases, BASELINE);
    assert.equal(metrics.falseAnsweredCount, 1);
    assert.equal(metrics.incorrectAnsweredCount, 1);
  });

  test("counts scopeUnsafeAnswered independently of correctness", () => {
    const cases = [makeCase({ expectedStatus: "answered", similarity: 0.9, answerCorrect: true, scopeSafe: false })];
    const metrics = calculateMetrics(cases, BASELINE);
    assert.equal(metrics.scopeUnsafeAnsweredCount, 1);
    assert.equal(metrics.falseAnsweredCount, 0);
  });

  test("does not count non-answered predictions toward false/incorrect/scope-unsafe", () => {
    const cases = [makeCase({ expectedStatus: "insufficient", similarity: 0.1, answerCorrect: false, scopeSafe: false })];
    const metrics = calculateMetrics(cases, BASELINE);
    assert.equal(metrics.falseAnsweredCount, 0);
    assert.equal(metrics.incorrectAnsweredCount, 0);
    assert.equal(metrics.scopeUnsafeAnsweredCount, 0);
  });

  test("handles an empty case list without NaN", () => {
    const metrics = calculateMetrics([], BASELINE);
    assert.equal(metrics.total, 0);
    assert.equal(metrics.statusAccuracy, 0);
    assert.equal(metrics.coverage, 0);
    assert.equal(Number.isNaN(metrics.macroF1), false);
  });

  test("computes coverage as (answered+cautious)/total based on predictions", () => {
    const cases = [
      makeCase({ expectedStatus: "answered", similarity: 0.9 }),
      makeCase({ expectedStatus: "cautious", similarity: 0.5 }),
      makeCase({ expectedStatus: "insufficient", similarity: 0.1 }),
      makeCase({ expectedStatus: "insufficient", similarity: 0.1 }),
    ];
    const metrics = calculateMetrics(cases, BASELINE);
    assert.equal(metrics.coverage, 0.5);
  });
});

describe("rankThresholdCandidates", () => {
  test("orders by scopeUnsafe asc, falseAnswered asc, precision desc, macroF1 desc, coverage desc", () => {
    const candidates = [
      { pair: { answeredThreshold: 0.5, cautiousThreshold: 0.3 }, metrics: { scopeUnsafeAnsweredCount: 1, falseAnsweredCount: 0, answeredPrecision: 1, macroF1: 1, coverage: 1 } },
      { pair: { answeredThreshold: 0.6, cautiousThreshold: 0.4 }, metrics: { scopeUnsafeAnsweredCount: 0, falseAnsweredCount: 2, answeredPrecision: 0.5, macroF1: 0.5, coverage: 0.5 } },
      { pair: { answeredThreshold: 0.7, cautiousThreshold: 0.4 }, metrics: { scopeUnsafeAnsweredCount: 0, falseAnsweredCount: 0, answeredPrecision: 0.8, macroF1: 0.8, coverage: 0.8 } },
      { pair: { answeredThreshold: 0.8, cautiousThreshold: 0.4 }, metrics: { scopeUnsafeAnsweredCount: 0, falseAnsweredCount: 0, answeredPrecision: 0.9, macroF1: 0.7, coverage: 0.9 } },
    ];

    const ranked = rankThresholdCandidates(candidates);
    assert.deepEqual(ranked.map((c) => c.pair.answeredThreshold), [0.8, 0.7, 0.6, 0.5]);
    assert.deepEqual(ranked.map((c) => c.rank), [1, 2, 3, 4]);
  });

  test("does not mutate the input array", () => {
    const candidates = [
      { pair: { answeredThreshold: 0.6 }, metrics: { scopeUnsafeAnsweredCount: 0, falseAnsweredCount: 0, answeredPrecision: 1, macroF1: 1, coverage: 1 } },
    ];
    const copy = JSON.parse(JSON.stringify(candidates));
    rankThresholdCandidates(candidates);
    assert.deepEqual(candidates, copy);
  });
});

describe("validateCalibrationDataset", () => {
  test("accepts a well-formed dataset", () => {
    const result = validateCalibrationDataset({ schemaVersion: 1, cases: [makeCase({})] });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  test("rejects a non-object root", () => {
    const result = validateCalibrationDataset([]);
    assert.equal(result.valid, false);
    assert.equal(result.errors[0].code, "ROOT_NOT_OBJECT");
  });

  test("flags an unsupported schemaVersion", () => {
    const result = validateCalibrationDataset({ schemaVersion: 2, cases: [] });
    assert.equal(result.errors.some((e) => e.code === "SCHEMA_VERSION_UNSUPPORTED"), true);
  });

  test("flags a duplicate caseId", () => {
    const result = validateCalibrationDataset({
      schemaVersion: 1,
      cases: [makeCase({ caseId: "dup" }), makeCase({ caseId: "dup" })],
    });
    assert.equal(result.errors.some((e) => e.code === "DUPLICATE_CASE_ID"), true);
  });

  test("flags an out-of-range similarity", () => {
    const result = validateCalibrationDataset({ schemaVersion: 1, cases: [makeCase({ similarity: 1.5 })] });
    assert.equal(result.errors.some((e) => e.code === "INVALID_SIMILARITY" && e.field === "similarity"), true);
  });

  test("accepts the real API/DB similarity contract boundaries of -1 and 1 (not 0)", () => {
    // Final similarity_score in supabase/migrations/005_store_scoped_hybrid_search.sql is
    // `least(1.0, raw_similarity_score + keyword_boost)` with no lower floor outside the
    // refund/payment boost branch, and raw cosine similarity is bounded to [-1, 1] — this
    // matches question_logs.similarity_score's CHECK (between -1 and 1) constraint.
    const resultMin = validateCalibrationDataset({ schemaVersion: 1, cases: [makeCase({ similarity: -1 })] });
    const resultMax = validateCalibrationDataset({ schemaVersion: 1, cases: [makeCase({ similarity: 1 })] });
    assert.equal(resultMin.valid, true);
    assert.equal(resultMax.valid, true);
  });

  test("rejects similarity below -1 or above 1 without silently clamping it", () => {
    const belowMin = validateCalibrationDataset({ schemaVersion: 1, cases: [makeCase({ similarity: -1.01 })] });
    const aboveMax = validateCalibrationDataset({ schemaVersion: 1, cases: [makeCase({ similarity: 1.01 })] });
    assert.equal(belowMin.valid, false);
    assert.equal(belowMin.errors[0].code, "INVALID_SIMILARITY");
    assert.equal(aboveMax.valid, false);
    assert.equal(aboveMax.errors[0].code, "INVALID_SIMILARITY");
    // The rejected value itself must not appear anywhere in the returned data (no clamping/substitution).
    assert.equal(belowMin.data, null);
    assert.equal(aboveMax.data, null);
  });

  test("accepts a null similarity", () => {
    const result = validateCalibrationDataset({ schemaVersion: 1, cases: [makeCase({ similarity: null })] });
    assert.equal(result.valid, true);
  });

  test("flags a non-boolean answerCorrect/scopeSafe", () => {
    const result = validateCalibrationDataset({
      schemaVersion: 1,
      cases: [makeCase({ answerCorrect: "yes", scopeSafe: "no" })],
    });
    assert.equal(result.errors.filter((e) => e.code === "INVALID_BOOLEAN").length, 2);
  });

  test("errors only ever contain index/caseId/field/code, never question/answer text", () => {
    const result = validateCalibrationDataset({
      schemaVersion: 1,
      cases: [makeCase({ similarity: 5 })],
    });
    for (const error of result.errors) {
      assert.deepEqual(Object.keys(error).sort(), ["caseId", "code", "field", "index"]);
    }
  });

  test("warns (does not error) on the same groupId appearing in both partitions", () => {
    const result = validateCalibrationDataset({
      schemaVersion: 1,
      cases: [
        makeCase({ caseId: "c1", groupId: "shared-group", partition: "calibration" }),
        makeCase({ caseId: "c2", groupId: "shared-group", partition: "validation" }),
      ],
    });
    assert.equal(result.valid, true);
    assert.equal(result.warnings.some((w) => w.code === WARNING_CODES.GROUP_PARTITION_LEAKAGE), true);
  });
});

describe("analyzeThresholds", () => {
  const calibrationCases = [
    makeCase({ caseId: "c1", groupId: "g1", partition: "calibration", expectedStatus: "answered", similarity: 0.9, answerCorrect: true }),
    makeCase({ caseId: "c2", groupId: "g2", partition: "calibration", expectedStatus: "cautious", similarity: 0.5, answerCorrect: true }),
    makeCase({ caseId: "c3", groupId: "g3", partition: "calibration", expectedStatus: "insufficient", similarity: 0.1, answerCorrect: false }),
  ];
  const validationCases = [
    makeCase({ caseId: "v1", groupId: "g4", partition: "validation", expectedStatus: "answered", similarity: 0.85, answerCorrect: true }),
  ];

  test("always includes a baseline result", () => {
    const analysis = analyzeThresholds([...calibrationCases, ...validationCases]);
    assert.equal(analysis.baseline.pair.answeredThreshold, 0.60);
    assert.equal(analysis.baseline.pair.cautiousThreshold, 0.40);
  });

  test("separates calibration and validation metrics", () => {
    const analysis = analyzeThresholds([...calibrationCases, ...validationCases]);
    assert.equal(analysis.calibrationCount, 3);
    assert.equal(analysis.validationCount, 1);
    assert.notEqual(analysis.baseline.metrics.total, analysis.baseline.validationMetrics.total);
  });

  test("returns null validationMetrics when no validation data exists", () => {
    const analysis = analyzeThresholds(calibrationCases);
    assert.equal(analysis.validationCount, 0);
    assert.equal(analysis.baseline.validationMetrics, null);
    assert.equal(analysis.warnings.some((w) => w.code === WARNING_CODES.EMPTY_VALIDATION_SET), true);
  });

  test("warns on an empty dataset without throwing", () => {
    const analysis = analyzeThresholds([]);
    assert.equal(analysis.calibrationCount, 0);
    assert.equal(analysis.validationCount, 0);
    assert.equal(analysis.warnings.some((w) => w.code === WARNING_CODES.EMPTY_CALIBRATION_SET), true);
    assert.equal(analysis.warnings.some((w) => w.code === WARNING_CODES.EMPTY_VALIDATION_SET), true);
    assert.equal(analysis.warnings.some((w) => w.code === WARNING_CODES.LOW_CASE_COUNT), true);
  });

  test("warns when an expectedStatus class is missing from calibration", () => {
    const analysis = analyzeThresholds([
      makeCase({ caseId: "only-answered", expectedStatus: "answered", similarity: 0.9 }),
    ]);
    assert.equal(
      analysis.warnings.some((w) => w.code === WARNING_CODES.MISSING_STATUS_CLASS && w.status === "cautious"),
      true,
    );
    assert.equal(
      analysis.warnings.some((w) => w.code === WARNING_CODES.MISSING_STATUS_CLASS && w.status === "insufficient"),
      true,
    );
  });

  test("warns when there are no correctly-answered calibration cases", () => {
    const analysis = analyzeThresholds([
      makeCase({ expectedStatus: "answered", similarity: 0.9, answerCorrect: false }),
    ]);
    assert.equal(analysis.warnings.some((w) => w.code === WARNING_CODES.NO_ANSWERED_CORRECT_CASES), true);
  });

  test("warns when a scope-unsafe case is present", () => {
    const analysis = analyzeThresholds([
      makeCase({ expectedStatus: "answered", similarity: 0.9, answerCorrect: true, scopeSafe: false }),
    ]);
    assert.equal(analysis.warnings.some((w) => w.code === WARNING_CODES.SCOPE_UNSAFE_CASES_PRESENT), true);
  });

  test("marks calibrationEligible=false and reports scopeUnsafeCaseCount when scopeSafe=false exists", () => {
    const analysis = analyzeThresholds([
      makeCase({ caseId: "c1", expectedStatus: "answered", similarity: 0.9, answerCorrect: true, scopeSafe: false }),
      makeCase({ caseId: "c2", expectedStatus: "answered", similarity: 0.9, answerCorrect: true, scopeSafe: true }),
    ]);
    assert.equal(analysis.calibrationEligible, false);
    assert.equal(analysis.scopeUnsafeCaseCount, 1);
    assert.equal(analysis.notices.some((n) => n.code === "SCOPE_UNSAFE_PRESENT"), true);
  });

  test("stays ineligible even when a high answered threshold reclassifies the unsafe case as insufficient", () => {
    const analysis = analyzeThresholds(
      [makeCase({ expectedStatus: "insufficient", similarity: 0.66, answerCorrect: false, scopeSafe: false })],
      { pairs: [{ answeredThreshold: 0.95, cautiousThreshold: 0.90, isBaseline: false }] },
    );
    // With this pair, classifySimilarity(0.66, ...) is "insufficient" (not "answered"),
    // so scopeUnsafeAnsweredCount for this candidate is 0 — but eligibility is still false.
    assert.equal(analysis.topCandidates[0].metrics.scopeUnsafeAnsweredCount, 0);
    assert.equal(analysis.calibrationEligible, false);
    assert.equal(analysis.scopeUnsafeCaseCount, 1);
  });

  test("detects groupId leakage across calibration/validation partitions", () => {
    const analysis = analyzeThresholds([
      makeCase({ caseId: "c1", groupId: "shared", partition: "calibration", similarity: 0.9 }),
      makeCase({ caseId: "v1", groupId: "shared", partition: "validation", similarity: 0.9 }),
    ]);
    const leakage = analysis.warnings.find((w) => w.code === WARNING_CODES.GROUP_PARTITION_LEAKAGE);
    assert.ok(leakage);
    assert.deepEqual(leakage.groupIds, ["shared"]);
  });

  test("marks calibrationEligible=false when calibration/validation groupId leakage exists", () => {
    const analysis = analyzeThresholds([
      makeCase({ caseId: "c1", groupId: "shared", partition: "calibration", similarity: 0.9 }),
      makeCase({ caseId: "v1", groupId: "shared", partition: "validation", similarity: 0.9 }),
    ]);
    assert.equal(analysis.calibrationEligible, false);
    assert.equal(analysis.notices.some((n) => n.code === "GROUP_PARTITION_LEAKAGE"), true);
  });

  test("marks calibrationEligible=true for a clean dataset with no scope-unsafe cases or leakage", () => {
    const analysis = analyzeThresholds([...calibrationCases, ...validationCases]);
    assert.equal(analysis.calibrationEligible, true);
    assert.equal(analysis.scopeUnsafeCaseCount, 0);
    assert.equal(analysis.notices.length, 0);
  });

  test("ranking uses only calibration data (top candidates are limited by --top)", () => {
    const analysis = analyzeThresholds([...calibrationCases, ...validationCases], { top: 2 });
    assert.equal(analysis.topCandidates.length <= 2, true);
    for (const candidate of analysis.topCandidates) {
      assert.equal(candidate.pair.isBaseline, false);
    }
  });

  test("never includes question/answer/store/UUID-shaped fields in its output", () => {
    const analysis = analyzeThresholds([...calibrationCases, ...validationCases]);
    const serialized = JSON.stringify(analysis);
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(serialized), false);
    assert.equal(serialized.includes("question"), false);
    assert.equal(serialized.toLowerCase().includes("token"), false);
  });
});
