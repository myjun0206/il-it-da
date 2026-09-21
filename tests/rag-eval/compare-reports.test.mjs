import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  compareEvaluationReports,
  loadEvaluationReport,
  validateEvaluationReport,
} from "../../scripts/rag-eval/compare-reports.mjs";

function baseSummary(overrides = {}) {
  return {
    total: 2,
    passed: 2,
    failed: 0,
    passRate: 1,
    statusMatched: 2,
    statusAccuracy: 1,
    keywordPassed: 2,
    keywordPassRate: 1,
    forbiddenViolations: 0,
    errorCount: 0,
    ...overrides,
  };
}

function makeReport({ summary, cases, schemaVersion = 1, generatedAt = "2026-01-01T00:00:00.000Z" } = {}) {
  return {
    schemaVersion,
    generatedAt,
    summary: baseSummary(summary),
    cases: cases ?? [],
  };
}

function passCase(questionId, overrides = {}) {
  return {
    questionId,
    expectedStatus: "answered",
    actualStatus: "answered",
    statusMatched: true,
    keywordPassed: true,
    missingKeywordCount: 0,
    forbiddenPassed: true,
    forbiddenMatchCount: 0,
    pass: true,
    ...overrides,
  };
}

function failCase(questionId, overrides = {}) {
  return passCase(questionId, { actualStatus: "cautious", statusMatched: false, pass: false, ...overrides });
}

