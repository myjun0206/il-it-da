import { readFileSync } from "node:fs";

const REPORT_SCHEMA_VERSION = 1;

const SUMMARY_NUMERIC_FIELDS = [
  "total",
  "passed",
  "failed",
  "passRate",
  "statusMatched",
  "statusAccuracy",
  "keywordPassed",
  "keywordPassRate",
  "forbiddenViolations",
  "errorCount",
];
const NORMAL_CASE_STRING_FIELDS = ["expectedStatus", "actualStatus"];
const NORMAL_CASE_BOOLEAN_FIELDS = ["statusMatched", "keywordPassed", "forbiddenPassed", "pass"];
const NORMAL_CASE_NUMERIC_FIELDS = ["missingKeywordCount", "forbiddenMatchCount"];
const DELTA_DECIMAL_PLACES = 4;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function pushError(errors, { fileRole, index, questionId, field, code }) {
  errors.push({ fileRole, index, questionId, field, code });
}

function validateSummary(errors, summary, fileRole) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    pushError(errors, { fileRole, index: null, questionId: null, field: "summary", code: "SUMMARY_NOT_OBJECT" });
    return;
  }

  for (const field of SUMMARY_NUMERIC_FIELDS) {
    if (!(field in summary)) {
      pushError(errors, { fileRole, index: null, questionId: null, field, code: "SUMMARY_FIELD_MISSING" });
    } else if (!isFiniteNumber(summary[field])) {
      pushError(errors, { fileRole, index: null, questionId: null, field, code: "SUMMARY_FIELD_INVALID" });
    }
  }
}

function validateCase(errors, item, index, fileRole) {
  const questionId = isNonEmptyString(item?.questionId) ? item.questionId : null;

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    pushError(errors, { fileRole, index, questionId, field: "root", code: "CASE_NOT_OBJECT" });
    return;
  }

  if (!isNonEmptyString(item.questionId)) {
    pushError(errors, { fileRole, index, questionId, field: "questionId", code: "CASE_FIELD_MISSING" });
  }

  if (item.error === true) {
    if (!isNonEmptyString(item.code)) {
      pushError(errors, { fileRole, index, questionId, field: "code", code: "CASE_FIELD_MISSING" });
    }
    return;
  }

  if (item.error !== undefined) {
    pushError(errors, { fileRole, index, questionId, field: "error", code: "CASE_FIELD_INVALID" });
  }

  for (const field of NORMAL_CASE_STRING_FIELDS) {
    if (!isNonEmptyString(item[field])) {
      pushError(errors, { fileRole, index, questionId, field, code: "CASE_FIELD_MISSING" });
    }
  }

  for (const field of NORMAL_CASE_BOOLEAN_FIELDS) {
    if (typeof item[field] !== "boolean") {
      pushError(errors, { fileRole, index, questionId, field, code: "CASE_FIELD_MISSING" });
    }
  }

  for (const field of NORMAL_CASE_NUMERIC_FIELDS) {
    if (!isFiniteNumber(item[field])) {
      pushError(errors, { fileRole, index, questionId, field, code: "CASE_FIELD_INVALID" });
    }
  }
}

/**
 * Validates an already-parsed schemaVersion-1 evaluation report.
 * Errors accumulate as { fileRole, index, questionId, field, code } — never file paths or content.
 */
export function validateEvaluationReport(value, fileRole) {
  const errors = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    pushError(errors, { fileRole, index: null, questionId: null, field: "root", code: "NOT_AN_OBJECT" });
    return { valid: false, errors, data: null };
  }

  if (value.schemaVersion !== REPORT_SCHEMA_VERSION) {
    pushError(errors, { fileRole, index: null, questionId: null, field: "schemaVersion", code: "INVALID_SCHEMA_VERSION" });
  }

  if (typeof value.generatedAt !== "string") {
    pushError(errors, { fileRole, index: null, questionId: null, field: "generatedAt", code: "INVALID_GENERATED_AT" });
  }

  validateSummary(errors, value.summary, fileRole);

  if (!Array.isArray(value.cases)) {
    pushError(errors, { fileRole, index: null, questionId: null, field: "cases", code: "CASES_NOT_ARRAY" });
  } else {
    value.cases.forEach((item, index) => validateCase(errors, item, index, fileRole));
  }

  return { valid: errors.length === 0, errors, data: errors.length === 0 ? value : null };
}

