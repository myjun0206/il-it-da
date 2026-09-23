// Pure, side-effect-free helpers for scripts/evaluate-rag.mjs.
// None of these functions call console or fetch; they only transform data so the
// de-identification logic used for default and --verbose output can be unit tested
// without making real network calls.

export const ERROR_CODES = Object.freeze({
  NETWORK_ERROR: "NETWORK_ERROR",
  HTTP_ERROR: "HTTP_ERROR",
  INVALID_JSON_RESPONSE: "INVALID_JSON_RESPONSE",
  MISSING_RESPONSE_FIELDS: "MISSING_RESPONSE_FIELDS",
});

export const VERBOSE_WARNING =
  "경고: --verbose 옵션을 사용하면 질문과 답변 원문이 터미널 또는 CI 로그에 남을 수 있습니다.";

// Strips userinfo, query string, and hash from a URL, keeping only protocol+host+pathname.
// Returns null instead of throwing when the input is not a valid absolute URL.
export function getSafeEndpointOrigin(rawUrl) {
  try {
    const url = new URL(String(rawUrl));
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return null;
  }
}

export function formatScore(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(4) : "-";
}

// Builds a de-identified failure result. Never accepts or forwards a raw Error/message,
// only one of the fixed ERROR_CODES values and (when known) the HTTP status number.
export function buildErrorResult(testCase, { errorCode, httpStatus = null, ragStatus = null } = {}) {
  return {
    ...testCase,
    actualAnswer: "",
    topTitle: "-",
    topManualId: "-",
    topCategory: "-",
    rawSimilarity: null,
    keywordBoost: null,
    finalSimilarity: null,
    httpStatus,
    ragStatus,
    errorCode: typeof errorCode === "string" ? errorCode : "NETWORK_ERROR",
  };
}

// Only whitelisted, non-identifying fields are copied in: no question/answer text,
// no store name/storeId, no manual title/id, no raw error message.
export function buildSummaryRow(result) {
  return {
    case: result?.caseId ?? "-",
    type: result?.positive ? "positive" : "negative",
    category: typeof result?.expectedCategory === "string" ? result.expectedCategory : "-",
    matchCategory: typeof result?.topCategory === "string" ? result.topCategory : "-",
    httpStatus: result?.httpStatus ?? "-",
    ragStatus: typeof result?.ragStatus === "string" ? result.ragStatus : "-",
    errorCode: typeof result?.errorCode === "string" ? result.errorCode : "-",
    rawSimilarity: formatScore(result?.rawSimilarity),
    keywordBoost: formatScore(result?.keywordBoost),
    finalSimilarity: formatScore(result?.finalSimilarity),
  };
}

// Only shown when the caller explicitly opts into --verbose. Even then, storeId, store
// name, manual title/id, and any auth-related value are intentionally left out.
export function buildVerboseDetail(result) {
  return {
    case: result?.caseId ?? "-",
    question: typeof result?.question === "string" ? result.question : "-",
    expectedAnswer: typeof result?.expectedAnswer === "string" ? result.expectedAnswer : "-",
    actualAnswer: typeof result?.actualAnswer === "string" && result.actualAnswer.length > 0
      ? result.actualAnswer
      : "-",
  };
}

// Generic, content-free review flags keyed by case number only.
export function buildReviewWarnings(result) {
  const warnings = [];
  if (typeof result?.actualAnswer !== "string" || result.actualAnswer.trim().length === 0) {
    warnings.push(`case ${result?.caseId ?? "-"}: actualAnswer is empty.`);
  }
  if (result?.topManualId === "-" || result?.topManualId == null) {
    warnings.push(`case ${result?.caseId ?? "-"}: source is missing.`);
  }
  return warnings;
}
