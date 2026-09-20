import { normalizeText } from "./question-set.mjs";

function toStringArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Grades a single QA case against an API-shaped response ({ status, answer }).
 * Pure function: no network/DB access, no question or answer text in the result.
 */
export function gradeCase(questionCase, response) {
  const expectedStatus = questionCase?.expected_status ?? null;
  const actualStatus = response?.status ?? null;
  const statusMatched = expectedStatus !== null && expectedStatus === actualStatus;

  const normalizedAnswer = normalizeText(response?.answer);

  const expectedKeywords = toStringArray(questionCase?.expected_keywords);
  const missingKeywordCount = expectedKeywords.filter(
    (keyword) => !normalizedAnswer.includes(normalizeText(keyword)),
  ).length;
  const keywordPassed = missingKeywordCount === 0;

  const forbiddenContent = toStringArray(questionCase?.forbidden_content);
  const forbiddenMatchCount = forbiddenContent.filter((term) =>
    normalizedAnswer.includes(normalizeText(term)),
  ).length;
  const forbiddenPassed = forbiddenMatchCount === 0;

  return {
    questionId: typeof questionCase?.question_id === "string" ? questionCase.question_id : null,
    statusMatched,
    expectedStatus,
    actualStatus,
    keywordPassed,
    missingKeywordCount,
    forbiddenPassed,
    forbiddenMatchCount,
    pass: statusMatched && keywordPassed && forbiddenPassed,
  };
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

/** Aggregates gradeCase results (and optional { error: true } entries) into summary counts. */
export function summarizeResults(results) {
  const list = Array.isArray(results) ? results : [];
  const errorItems = list.filter((result) => result?.error === true);
  const gradedItems = list.filter((result) => !(result?.error === true));

  const passed = gradedItems.filter((result) => result.pass === true).length;
  const statusMatched = gradedItems.filter((result) => result.statusMatched === true).length;
  const keywordPassed = gradedItems.filter((result) => result.keywordPassed === true).length;
  const forbiddenViolations = gradedItems.filter((result) => result.forbiddenPassed === false).length;

  return {
    total: list.length,
    passed,
    failed: gradedItems.length - passed,
    passRate: safeRate(passed, gradedItems.length),
    statusMatched,
    statusAccuracy: safeRate(statusMatched, gradedItems.length),
    keywordPassed,
    keywordPassRate: safeRate(keywordPassed, gradedItems.length),
    forbiddenViolations,
    errorCount: errorItems.length,
  };
}