function errorCase(questionId, code = "HTTP_ERROR") {
  return { questionId, error: true, code };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe("validateEvaluationReport", () => {
  test("accepts a well-formed schemaVersion-1 report", () => {
    const report = makeReport({ cases: [passCase("QA-001")] });
    const result = validateEvaluationReport(report, "baseline");

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  test("rejects a non-object value", () => {
    const result = validateEvaluationReport(["not", "an", "object"], "candidate");

    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, [
      { fileRole: "candidate", index: null, questionId: null, field: "root", code: "NOT_AN_OBJECT" },
    ]);
  });

  test("rejects a schemaVersion other than 1", () => {
    const report = makeReport({ cases: [passCase("QA-001")] });
    report.schemaVersion = 2;
    const result = validateEvaluationReport(report, "baseline");

    assert.ok(result.errors.some((error) => error.field === "schemaVersion" && error.code === "INVALID_SCHEMA_VERSION"));
  });

  test("rejects a non-string generatedAt", () => {
    const report = makeReport({ cases: [passCase("QA-001")] });
    report.generatedAt = 12345;
    const result = validateEvaluationReport(report, "baseline");

    assert.ok(result.errors.some((error) => error.field === "generatedAt" && error.code === "INVALID_GENERATED_AT"));
  });

  test("reports a missing summary field", () => {
    const report = makeReport({ cases: [passCase("QA-001")] });
    delete report.summary.passRate;
    const result = validateEvaluationReport(report, "baseline");

    assert.ok(result.errors.some((error) => error.field === "passRate" && error.code === "SUMMARY_FIELD_MISSING"));
  });

  test("rejects NaN/Infinity-shaped summary values", () => {
    const nanReport = makeReport({ summary: { passRate: NaN }, cases: [] });
    const infReport = makeReport({ summary: { statusAccuracy: Infinity }, cases: [] });

    const nanResult = validateEvaluationReport(nanReport, "baseline");
    const infResult = validateEvaluationReport(infReport, "candidate");

    assert.ok(nanResult.errors.some((error) => error.field === "passRate" && error.code === "SUMMARY_FIELD_INVALID"));
    assert.ok(
      infResult.errors.some((error) => error.field === "statusAccuracy" && error.code === "SUMMARY_FIELD_INVALID"),
    );
  });

  test("rejects a non-array cases field", () => {
    const report = makeReport({ cases: [] });
    report.cases = "not-an-array";
    const result = validateEvaluationReport(report, "baseline");

    assert.ok(result.errors.some((error) => error.field === "cases" && error.code === "CASES_NOT_ARRAY"));
  });

  test("reports a missing field on a normal case", () => {
    const brokenCase = passCase("QA-001");
    delete brokenCase.actualStatus;
    const report = makeReport({ cases: [brokenCase] });
    const result = validateEvaluationReport(report, "baseline");

    assert.ok(
      result.errors.some(
        (error) => error.index === 0 && error.field === "actualStatus" && error.code === "CASE_FIELD_MISSING",
      ),
    );
  });

  test("reports a missing code on an error case", () => {
    const report = makeReport({ cases: [{ questionId: "QA-002", error: true }] });
    const result = validateEvaluationReport(report, "baseline");

    assert.ok(
      result.errors.some((error) => error.index === 0 && error.field === "code" && error.code === "CASE_FIELD_MISSING"),
    );
  });

  test("rejects an empty questionId", () => {
    const report = makeReport({ cases: [passCase("   ")] });
    const result = validateEvaluationReport(report, "baseline");

    assert.ok(result.errors.some((error) => error.field === "questionId" && error.code === "CASE_FIELD_MISSING"));
  });

  test("accumulates multiple errors instead of stopping at the first", () => {
    const report = makeReport({ cases: [passCase("QA-001"), { questionId: "QA-002", error: true }] });
    delete report.cases[0].pass;
    delete report.cases[1].code;
    report.schemaVersion = 99;
    const result = validateEvaluationReport(report, "baseline");

    assert.ok(result.errors.length >= 3);
  });

  test("error objects only contain fileRole/index/questionId/field/code", () => {
    const result = validateEvaluationReport({}, "candidate");

    for (const error of result.errors) {
      assert.deepEqual(Object.keys(error).sort(), ["code", "field", "fileRole", "index", "questionId"]);
    }
  });
});

describe("loadEvaluationReport", () => {
  let tempDir;

  before(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "rag-eval-compare-"));
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("strips a UTF-8 BOM before parsing", () => {
    const filePath = path.join(tempDir, "bom.json");
    const report = makeReport({ cases: [passCase("QA-001")] });
    writeFileSync(filePath, `\uFEFF${JSON.stringify(report)}`, "utf8");

    const result = loadEvaluationReport(filePath, "baseline");

    assert.equal(result.valid, true);
  });

  test("throws a distinct error for invalid JSON syntax", () => {
    const filePath = path.join(tempDir, "invalid.json");
    writeFileSync(filePath, "{ not valid json", "utf8");

    assert.throws(() => loadEvaluationReport(filePath, "baseline"), (error) => {
      assert.equal(error.code, "REPORT_JSON_SYNTAX_ERROR");
      return true;
    });
  });

  test("throws a distinct error when the file cannot be read", () => {
    const filePath = path.join(tempDir, "does-not-exist.json");

    assert.throws(() => loadEvaluationReport(filePath, "baseline"), (error) => {
      assert.equal(error.code, "REPORT_READ_ERROR");
      return true;
    });
  });
});

describe("compareEvaluationReports", () => {
  test("finds no regression when comparing identical reports", () => {
    const report = makeReport({ cases: [passCase("QA-001")] });
    const comparison = compareEvaluationReports(report, report);

    assert.equal(comparison.hasRegression, false);
    assert.deepEqual(comparison.deltas, {
      passRate: 0,
      statusAccuracy: 0,
      keywordPassRate: 0,
      forbiddenViolations: 0,
      errorCount: 0,
    });
  });

  test("flags a regression when passRate decreases", () => {
    const baseline = makeReport({ summary: { passRate: 1 }, cases: [passCase("QA-001")] });
    const candidate = makeReport({ summary: { passRate: 0.5 }, cases: [passCase("QA-001")] });

    assert.equal(compareEvaluationReports(baseline, candidate).hasRegression, true);
  });

  test("flags a regression when statusAccuracy decreases", () => {
    const baseline = makeReport({ summary: { statusAccuracy: 1 }, cases: [passCase("QA-001")] });
    const candidate = makeReport({ summary: { statusAccuracy: 0.5 }, cases: [passCase("QA-001")] });

    assert.equal(compareEvaluationReports(baseline, candidate).hasRegression, true);
  });

  test("flags a regression when keywordPassRate decreases", () => {
    const baseline = makeReport({ summary: { keywordPassRate: 1 }, cases: [passCase("QA-001")] });
    const candidate = makeReport({ summary: { keywordPassRate: 0.5 }, cases: [passCase("QA-001")] });

    assert.equal(compareEvaluationReports(baseline, candidate).hasRegression, true);
  });

  test("flags a regression when forbiddenViolations increases", () => {
    const baseline = makeReport({ summary: { forbiddenViolations: 0 }, cases: [passCase("QA-001")] });
    const candidate = makeReport({ summary: { forbiddenViolations: 1 }, cases: [passCase("QA-001")] });

    assert.equal(compareEvaluationReports(baseline, candidate).hasRegression, true);
  });

  test("flags a regression when errorCount increases", () => {
    const baseline = makeReport({ summary: { errorCount: 0 }, cases: [passCase("QA-001")] });
    const candidate = makeReport({ summary: { errorCount: 1 }, cases: [passCase("QA-001")] });

    assert.equal(compareEvaluationReports(baseline, candidate).hasRegression, true);
  });

  test("classifies a questionId group as regressed when a passing case becomes failing", () => {
    const baseline = makeReport({ cases: [passCase("QA-001")] });
    const candidate = makeReport({ cases: [failCase("QA-001")] });

    const comparison = compareEvaluationReports(baseline, candidate);

    assert.equal(comparison.hasRegression, true);
    assert.deepEqual(
      comparison.questionGroups.regressed.map((entry) => entry.questionId),
      ["QA-001"],
    );
  });

  test("classifies a questionId group as improved when a failing case becomes passing", () => {
    const baseline = makeReport({ summary: { passRate: 0 }, cases: [failCase("QA-001")] });
    const candidate = makeReport({ summary: { passRate: 1 }, cases: [passCase("QA-001")] });

    const comparison = compareEvaluationReports(baseline, candidate);

    assert.deepEqual(
      comparison.questionGroups.improved.map((entry) => entry.questionId),
      ["QA-001"],
    );
  });

  test("classifies a questionId group as regressed when error count increases", () => {
    const baseline = makeReport({ cases: [passCase("QA-001")] });
    const candidate = makeReport({ cases: [errorCase("QA-001")] });

    const comparison = compareEvaluationReports(baseline, candidate);

    assert.deepEqual(
      comparison.questionGroups.regressed.map((entry) => entry.questionId),
      ["QA-001"],
    );
  });

  test("classifies a questionId found only in candidate as added, not a regression by itself", () => {
    const baseline = makeReport({ cases: [passCase("QA-001")] });
    const candidate = makeReport({ cases: [passCase("QA-001"), passCase("QA-002")] });

    const comparison = compareEvaluationReports(baseline, candidate);

    assert.deepEqual(
      comparison.questionGroups.added.map((entry) => entry.questionId),
      ["QA-002"],
    );
    assert.equal(comparison.questionGroups.regressed.length, 0);
  });

  test("classifies a questionId found only in baseline as removed, which counts as a regression", () => {
    const baseline = makeReport({ cases: [passCase("QA-001"), passCase("QA-002")] });
    const candidate = makeReport({ cases: [passCase("QA-001")] });

    const comparison = compareEvaluationReports(baseline, candidate);

    assert.deepEqual(
      comparison.questionGroups.removed.map((entry) => entry.questionId),
      ["QA-002"],
    );
    assert.equal(comparison.hasRegression, true);
  });

  test("groups multiple cases sharing the same questionId (target_store='all' expansion) without overwriting", () => {
    const baseline = makeReport({ cases: [passCase("QA-001"), passCase("QA-001")] });
    const candidate = makeReport({ cases: [passCase("QA-001"), passCase("QA-001")] });

    const comparison = compareEvaluationReports(baseline, candidate);
    const [unchangedEntry] = comparison.questionGroups.unchanged;

    assert.equal(unchangedEntry.questionId, "QA-001");
    assert.equal(unchangedEntry.baseline.total, 2);
    assert.equal(unchangedEntry.baseline.passed, 2);
    assert.equal(unchangedEntry.candidate.total, 2);
  });

  test("detects a regression when only one store within a shared questionId group regresses", () => {
    const baseline = makeReport({ cases: [passCase("QA-001"), passCase("QA-001")] });
    const candidate = makeReport({ cases: [passCase("QA-001"), failCase("QA-001")] });

    const comparison = compareEvaluationReports(baseline, candidate);

    assert.deepEqual(
      comparison.questionGroups.regressed.map((entry) => entry.questionId),
      ["QA-001"],
    );
  });

  test("never mutates the baseline or candidate report objects", () => {
    const baseline = deepFreeze(makeReport({ cases: [passCase("QA-001"), passCase("QA-001")] }));
    const candidate = deepFreeze(makeReport({ cases: [passCase("QA-001"), failCase("QA-002")] }));

    assert.doesNotThrow(() => compareEvaluationReports(baseline, candidate));
  });
});