/**
 * Reads a UTF-8 evaluation report JSON file and validates it.
 * Throws for file-read or JSON syntax errors; schema errors are returned, not thrown.
 */
export function loadEvaluationReport(filePath, fileRole) {
  let raw;

  try {
    raw = readFileSync(filePath, "utf8");
  } catch (cause) {
    const error = new Error("Failed to read report file.");
    error.code = "REPORT_READ_ERROR";
    error.cause = cause;
    throw error;
  }

  let parsed;

  try {
    parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (cause) {
    const error = new Error("Report file is not valid JSON.");
    error.code = "REPORT_JSON_SYNTAX_ERROR";
    error.cause = cause;
    throw error;
  }

  return validateEvaluationReport(parsed, fileRole);
}

function roundDelta(value) {
  const factor = 10 ** DELTA_DECIMAL_PLACES;
  return Math.round(value * factor) / factor;
}

function buildQuestionGroups(cases) {
  const groups = new Map();

  for (const item of cases) {
    if (!groups.has(item.questionId)) {
      groups.set(item.questionId, { total: 0, passed: 0, failed: 0, errors: 0 });
    }

    const group = groups.get(item.questionId);
    group.total += 1;

    if (item.error === true) {
      group.errors += 1;
    } else if (item.pass === true) {
      group.passed += 1;
    } else {
      group.failed += 1;
    }
  }

  return groups;
}

function classifyGroup(baselineGroup, candidateGroup) {
  const regressed =
    candidateGroup.passed < baselineGroup.passed ||
    candidateGroup.failed > baselineGroup.failed ||
    candidateGroup.errors > baselineGroup.errors;

  const improved =
    !regressed &&
    (candidateGroup.passed > baselineGroup.passed ||
      candidateGroup.failed < baselineGroup.failed ||
      candidateGroup.errors < baselineGroup.errors);

  return { regressed, improved };
}

/**
 * Compares two already-validated schemaVersion-1 reports. Pure function: never mutates its inputs.
 * Cases sharing a questionId (e.g. target_store="all" expansions) are grouped, never overwritten.
 */
export function compareEvaluationReports(baseline, candidate) {
  const baselineGroups = buildQuestionGroups(baseline.cases);
  const candidateGroups = buildQuestionGroups(candidate.cases);
  const allQuestionIds = new Set([...baselineGroups.keys(), ...candidateGroups.keys()]);

  const regressed = [];
  const improved = [];
  const unchanged = [];
  const added = [];
  const removed = [];

  for (const questionId of allQuestionIds) {
    const baselineGroup = baselineGroups.get(questionId);
    const candidateGroup = candidateGroups.get(questionId);

    if (baselineGroup && !candidateGroup) {
      removed.push({ questionId, baseline: baselineGroup });
      continue;
    }

    if (!baselineGroup && candidateGroup) {
      added.push({ questionId, candidate: candidateGroup });
      continue;
    }

    const entry = { questionId, baseline: baselineGroup, candidate: candidateGroup };
    const { regressed: isRegressed, improved: isImproved } = classifyGroup(baselineGroup, candidateGroup);

    if (isRegressed) {
      regressed.push(entry);
    } else if (isImproved) {
      improved.push(entry);
    } else {
      unchanged.push(entry);
    }
  }

  const deltas = {
    passRate: roundDelta(candidate.summary.passRate - baseline.summary.passRate),
    statusAccuracy: roundDelta(candidate.summary.statusAccuracy - baseline.summary.statusAccuracy),
    keywordPassRate: roundDelta(candidate.summary.keywordPassRate - baseline.summary.keywordPassRate),
    forbiddenViolations: candidate.summary.forbiddenViolations - baseline.summary.forbiddenViolations,
    errorCount: candidate.summary.errorCount - baseline.summary.errorCount,
  };

  const hasRegression =
    deltas.passRate < 0 ||
    deltas.statusAccuracy < 0 ||
    deltas.keywordPassRate < 0 ||
    deltas.forbiddenViolations > 0 ||
    deltas.errorCount > 0 ||
    regressed.length > 0 ||
    removed.length > 0;

  return {
    baselineSummary: baseline.summary,
    candidateSummary: candidate.summary,
    deltas,
    questionGroups: {
      compared: regressed.length + improved.length + unchanged.length,
      regressed,
      improved,
      unchanged,
      added,
      removed,
    },
    hasRegression,
  };
}
