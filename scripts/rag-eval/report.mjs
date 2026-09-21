import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPORT_SCHEMA_VERSION = 1;

function toReportCase(result) {
  if (result?.error === true) {
    return {
      questionId: typeof result.questionId === "string" ? result.questionId : null,
      error: true,
      code: typeof result.code === "string" ? result.code : "UNKNOWN_ERROR",
    };
  }

  return {
    questionId: typeof result?.questionId === "string" ? result.questionId : null,
    expectedStatus: typeof result?.expectedStatus === "string" ? result.expectedStatus : null,
    actualStatus: typeof result?.actualStatus === "string" ? result.actualStatus : null,
    statusMatched: result?.statusMatched === true,
    keywordPassed: result?.keywordPassed === true,
    missingKeywordCount: typeof result?.missingKeywordCount === "number" ? result.missingKeywordCount : 0,
    forbiddenPassed: result?.forbiddenPassed === true,
    forbiddenMatchCount: typeof result?.forbiddenMatchCount === "number" ? result.forbiddenMatchCount : 0,
    pass: result?.pass === true,
  };
}

function toReportSummary(summary) {
  return {
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    passRate: summary.passRate,
    statusMatched: summary.statusMatched,
    statusAccuracy: summary.statusAccuracy,
    keywordPassed: summary.keywordPassed,
    keywordPassRate: summary.keywordPassRate,
    forbiddenViolations: summary.forbiddenViolations,
    errorCount: summary.errorCount,
  };
}

/**
 * Builds a de-identified evaluation report object.
 * Only whitelisted fields are copied in, so question/answer/storeId/endpoint text
 * can never leak into the report even if an upstream result object were to carry them.
 */
export function createEvaluationReport(summary, results, generatedAt = new Date().toISOString()) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt,
    summary: toReportSummary(summary),
    cases: (Array.isArray(results) ? results : []).map(toReportCase),
  };
}

/**
 * Writes the report as indented, BOM-less UTF-8 JSON via a same-directory temp file + rename.
 * Throws (without leaving a temp file behind) instead of ever writing a partial report.
 */
export function writeEvaluationReport(filePath, report, { force = false } = {}) {
  if (existsSync(filePath) && !force) {
    const error = new Error("Report file already exists.");
    error.code = "REPORT_ALREADY_EXISTS";
    throw error;
  }

  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);

  if (!existsSync(dir)) {
    const error = new Error("Report directory does not exist.");
    error.code = "REPORT_DIRECTORY_NOT_FOUND";
    throw error;
  }

  const tempPath = path.join(dir, `.${path.basename(resolved)}.tmp-${process.pid}`);

  try {
    writeFileSync(tempPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    renameSync(tempPath, resolved);
  } catch (cause) {
    try {
      unlinkSync(tempPath);
    } catch {
      // temp file may never have been created; nothing further to clean up
    }
    const error = new Error("Failed to write report file.");
    error.code = "REPORT_WRITE_ERROR";
    error.cause = cause;
    throw error;
  }
}
