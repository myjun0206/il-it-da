/**
 * 검색 → 근거 판정 → 생성 → 근거 검증 → 최종 status를 한 곳에서 결정한다.
 *
 * 라우트가 아니라 여기에 두는 이유는 실제 Supabase/OpenAI 없이 가짜 의존성으로
 * 전 구간을 실행 검증하기 위해서다. 시스템 오류(system_error)는 근거 부족과 분리해
 * 돌려주므로, 호출부가 이를 insufficient로 위장해 점주에게 알리지 않는다.
 */
import { applyEvidenceGate, type EvidenceGateThresholds } from "@/lib/rag/evidence-gate";
import { buildMenuClarification, canUseFamilyPackHistory, isFamilyPackFollowUp, selectMenuCandidates } from "@/lib/rag/manual-menu-intent";
import {
  StructuredAnswerParseError,
  parseStructuredAnswer,
  selectProvidedChunkIds,
} from "@/lib/rag/structured-answer";
import type {
  ManualChunkMatch,
  RagQuerySuccessResponse,
  RagSearchMatch,
  RagSource,
  RagStatus,
} from "@/lib/rag/types";

export type RagAnswerDeps = {
  search: (question: string) => Promise<ManualChunkMatch[]>;
  onDiagnostic?: (event: { stage: string; [key: string]: unknown }) => void;
  /** 구조화 JSON 문자열을 그대로 돌려준다. 파싱·검증은 이 모듈이 한다. */
  generate: (question: string, chunks: ManualChunkMatch[], familyPackVariant?: string) => Promise<string>;
};

export type RagAnswerInput = {
  question: string;
  familyPackVariant?: string;
  thresholds: EvidenceGateThresholds;
  noManualAnswer: string;
  cautionNotice: string;
};

export type RagSystemErrorCode = "SEARCH_FAILED" | "GENERATION_FAILED" | "GENERATION_UNPARSABLE";

export type RagAnswerOutcome =
  | {
      kind: "resolved";
      response: RagQuerySuccessResponse & { status: RagStatus };
      /** 최종 insufficient일 때만 true. 기존 점주 에스컬레이션 가드를 그대로 탄다. */
      escalate: boolean;
    }
  | { kind: "system_error"; code: RagSystemErrorCode };

function toRagSource(match: ManualChunkMatch): RagSource {
  return { manualId: match.manual_id, title: match.title, category: match.category };
}

function toRagSearchMatch(match: ManualChunkMatch): RagSearchMatch {
  return {
    title: match.title,
    category: match.category,
    similarity: match.similarity_score,
    rawSimilarity: match.raw_similarity_score,
    keywordBoost: match.keyword_boost,
  };
}

