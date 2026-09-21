import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { createEvaluationReport, writeEvaluationReport } from "../../scripts/rag-eval/report.mjs";

const PASSING_RESULT = {
  questionId: "q-001",
  expectedStatus: "answered",
  actualStatus: "answered",
  statusMatched: true,
  keywordPassed: true,
  missingKeywordCount: 0,
  forbiddenPassed: true,
  forbiddenMatchCount: 0,
  pass: true,
};

const ERROR_RESULT = {
  error: true,
  questionId: "q-002",
  code: "HTTP_ERROR",
};

const SUMMARY = {
  total: 2,
  passed: 1,
  failed: 0,
  passRate: 0.5,
  statusMatched: 1,
  statusAccuracy: 0.5,
  keywordPassed: 1,
  keywordPassRate: 0.5,
  forbiddenViolations: 0,
  errorCount: 1,
};

describe("createEvaluationReport", () => {
  test("builds a report for a passing result", () => {
    const report = createEvaluationReport(SUMMARY, [PASSING_RESULT], "2026-01-01T00:00:00.000Z");

    assert.equal(report.schemaVersion, 1);
    assert.equal(report.generatedAt, "2026-01-01T00:00:00.000Z");
    assert.deepEqual(report.cases[0], PASSING_RESULT);
  });

  test("builds a report entry for an error case with only questionId/error/code", () => {
    const report = createEvaluationReport(SUMMARY, [ERROR_RESULT], "2026-01-01T00:00:00.000Z");

    assert.deepEqual(report.cases[0], { questionId: "q-002", error: true, code: "HTTP_ERROR" });
  });

  test("preserves every summary field exactly", () => {
    const report = createEvaluationReport(SUMMARY, [], "2026-01-01T00:00:00.000Z");

    assert.deepEqual(report.summary, SUMMARY);
  });

  test("uses an injected generatedAt value instead of the current time", () => {
    const fixed = "2020-05-05T05:05:05.000Z";
    const report = createEvaluationReport(SUMMARY, [], fixed);

    assert.equal(report.generatedAt, fixed);
  });

  test("never includes the question text even if present on the result object", () => {
    const contaminated = { ...PASSING_RESULT, question: "실제 질문 원문입니다" };
    const report = createEvaluationReport(SUMMARY, [contaminated], "2026-01-01T00:00:00.000Z");

    assert.equal("question" in report.cases[0], false);
    assert.equal(JSON.stringify(report).includes("실제 질문 원문입니다"), false);
  });

  test("never includes the full answer text even if present on the result object", () => {
    const contaminated = { ...PASSING_RESULT, answer: "실제 생성된 답변 전체 원문" };
    const report = createEvaluationReport(SUMMARY, [contaminated], "2026-01-01T00:00:00.000Z");

    assert.equal("answer" in report.cases[0], false);
    assert.equal(JSON.stringify(report).includes("실제 생성된 답변 전체 원문"), false);
  });

  test("never includes expected_result text even if present on the result object", () => {
    const contaminated = { ...PASSING_RESULT, expectedResult: "이 예제는 실제 정답 원문입니다" };
    const report = createEvaluationReport(SUMMARY, [contaminated], "2026-01-01T00:00:00.000Z");

    assert.equal("expectedResult" in report.cases[0], false);
  });

  test("never includes raw expected_keywords/forbidden_content arrays, only counts", () => {
    const contaminated = {
      ...PASSING_RESULT,
      expectedKeywords: ["9시", "영업시간"],
      forbiddenContent: ["모르겠습니다"],
    };
    const report = createEvaluationReport(SUMMARY, [contaminated], "2026-01-01T00:00:00.000Z");
    const caseKeys = Object.keys(report.cases[0]);

    assert.equal(caseKeys.includes("expectedKeywords"), false);
    assert.equal(caseKeys.includes("forbiddenContent"), false);
    assert.ok(caseKeys.includes("missingKeywordCount"));
    assert.ok(caseKeys.includes("forbiddenMatchCount"));
  });

  test("never includes storeId, target_store, or UUID-shaped fields", () => {
    const contaminated = {
      ...PASSING_RESULT,
      storeId: "57181130-4449-4299-a864-25a2098147e4",
      targetStoreName: "이수점",
    };
    const report = createEvaluationReport(SUMMARY, [contaminated], "2026-01-01T00:00:00.000Z");
    const caseKeys = Object.keys(report.cases[0]);

    assert.equal(caseKeys.includes("storeId"), false);
    assert.equal(caseKeys.includes("targetStoreName"), false);
    assert.equal(JSON.stringify(report).includes("57181130-4449-4299-a864-25a2098147e4"), false);
  });

  test("never includes an endpoint field", () => {
    const report = createEvaluationReport(SUMMARY, [PASSING_RESULT], "2026-01-01T00:00:00.000Z");

    assert.equal(JSON.stringify(report).includes("endpoint"), false);
  });
});

describe("writeEvaluationReport", () => {
  let tempDir;

  before(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "rag-eval-report-"));
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("writes indented, BOM-less UTF-8 JSON", () => {
    const filePath = path.join(tempDir, "report.json");
    const report = createEvaluationReport(SUMMARY, [PASSING_RESULT], "2026-01-01T00:00:00.000Z");

    writeEvaluationReport(filePath, report);

    const raw = readFileSync(filePath, "utf8");
    assert.equal(raw.charCodeAt(0) === 0xfeff, false);
    assert.match(raw, /\n {2}"schemaVersion": 1/);
    assert.deepEqual(JSON.parse(raw), report);
  });

  test("refuses to overwrite an existing report file without force", () => {
    const filePath = path.join(tempDir, "existing.json");
    writeFileSync(filePath, '{"existing":true}', "utf8");
    const report = createEvaluationReport(SUMMARY, [PASSING_RESULT], "2026-01-01T00:00:00.000Z");

    assert.throws(() => writeEvaluationReport(filePath, report), (error) => {
      assert.equal(error.code, "REPORT_ALREADY_EXISTS");
      return true;
    });
    assert.equal(readFileSync(filePath, "utf8"), '{"existing":true}');
  });

  test("overwrites an existing report file when force is true", () => {
    const filePath = path.join(tempDir, "force.json");
    writeFileSync(filePath, '{"existing":true}', "utf8");
    const report = createEvaluationReport(SUMMARY, [PASSING_RESULT], "2026-01-01T00:00:00.000Z");

    writeEvaluationReport(filePath, report, { force: true });

    assert.deepEqual(JSON.parse(readFileSync(filePath, "utf8")), report);
  });

  test("rejects when the destination directory does not exist", () => {
    const filePath = path.join(tempDir, "missing-dir", "report.json");
    const report = createEvaluationReport(SUMMARY, [PASSING_RESULT], "2026-01-01T00:00:00.000Z");

    assert.throws(() => writeEvaluationReport(filePath, report), (error) => {
      assert.equal(error.code, "REPORT_DIRECTORY_NOT_FOUND");
      return true;
    });
  });

  test("does not leave a temp file behind when the write itself fails", () => {
    const collisionDir = path.join(tempDir, "collision-target");
    mkdirSync(collisionDir);
    const report = createEvaluationReport(SUMMARY, [PASSING_RESULT], "2026-01-01T00:00:00.000Z");

    assert.throws(() => writeEvaluationReport(collisionDir, report, { force: true }), (error) => {
      assert.equal(error.code, "REPORT_WRITE_ERROR");
      return true;
    });

    const leftoverTempFiles = readdirSync(tempDir).filter((name) => name.includes(".tmp-"));
    assert.deepEqual(leftoverTempFiles, []);
  });
});
