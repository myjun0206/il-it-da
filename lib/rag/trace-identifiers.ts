import { createHash, randomUUID } from "node:crypto";
import type { ManualChunkMatch } from "@/lib/rag/types";

export async function annotateCandidateScopes(matches: ManualChunkMatch[], storeId: string, franchiseId: string,
  load: (manualIds: string[]) => Promise<{ data: unknown; error: unknown }>): Promise<ManualChunkMatch[]> {
  let rows: { id: string; status: string; scope_type: string; store_id: string | null; franchise_id: string }[] = [];
  try {
    const result = await load([...new Set(matches.map(match => match.manual_id))]);
    if (!result.error && Array.isArray(result.data)) rows = result.data.filter(row => row !== null && typeof row === "object");
  } catch {}
  return matches.map(match => {
    const manual = rows.find(row => row.id === match.manual_id && row.status === "approved" && row.franchise_id === franchiseId);
    const scope = manual?.scope_type === "hq" && manual.store_id === null ? "hq"
      : manual?.scope_type === "store" && manual.store_id === storeId ? "store" : "unknown";
    return { ...match, diagnostic_scope: scope };
  });
}

export function conversationTraceTag(value: unknown): string | null {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return null;
  return createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 16);
}

const TRACE_VALUES = new Set([
  "request", "history", "search_input", "family_pack_context", "search", "menu_filter", "evidence_gate", "generation",
  "structured_validation", "citation_validation", "final", "external_api", "question_log", "escalation", "repeated_alert",
  "answered", "cautious", "insufficient", "system_error", "accepted", "rejected", "direct", "policy_only", "clarification",
  "model", "menu_clarification", "unresolved_menu_abstention", "embedding", "search_rpc", "search_unknown", "answer",
  "saved", "failed", "notified", "not_applicable", "not_escalatable", "no_recipient", "below_threshold", "skipped", "not_required",
  "NOT_A_CONTEXT_FOLLOW_UP", "NO_VALID_CONVERSATION_ID", "SESSION_UNAVAILABLE", "CONVERSATION_LOOKUP_FAILED",
  "OWNED_STORE_CONVERSATION_NOT_FOUND", "PREVIOUS_USER_LOOKUP_FAILED", "NO_PREVIOUS_USER_QUESTION", "VERIFIED_PREVIOUS_USER_TARGET",
  "PREVIOUS_USER_TARGET_UNRESOLVED", "HISTORY_LOOKUP_EXCEPTION", "FOLLOW_UP_TARGET_UNRESOLVED", "SEARCH_FAILED",
  "explicit_menu_conflict", "no_menu_exclusions", "NO_SEARCH_CANDIDATES", "ALL_MENU_CANDIDATES_EXCLUDED", "BELOW_EVIDENCE_THRESHOLD",
  "GENERATION_FAILED", "GENERATION_UNPARSABLE", "STRUCTURE_OR_COVERAGE_INVALID", "NO_RELEVANT_MENU_EVIDENCE",
  "MODEL_NOT_ANSWERABLE", "NO_VALID_CITED_CHUNKS", "POLICY_ONLY_COVERAGE", "SUPPORTED_ANSWER", "REQUEST_FAILED", "RESPONSE_OK",
  "LOG_NOT_SAVED", "CLIENT_UNAVAILABLE", "ESCALATION_THREW", "REPEATED_ALERT_THREW", "FOLLOW_UP_COMPLETED",
  "SYSTEM_ERROR", "CITED_EVIDENCE_BELOW_ANSWERED_THRESHOLD", "CITED_EVIDENCE_AT_ANSWERED_THRESHOLD",
  "support_validation", "SUPPORT_ASSESSMENT_INVALID", "partial",
  "PARTIAL_SUPPORT_COVERAGE",
  "model_completion", "stop", "length", "content_filter", "tool_calls", "function_call", "unknown",
  "invalid_structure", "empty_response", "invalid_json", "invalid_type", "missing_or_empty", "missing_field", "invalid_enum",
  "invalid_length", "missing_or_invalid_target", "support_evidence_mismatch", "missing_or_invalid_quote", "response_truncated",
  "requirement_mismatch", "question_target_mismatch", "unprovided_evidence", "quote_mismatch", "source_target_mismatch", "target_relation_mismatch",
  "model_completion", "json_parse", "response_schema", "support_semantics",
  "location_reference",
  "QUESTION_TARGET_UNRESOLVED",
  "FOLLOW_UP_INTENT_AMBIGUOUS",
  "interpretation",
  "interpretation_validation", "question_interpretation", "context_target_mismatch", "constraint_anchor_mismatch",
  "duplicate_requirement", "unresolved_target", "ambiguous_current_intent", "service_http_error", "service_transport_error", "model_refusal",
  "condition_delivery",
  "prompt_delivery", "hq", "store",
]);
const TRACE_SCALARS = new Set([
  "stage", "reason", "status", "validation", "coverage", "answerable", "mode", "service", "httpStatus", "applied",
  "conversationPresent", "previousUserQuestionFound", "previousQuestionLength", "variantFound", "variantIsB", "augmented",
  "originalLength", "searchInputLength", "confirmedTargetIncluded", "includesBFamilyPack", "candidateCount", "beforeCount",
  "afterCount", "requestedMenuCount", "requestedPackVariantCount", "providedCount", "topEvidenceScore", "evidenceScore",
  "rejectedCitationCount", "notifiedCount", "skippedCount", "failedCount", "repeatCount", "claimed", "saved",
  "classificationReason", "answeredThreshold", "cautiousThreshold",
  "supportCoverage", "requestedCount", "directCount",
  "receivedCount",
  "validationKind", "finishReason",
  "failureLayer",
  "conditionCount", "contextTargetPresent", "conditionsIncluded",
]);
const TRACE_ID_ARRAYS = new Set(["usedChunkIds", "providedChunkIds", "excludedChunkIds"]);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function createRagDiagnosticTrace(options: {
  enabled: boolean;
  conversationId: unknown;
  storeId: unknown;
  emit: (event: Record<string, unknown>) => void;
}) {
  const context = { traceId: randomUUID(), traceVersion: "decision-trace-v2", conversationTag: conversationTraceTag(options.conversationId),
    storeTag: conversationTraceTag(options.storeId) };
  const trace = (event: { stage: string; [key: string]: unknown }) => {
    if (!options.enabled) return;
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event)) {
      if (TRACE_SCALARS.has(key) && (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)
        || typeof value === "string" && TRACE_VALUES.has(value))) safe[key] = value;
      if (TRACE_ID_ARRAYS.has(key) && Array.isArray(value)) safe[key] = value.filter(uuid).slice(0, 100);
      if (["expectedRequirementKinds", "receivedRequirementKinds"].includes(key) && Array.isArray(value)) {
        safe[key] = value.filter(item => typeof item === "string" && ["procedure", "permission", "timing", "method", "facts", "location", "conditions", "duration", "referral"].includes(item)).slice(0, 10);
      }
      if (key === "allowedCoverageValues" && Array.isArray(value)) {
        safe[key] = value.filter(item => typeof item === "string" && ["direct", "partial", "policy_only", "clarification"].includes(item)).slice(0, 4);
      }
    }
    if (Array.isArray(event.candidates)) safe.candidates = event.candidates.slice(0, 100).map((candidate) => {
      const row = candidate as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const key of ["manualId", "chunkId"]) if (uuid(row?.[key])) result[key === "manualId" ? "manualTag" : "chunkTag"] = conversationTraceTag(row[key]);
      for (const key of ["rpcScore", "rawSimilarity", "keywordBoost", "keywordSupport", "evidenceScore"]) {
        if (typeof row?.[key] === "number" && Number.isFinite(row[key])) result[key] = row[key];
      }
      if (typeof row?.rank === "number" && Number.isInteger(row.rank) && row.rank >= 1 && row.rank <= 10) result.rank = row.rank;
      if (["hq", "store", "unknown"].includes(row?.scopeKind as string)) result.scopeKind = row.scopeKind;
      if (typeof row?.promptIncluded === "boolean") result.promptIncluded = row.promptIncluded;
      return result;
    });
    if (uuid(event.questionLogId)) safe.questionLogId = event.questionLogId;
    if (typeof event.fieldPath === "string" && /^(\$|answerable|answer|coverage|supportAssessment(?:\.requestedTarget|\.requirements(?:\[\d{1,2}\](?:\.(?:kind|support|evidence)(?:\[\d{1,2}\](?:\.(?:chunkId|quote|role|target|targetRelation))?)?)?)?)?)$/.test(event.fieldPath)) safe.fieldPath = event.fieldPath;
    if (typeof event.fieldPath === "string" && /^interpretation\.(?:\$|target|contextTarget|clarification|requirements|constraints(?:\[\d{1,2}\])?)$/.test(event.fieldPath)) safe.fieldPath = event.fieldPath;
    try { options.emit({ ...safe, ...context, observedAt: new Date().toISOString() }); } catch {}
  };
  return Object.assign(trace, { traceId: context.traceId });
}