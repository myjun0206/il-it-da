// Pure, side-effect-free RAG threshold calibration helpers.
// No question/answer text, store name, UUID, or manual content is ever part of the
// input contract or these functions' outputs — only de-identified case metadata.

import { readFileSync } from "node:fs";

const PARTITIONS = new Set(["calibration", "validation"]);
const EXPECTED_STATUSES = new Set(["answered", "cautious", "insufficient"]);
const SUPPORTED_SCHEMA_VERSION = 1;
const MIN_RECOMMENDED_CASE_COUNT = 20;

export const WARNING_CODES = Object.freeze({
  LOW_CASE_COUNT: "LOW_CASE_COUNT",
  EMPTY_CALIBRATION_SET: "EMPTY_CALIBRATION_SET",
  EMPTY_VALIDATION_SET: "EMPTY_VALIDATION_SET",
  MISSING_STATUS_CLASS: "MISSING_STATUS_CLASS",
  NO_ANSWERED_CORRECT_CASES: "NO_ANSWERED_CORRECT_CASES",
  SCOPE_UNSAFE_CASES_PRESENT: "SCOPE_UNSAFE_CASES_PRESENT",
  GROUP_PARTITION_LEAKAGE: "GROUP_PARTITION_LEAKAGE",
});

// Fixed guidance shown when calibrationEligible is false. Never phrased as a
// recommendation/final candidate — these are safety notices, not quality scores.
export const CALIBRATION_NOTICES = Object.freeze({
  SCOPE_UNSAFE_PRESENT:
    "SCOPE_UNSAFE_PRESENT: 임계값을 높여 답변을 차단해도 범위 격리 문제는 해결되지 않습니다. " +
    "scopeSafe=false 사례가 있는 한 이 분석 결과는 배포 가능한 추천이나 선택 가능한 최종 후보가 아닙니다.",
  GROUP_PARTITION_LEAKAGE:
    "GROUP_PARTITION_LEAKAGE: calibration과 validation에 동일 groupId가 있어 데이터가 누수되었습니다. " +
    "validation 결과를 독립 검증으로 취급하지 말고, 누수를 해결하기 전에는 임계값을 결정하지 마세요.",
});

// The real API/DB contract for similarity (see app/api/rag/query/route.ts and the
// 003/005 SQL RPCs): raw cosine similarity is mathematically bounded to [-1, 1], the
// final similarity_score is capped at 1.0 via SQL `least(1.0, ...)` but has NO lower
// floor outside the refund/payment keyword-boost branch, so it can be negative down to
// -1. This matches the question_logs.similarity_score CHECK constraint (between -1
// and 1) in supabase/migrations/001_initial_rag_schema.sql and
// lib/rag/save-question-log.ts's normalizeSimilarity(). This tool validates against
// that real [-1, 1] contract, not an assumed [0, 1] range.
export const SIMILARITY_MIN = -1;
export const SIMILARITY_MAX = 1;

export const DEFAULT_THRESHOLD_RANGE = Object.freeze({
  answeredMin: 0.50,
  answeredMax: 0.90,
  cautiousMin: 0.20,
  cautiousMax: 0.70,
  step: 0.01,
});

// Current runtime threshold (app/api/rag/query/route.ts). Always shown as a reference
// baseline by this offline tool; this constant never feeds back into runtime code.
export const BASELINE_THRESHOLDS = Object.freeze({ answeredThreshold: 0.60, cautiousThreshold: 0.40 });

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function pushError(errors, entry) {
  errors.push(entry);
}

// ---------------------------------------------------------------------------
// 1. validateCalibrationDataset
// ---------------------------------------------------------------------------

function validateSimilarityField(errors, item, index, caseId) {
  if (!("similarity" in item)) {
    pushError(errors, { index, caseId, field: "similarity", code: "REQUIRED_FIELD_MISSING" });
    return;
  }

  if (item.similarity === null) {
    return;
  }

  if (
    typeof item.similarity !== "number" ||
    !Number.isFinite(item.similarity) ||
    item.similarity < SIMILARITY_MIN ||
    item.similarity > SIMILARITY_MAX
  ) {
    pushError(errors, { index, caseId, field: "similarity", code: "INVALID_SIMILARITY" });
  }
}

function validateBooleanField(errors, item, index, caseId, field) {
  if (!(field in item)) {
    pushError(errors, { index, caseId, field, code: "REQUIRED_FIELD_MISSING" });
    return;
  }

  if (typeof item[field] !== "boolean") {
    pushError(errors, { index, caseId, field, code: "INVALID_BOOLEAN" });
  }
}

