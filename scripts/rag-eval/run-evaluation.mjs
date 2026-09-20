import { gradeCase, summarizeResults } from "./grading.mjs";
import { resolveTargetStores } from "./store-map.mjs";

/**
 * Calls the RAG query API. fetchImpl is injectable for tests; defaults to globalThis.fetch.
 * Returns a discriminated result instead of throwing, so callers never see raw stack traces.
 */
export async function callRagQuery({ endpoint, question, storeId, fetchImpl = globalThis.fetch }) {
  let response;

  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, storeId }),
    });
  } catch {
    return { ok: false, code: "NETWORK_ERROR", message: "RAG API request failed due to a network error." };
  }

  if (!response.ok) {
    return {
      ok: false,
      code: "HTTP_ERROR",
      message: `RAG API request failed with HTTP status ${response.status}.`,
    };
  }

  let payload;

  try {
    payload = await response.json();
  } catch {
    return { ok: false, code: "INVALID_JSON_RESPONSE", message: "RAG API response was not valid JSON." };
  }

  if (!payload || typeof payload !== "object" || typeof payload.status !== "string" || typeof payload.answer !== "string") {
    return {
      ok: false,
      code: "MISSING_RESPONSE_FIELDS",
      message: "RAG API response is missing required status/answer fields.",
    };
  }

  return { ok: true, status: payload.status, answer: payload.answer };
}

function expandCases(questionSet, storeMap) {
  const expanded = [];

  for (const questionCase of questionSet) {
    try {
      const targets = resolveTargetStores(questionCase.target_store, storeMap);
      for (const target of targets) {
        expanded.push({ questionCase, target, resolutionErrorCode: null });
      }
    } catch (cause) {
      expanded.push({ questionCase, target: null, resolutionErrorCode: cause.code ?? "UNKNOWN_TARGET_STORE" });
    }
  }

  return expanded;
}

/**
 * Runs a validated question set against the RAG API sequentially (one case at a time).
 * Result objects never contain question text, full answer text, or storeId.
 * onCaseResult (optional) receives the richer per-case detail for verbose-only console output.
 */
export async function runEvaluation({ questionSet, storeMap, endpoint, fetchImpl = globalThis.fetch, onCaseResult }) {
  const expandedCases = expandCases(questionSet, storeMap);
  const results = [];

  for (const { questionCase, target, resolutionErrorCode } of expandedCases) {
    const questionId = typeof questionCase?.question_id === "string" ? questionCase.question_id : null;

    if (resolutionErrorCode) {
      const result = { error: true, questionId, code: resolutionErrorCode };
      results.push(result);
      if (typeof onCaseResult === "function") {
        onCaseResult({ questionId, targetStoreName: null, question: questionCase?.question, answer: null, result });
      }
      continue;
    }

    const response = await callRagQuery({
      endpoint,
      question: questionCase.question,
      storeId: target.id,
      fetchImpl,
    });

    if (!response.ok) {
      const result = { error: true, questionId, targetStoreName: target.name, code: response.code };
      results.push(result);
      if (typeof onCaseResult === "function") {
        onCaseResult({ questionId, targetStoreName: target.name, question: questionCase.question, answer: null, result });
      }
      continue;
    }

    const graded = gradeCase(questionCase, { status: response.status, answer: response.answer });
    const result = { ...graded, targetStoreName: target.name };
    results.push(result);

    if (typeof onCaseResult === "function") {
      onCaseResult({
        questionId,
        targetStoreName: target.name,
        question: questionCase.question,
        answer: response.answer,
        result,
      });
    }
  }

  return { results, summary: summarizeResults(results) };
}
