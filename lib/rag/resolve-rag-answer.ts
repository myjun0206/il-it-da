/**
 * 검색 → 근거 판정 → 생성 → 근거 검증 → 최종 status를 한 곳에서 결정한다.
 *
 * 라우트가 아니라 여기에 두는 이유는 실제 Supabase/OpenAI 없이 가짜 의존성으로
 * 전 구간을 실행 검증하기 위해서다. 시스템 오류(system_error)는 근거 부족과 분리해
 * 돌려주므로, 호출부가 이를 insufficient로 위장해 점주에게 알리지 않는다.
 */
import { applyEvidenceGate, type EvidenceGateThresholds } from "@/lib/rag/evidence-gate";
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
  /** 구조화 JSON 문자열을 그대로 돌려준다. 파싱·검증은 이 모듈이 한다. */
  generate: (question: string, chunks: ManualChunkMatch[]) => Promise<string>;
};

export type RagAnswerInput = {
  question: string;
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

  try {
    searchResults = await deps.search(input.question);
  } catch {
    return { kind: "system_error", code: "SEARCH_FAILED" };
  }

  const matches = searchResults.map(toRagSearchMatch);
  const gate = applyEvidenceGate(searchResults, input.thresholds);

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
    return insufficient(gate.topEvidenceScore);
  }

  const providedChunks = gate.usableChunks.map((chunk) => chunk.match);
  let rawGeneration: string;

  try {
    rawGeneration = await deps.generate(input.question, providedChunks);
  } catch {
    return { kind: "system_error", code: "GENERATION_FAILED" };
  }

  let structured;
  try {
    structured = parseStructuredAnswer(rawGeneration);
  } catch (error) {
    if (error instanceof StructuredAnswerParseError) {
      return { kind: "system_error", code: "GENERATION_UNPARSABLE" };
    }
    return { kind: "system_error", code: "GENERATION_FAILED" };
  }

  const evidenceScore = gate.usableChunks[0].evidenceScore;

  if (!structured.answerable) {
    return insufficient(evidenceScore);
  }

  const validChunkIds = selectProvidedChunkIds(
    structured.usedChunkIds,
    providedChunks.map((chunk) => chunk.chunk_id),
  );

  // 모델이 답할 수 있다고 해도, 실제로 제공한 근거를 지목하지 못하면 확정 답변으로 쓰지 않는다.
  if (validChunkIds.length === 0) {
    return insufficient(evidenceScore);
  }

  const usedChunks = providedChunks.filter((chunk) => validChunkIds.includes(chunk.chunk_id));
  const sources = usedChunks.map(toRagSource);
  const status = gate.searchStatus;
  const answer = status === "cautious" ? `${structured.answer}${input.cautionNotice}` : structured.answer;

  return {
    kind: "resolved",
    escalate: false,
    response: {
      answer,
      similarity: evidenceScore,
      source: sources[0],
      sources,
      status,
      matches,
    },
  };
}