export async function resolveRagAnswer(
  input: RagAnswerInput,
  deps: RagAnswerDeps,
): Promise<RagAnswerOutcome> {
  let searchResults: ManualChunkMatch[];
  const familyPackVariant = canUseFamilyPackHistory(input.question) && /^[A-Z0-9]+$/.test(input.familyPackVariant ?? "") ? input.familyPackVariant : undefined;
  const selectionQuestion = familyPackVariant ? `${input.question} ${familyPackVariant} 패밀리팩` : input.question;
  const trace = (event: { stage: string; [key: string]: unknown }) => { try { deps.onDiagnostic?.(event); } catch {} };
  trace({ stage: "family_pack_context", applied: Boolean(familyPackVariant) });
  if (isFamilyPackFollowUp(input.question) && !familyPackVariant) {
    trace({ stage: "final", status: "insufficient", reason: "FOLLOW_UP_TARGET_UNRESOLVED" });
    return { kind: "resolved", escalate: true, response: {
      answer: "어떤 메뉴나 항목을 말씀하시나요? 대상을 알려주세요.", similarity: null,
      source: null, sources: [], status: "insufficient", matches: [],
    } };
  }

  try {
    searchResults = await deps.search(selectionQuestion);
  } catch {
    trace({ stage: "search", reason: "SEARCH_FAILED" });
    return { kind: "system_error", code: "SEARCH_FAILED" };
  }
  trace({ stage: "search", candidateCount: searchResults.length });

  const matches = searchResults.map(toRagSearchMatch);
  const candidateSelection = selectMenuCandidates(selectionQuestion, searchResults);
  const gate = applyEvidenceGate(candidateSelection.matches, input.thresholds);
  trace({ stage: "menu_filter", beforeCount: searchResults.length, afterCount: candidateSelection.matches.length,
    requestedMenuCount: candidateSelection.requestedMenus.length, requestedPackVariantCount: candidateSelection.requestedPackVariants.length,
    excludedChunkIds: candidateSelection.rejectedChunkIds,
    reason: candidateSelection.rejectedChunkIds.length ? "explicit_menu_conflict" : "no_menu_exclusions" });
  trace({ stage: "evidence_gate", providedCount: gate.usableChunks.length, status: gate.searchStatus, topEvidenceScore: gate.topEvidenceScore });

  const insufficient = (similarity: number | null): RagAnswerOutcome => ({
    kind: "resolved",
    escalate: true,
    response: {
      answer: input.noManualAnswer,
      similarity,
      source: null,
      sources: [],
      status: "insufficient",
      matches,
    },
  });

  if (gate.searchStatus === "insufficient") {
    trace({ stage: "final", status: "insufficient", reason: searchResults.length === 0 ? "NO_SEARCH_CANDIDATES"
      : candidateSelection.matches.length === 0 ? "ALL_MENU_CANDIDATES_EXCLUDED" : "BELOW_EVIDENCE_THRESHOLD" });
    return insufficient(gate.topEvidenceScore);
  }

  const providedChunks = gate.usableChunks.map((chunk) => chunk.match);
  let rawGeneration: string;

  try {
    const clarification = buildMenuClarification(selectionQuestion, providedChunks);
    trace({ stage: "generation", mode: clarification ? clarification.answerable ? "menu_clarification" : "unresolved_menu_abstention" : "model" });
    rawGeneration = clarification ? JSON.stringify(clarification) : await deps.generate(input.question, providedChunks, familyPackVariant);
  } catch {
    trace({ stage: "final", reason: "GENERATION_FAILED" });
    return { kind: "system_error", code: "GENERATION_FAILED" };
  }

  let structured;
  try {
    structured = parseStructuredAnswer(rawGeneration);
  } catch (error) {
    if (error instanceof StructuredAnswerParseError) {
      trace({ stage: "final", reason: "GENERATION_UNPARSABLE" });
      return { kind: "system_error", code: "GENERATION_UNPARSABLE" };
    }
    return { kind: "system_error", code: "GENERATION_FAILED" };
  }

  const evidenceScore = gate.usableChunks[0].evidenceScore;

  if (!structured.answerable) {
    trace({ stage: "final", status: "insufficient", reason: buildMenuClarification(selectionQuestion, providedChunks) ? "NO_RELEVANT_MENU_EVIDENCE" : "MODEL_NOT_ANSWERABLE" });
    return insufficient(evidenceScore);
  }

  const validChunkIds = selectProvidedChunkIds(
    structured.usedChunkIds,
    providedChunks.map((chunk) => chunk.chunk_id),
  );

  // 모델이 답할 수 있다고 해도, 실제로 제공한 근거를 지목하지 못하면 확정 답변으로 쓰지 않는다.
  if (validChunkIds.length === 0) {
    trace({ stage: "final", status: "insufficient", reason: "NO_VALID_CITED_CHUNKS" });
    return insufficient(evidenceScore);
  }

  const usedEvidence = gate.usableChunks.filter((chunk) => validChunkIds.includes(chunk.match.chunk_id));
  const usedChunks = usedEvidence.map((chunk) => chunk.match);
  const usedEvidenceScore = Math.min(...usedEvidence.map((chunk) => chunk.evidenceScore));
  const sources = usedChunks.map(toRagSource);
  const status = usedEvidenceScore >= input.thresholds.answered ? "answered" : "cautious";
  const answer = status === "cautious" ? `${structured.answer}${input.cautionNotice}` : structured.answer;
  trace({ stage: "final", status, reason: "SUPPORTED_ANSWER", usedChunkIds: validChunkIds, evidenceScore: usedEvidenceScore });

  return {
    kind: "resolved",
    escalate: false,
    response: {
      answer,
      similarity: usedEvidenceScore,
      source: sources[0],
      sources,
      status,
      matches,
    },
  };
}