function validateRequiredStringField(errors, item, index, caseId, field) {
  if (!isNonEmptyString(item[field])) {
    pushError(errors, { index, caseId, field, code: "REQUIRED_FIELD_MISSING" });
  }
}

function validateEnumField(errors, item, index, caseId, field, allowedValues) {
  if (!isNonEmptyString(item[field])) {
    pushError(errors, { index, caseId, field, code: "REQUIRED_FIELD_MISSING" });
    return;
  }

  if (!allowedValues.has(item[field])) {
    pushError(errors, { index, caseId, field, code: "INVALID_ENUM_VALUE" });
  }
}

function validateCase(errors, item, index, seenCaseIds) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    pushError(errors, { index, caseId: null, field: "root", code: "ITEM_NOT_OBJECT" });
    return;
  }

  const caseId = isNonEmptyString(item.caseId) ? item.caseId : null;

  if (!isNonEmptyString(item.caseId)) {
    pushError(errors, { index, caseId: null, field: "caseId", code: "REQUIRED_FIELD_MISSING" });
  } else if (seenCaseIds.has(item.caseId)) {
    pushError(errors, { index, caseId, field: "caseId", code: "DUPLICATE_CASE_ID" });
  } else {
    seenCaseIds.add(item.caseId);
  }

  validateRequiredStringField(errors, item, index, caseId, "questionId");
  validateRequiredStringField(errors, item, index, caseId, "groupId");
  validateEnumField(errors, item, index, caseId, "partition", PARTITIONS);
  validateEnumField(errors, item, index, caseId, "expectedStatus", EXPECTED_STATUSES);
  validateSimilarityField(errors, item, index, caseId);
  validateBooleanField(errors, item, index, caseId, "answerCorrect");
  validateBooleanField(errors, item, index, caseId, "scopeSafe");
}

function findLeakedGroupIds(cases) {
  const calibrationGroups = new Set(
    cases.filter((item) => item.partition === "calibration").map((item) => item.groupId),
  );
  const validationGroups = new Set(
    cases.filter((item) => item.partition === "validation").map((item) => item.groupId),
  );

  return [...validationGroups].filter((groupId) => calibrationGroups.has(groupId)).sort();
}

/**
 * Validates an already-parsed calibration dataset against the threshold-calibration
 * schema. Returns { valid, errors, warnings, data } and never mutates the input.
 * Errors only ever carry index/caseId/field/code — no question/answer/store text.
 */
export function validateCalibrationDataset(value) {
  const errors = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    pushError(errors, { index: null, caseId: null, field: "root", code: "ROOT_NOT_OBJECT" });
    return { valid: false, errors, warnings: [], data: null };
  }

  if (value.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    pushError(errors, { index: null, caseId: null, field: "schemaVersion", code: "SCHEMA_VERSION_UNSUPPORTED" });
  }

  if (!Array.isArray(value.cases)) {
    pushError(errors, { index: null, caseId: null, field: "cases", code: "CASES_NOT_ARRAY" });
    return { valid: false, errors, warnings: [], data: null };
  }

  const seenCaseIds = new Set();
  value.cases.forEach((item, index) => {
    validateCase(errors, item, index, seenCaseIds);
  });

  const valid = errors.length === 0;

  if (!valid) {
    return { valid, errors, warnings: [], data: null };
  }

  const leakedGroupIds = findLeakedGroupIds(value.cases);
  const warnings = leakedGroupIds.length > 0
    ? [{ code: WARNING_CODES.GROUP_PARTITION_LEAKAGE, groupIds: leakedGroupIds }]
    : [];

  return { valid, errors, warnings, data: value.cases };
}

// ---------------------------------------------------------------------------
// 2. generateThresholdPairs
// ---------------------------------------------------------------------------

function toCents(value) {
  return Math.round(value * 100);
}

function fromCents(cents) {
  return Math.round(cents) / 100;
}

function createRangeError(code) {
  const error = new Error("Invalid threshold range configuration.");
  error.code = code;
  return error;
}

function assertValidRangeConfig(config) {
  const { answeredMin, answeredMax, cautiousMin, cautiousMax, step } = config;
  const values = [answeredMin, answeredMax, cautiousMin, cautiousMax, step];

  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw createRangeError("THRESHOLD_RANGE_NOT_FINITE");
  }
  if (step <= 0) {
    throw createRangeError("THRESHOLD_STEP_INVALID");
  }
  if (answeredMin < 0 || answeredMax > 1 || cautiousMin < 0 || cautiousMax > 1) {
    throw createRangeError("THRESHOLD_RANGE_OUT_OF_BOUNDS");
  }
  if (answeredMin > answeredMax || cautiousMin > cautiousMax) {
    throw createRangeError("THRESHOLD_RANGE_MIN_GREATER_THAN_MAX");
  }
}

/**
 * Generates every (answeredThreshold, cautiousThreshold) combination in the given
 * (or default) range, enforcing 0 <= cautious < answered <= 1. Values are rounded to
 * 2 decimal places (integer-cent arithmetic) to avoid floating point drift. The
 * current runtime baseline (0.60/0.40) is always included and flagged isBaseline.
 */
export function generateThresholdPairs(options = {}) {
  const config = { ...DEFAULT_THRESHOLD_RANGE, ...options };
  assertValidRangeConfig(config);

  const stepCents = toCents(config.step);
  const answeredMinCents = toCents(config.answeredMin);
  const answeredMaxCents = toCents(config.answeredMax);
  const cautiousMinCents = toCents(config.cautiousMin);
  const cautiousMaxCents = toCents(config.cautiousMax);

  const pairs = [];
  const seen = new Set();

  for (let answeredCents = answeredMinCents; answeredCents <= answeredMaxCents; answeredCents += stepCents) {
    if (answeredCents > 100) break;

    for (let cautiousCents = cautiousMinCents; cautiousCents <= cautiousMaxCents; cautiousCents += stepCents) {
      if (cautiousCents < 0 || cautiousCents >= answeredCents) {
        continue;
      }

      const key = `${answeredCents}:${cautiousCents}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      pairs.push({
        answeredThreshold: fromCents(answeredCents),
        cautiousThreshold: fromCents(cautiousCents),
        isBaseline: false,
      });
    }
  }

  const baselineAnsweredCents = toCents(BASELINE_THRESHOLDS.answeredThreshold);
  const baselineCautiousCents = toCents(BASELINE_THRESHOLDS.cautiousThreshold);
  const baselineIndex = pairs.findIndex(
    (pair) => toCents(pair.answeredThreshold) === baselineAnsweredCents
      && toCents(pair.cautiousThreshold) === baselineCautiousCents,
  );

  if (baselineIndex >= 0) {
    pairs[baselineIndex] = { ...pairs[baselineIndex], isBaseline: true };
  } else {
    pairs.push({ ...BASELINE_THRESHOLDS, isBaseline: true });
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// 3. classifySimilarity
// ---------------------------------------------------------------------------

/**
 * similarity === null (or any non-finite value) -> insufficient
 * similarity >= answeredThreshold -> answered
 * cautiousThreshold <= similarity < answeredThreshold -> cautious
 * similarity < cautiousThreshold -> insufficient
 */
export function classifySimilarity(similarity, { answeredThreshold, cautiousThreshold }) {
  if (typeof similarity !== "number" || !Number.isFinite(similarity)) {
    return "insufficient";
  }
  if (similarity >= answeredThreshold) {
    return "answered";
  }
  if (similarity >= cautiousThreshold) {
    return "cautious";
  }
  return "insufficient";
}

// ---------------------------------------------------------------------------
// 4. calculateMetrics
// ---------------------------------------------------------------------------

const STATUSES = ["answered", "cautious", "insufficient"];

function emptyConfusionMatrix() {
  const matrix = {};
  for (const expected of STATUSES) {
    matrix[expected] = { answered: 0, cautious: 0, insufficient: 0 };
  }
  return matrix;
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Computes de-identified quality metrics for one threshold pair against a set of
 * calibration/validation cases. Never reads or returns question/answer/store text.
 */
export function calculateMetrics(cases, thresholdPair) {
  const list = Array.isArray(cases) ? cases : [];
  const confusionMatrix = emptyConfusionMatrix();
  const perClass = {
    answered: { tp: 0, predicted: 0, expected: 0 },
    cautious: { tp: 0, predicted: 0, expected: 0 },
    insufficient: { tp: 0, predicted: 0, expected: 0 },
  };

  let correct = 0;
  let falseAnsweredCount = 0;
  let incorrectAnsweredCount = 0;
  let scopeUnsafeAnsweredCount = 0;

  for (const item of list) {
    const expectedStatus = item?.expectedStatus;
    const predictedStatus = classifySimilarity(item?.similarity, thresholdPair);

    if (confusionMatrix[expectedStatus]) {
      confusionMatrix[expectedStatus][predictedStatus] += 1;
    }
    if (perClass[predictedStatus]) {
      perClass[predictedStatus].predicted += 1;
    }
    if (perClass[expectedStatus]) {
      perClass[expectedStatus].expected += 1;
    }
    if (predictedStatus === expectedStatus) {
      correct += 1;
      if (perClass[predictedStatus]) {
        perClass[predictedStatus].tp += 1;
      }
    }

    if (predictedStatus === "answered") {
      const statusMismatch = expectedStatus !== "answered";
      const contentWrong = item?.answerCorrect === false;

      if (statusMismatch || contentWrong) {
        falseAnsweredCount += 1;
      }
      if (!statusMismatch && contentWrong) {
        incorrectAnsweredCount += 1;
      }
      if (item?.scopeSafe === false) {
        scopeUnsafeAnsweredCount += 1;
      }
    }
  }

  const total = list.length;
  const precisionOf = (cls) => safeRate(perClass[cls].tp, perClass[cls].predicted);
  const recallOf = (cls) => safeRate(perClass[cls].tp, perClass[cls].expected);
  const f1Of = (cls) => {
    const precision = precisionOf(cls);
    const recall = recallOf(cls);
    return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  };

  const answeredCount = perClass.answered.predicted;
  const cautiousCount = perClass.cautious.predicted;
  const insufficientCount = perClass.insufficient.predicted;

  return {
    total,
    statusAccuracy: safeRate(correct, total),
    answeredPrecision: precisionOf("answered"),
    answeredRecall: recallOf("answered"),
    cautiousPrecision: precisionOf("cautious"),
    insufficientRecall: recallOf("insufficient"),
    macroF1: (f1Of("answered") + f1Of("cautious") + f1Of("insufficient")) / 3,
    answeredCount,
    cautiousCount,
    insufficientCount,
    coverage: safeRate(answeredCount + cautiousCount, total),
    falseAnsweredCount,
    incorrectAnsweredCount,
    scopeUnsafeAnsweredCount,
    confusionMatrix,
  };
}

// ---------------------------------------------------------------------------
// 5. rankThresholdCandidates
// ---------------------------------------------------------------------------

/**
 * Sorts candidates by safety-first priority:
 *   scopeUnsafeAnsweredCount asc, falseAnsweredCount asc, answeredPrecision desc,
 *   macroF1 desc, coverage desc (stable tie-break by original order).
 * Returns "top candidates", never a single "best"/"optimal" value. Does not mutate input.
 */
export function rankThresholdCandidates(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];

  return list
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      const a = left.candidate.metrics;
      const b = right.candidate.metrics;

      if (a.scopeUnsafeAnsweredCount !== b.scopeUnsafeAnsweredCount) {
        return a.scopeUnsafeAnsweredCount - b.scopeUnsafeAnsweredCount;
      }
      if (a.falseAnsweredCount !== b.falseAnsweredCount) {
        return a.falseAnsweredCount - b.falseAnsweredCount;
      }
      if (a.answeredPrecision !== b.answeredPrecision) {
        return b.answeredPrecision - a.answeredPrecision;
      }
      if (a.macroF1 !== b.macroF1) {
        return b.macroF1 - a.macroF1;
      }
      if (a.coverage !== b.coverage) {
        return b.coverage - a.coverage;
      }
      return left.index - right.index;
    })
    .map(({ candidate }, rankIndex) => ({ ...candidate, rank: rankIndex + 1 }));
}

// ---------------------------------------------------------------------------
// 6. analyzeThresholds
// ---------------------------------------------------------------------------

function partitionCases(cases) {
  return {
    calibration: cases.filter((item) => item.partition === "calibration"),
    validation: cases.filter((item) => item.partition === "validation"),
  };
}

function collectDataWarnings({ allCases, calibration, validation, leakedGroupIds }) {
  const warnings = [];

  if (allCases.length < MIN_RECOMMENDED_CASE_COUNT) {
    warnings.push({ code: WARNING_CODES.LOW_CASE_COUNT, count: allCases.length });
  }
  if (calibration.length === 0) {
    warnings.push({ code: WARNING_CODES.EMPTY_CALIBRATION_SET });
  }
  if (validation.length === 0) {
    warnings.push({ code: WARNING_CODES.EMPTY_VALIDATION_SET });
  }

  const presentStatuses = new Set(calibration.map((item) => item.expectedStatus));
  for (const status of STATUSES) {
    if (!presentStatuses.has(status)) {
      warnings.push({ code: WARNING_CODES.MISSING_STATUS_CLASS, status });
    }
  }

  const hasAnsweredCorrect = calibration.some(
    (item) => item.expectedStatus === "answered" && item.answerCorrect === true,
  );
  if (!hasAnsweredCorrect) {
    warnings.push({ code: WARNING_CODES.NO_ANSWERED_CORRECT_CASES });
  }

  if (allCases.some((item) => item.scopeSafe === false)) {
    warnings.push({ code: WARNING_CODES.SCOPE_UNSAFE_CASES_PRESENT });
  }

  if (leakedGroupIds.length > 0) {
    warnings.push({ code: WARNING_CODES.GROUP_PARTITION_LEAKAGE, groupIds: leakedGroupIds });
  }

  return warnings;
}

/**
 * Orchestrates the full offline calibration analysis: partitions cases, computes
 * data-sufficiency warnings, ranks candidates using ONLY calibration data, then
 * applies the baseline and top-ranked candidates to validation data (if present).
 * Never picks a single "best" threshold — always returns a ranked candidate list
 * plus the baseline for a human to compare and decide.
 *
 * scopeSafe=false and calibration/validation groupId leakage are NOT threshold
 * problems: no threshold pair can fix them, so calibrationEligible is derived only
 * from the raw dataset (never from any candidate's predicted status), and fixed
 * CALIBRATION_NOTICES are attached instead of silently ranking around them.
 */
export function analyzeThresholds(cases, { pairs, top = 10 } = {}) {
  const allCases = Array.isArray(cases) ? cases : [];
  const { calibration, validation } = partitionCases(allCases);
  const leakedGroupIds = findLeakedGroupIds(allCases);
  const scopeUnsafeCaseCount = allCases.filter((item) => item?.scopeSafe === false).length;
  const warnings = collectDataWarnings({ allCases, calibration, validation, leakedGroupIds });

  const notices = [];
  if (scopeUnsafeCaseCount > 0) {
    notices.push({ code: "SCOPE_UNSAFE_PRESENT", message: CALIBRATION_NOTICES.SCOPE_UNSAFE_PRESENT });
  }
  if (leakedGroupIds.length > 0) {
    notices.push({ code: "GROUP_PARTITION_LEAKAGE", message: CALIBRATION_NOTICES.GROUP_PARTITION_LEAKAGE });
  }

  // Eligibility is a property of the raw dataset, independent of any threshold pair:
  // raising the answered threshold so an unsafe case becomes "insufficient" must NOT
  // make the dataset eligible again — the underlying scope/leakage problem is unchanged.
  const calibrationEligible = scopeUnsafeCaseCount === 0 && leakedGroupIds.length === 0;

  const thresholdPairs = Array.isArray(pairs) && pairs.length > 0 ? pairs : generateThresholdPairs();
  const safeTop = Number.isInteger(top) && top > 0 ? top : 10;

  const calibrationCandidates = thresholdPairs.map((pair) => ({
    pair,
    metrics: calculateMetrics(calibration, pair),
  }));

  const ranked = rankThresholdCandidates(calibrationCandidates);
  const baselineCandidate = ranked.find((candidate) => candidate.pair.isBaseline);
  const topCandidates = ranked.filter((candidate) => !candidate.pair.isBaseline).slice(0, safeTop);

  const attachValidation = (candidate) => ({
    ...candidate,
    validationMetrics: validation.length > 0 ? calculateMetrics(validation, candidate.pair) : null,
  });

  return {
    calibrationCount: calibration.length,
    validationCount: validation.length,
    scopeUnsafeCaseCount,
    calibrationEligible,
    notices,
    warnings,
    baseline: attachValidation(
      baselineCandidate ?? { pair: { ...BASELINE_THRESHOLDS, isBaseline: true }, metrics: calculateMetrics(calibration, BASELINE_THRESHOLDS), rank: null },
    ),
    topCandidates: topCandidates.map(attachValidation),
  };
}

// ---------------------------------------------------------------------------
// File loading (thin wrapper; not a pure function, isolated at the edge)
// ---------------------------------------------------------------------------

export function loadCalibrationDataset(filePath) {
  let raw;

  try {
    raw = readFileSync(filePath, "utf8");
  } catch (cause) {
    const error = new Error("Failed to read calibration dataset file.");
    error.code = "CALIBRATION_DATASET_READ_ERROR";
    error.cause = cause;
    throw error;
  }

  let parsed;

  try {
    parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (cause) {
    const error = new Error("Calibration dataset file is not valid JSON.");
    error.code = "CALIBRATION_DATASET_JSON_SYNTAX_ERROR";
    error.cause = cause;
    throw error;
  }

  return validateCalibrationDataset(parsed);
}
