/**
 * 검색 순위(similarity_score)와 "답할 수 있는 근거인가"(evidenceScore)를 분리한다.
 *
 * 018 RPC의 similarity_score는 keyword_boost가 섞인 랭킹 점수이고, keyword_boost가 0.35일 때는
 * 원래 유사도가 0이어도 0.60으로 바닥이 깔린다. 그 값을 그대로 answered 판정에 쓰면 단어만 겹친
 * 무관한 청크가 확정 답변이 된다. 여기서는 의미 유사도(raw_similarity_score)를 기준으로 삼고,
 * keyword_boost는 상한을 둔 보조 가산점으로만 쓴다.
 */
import type { ManualChunkMatch, RagStatus } from "@/lib/rag/types";

/** 이 값 미만이면 의미가 닿지 않은 것으로 보고 키워드 가산점을 주지 않는다. */
export const MIN_SEMANTIC_SIMILARITY = 0.2;

/** 키워드가 겹쳐도 더해 줄 수 있는 최대치. 단어 하나로 등급이 뒤집히지 않게 한다. */
export const KEYWORD_SUPPORT_CAP = 0.15;

export type ScoredChunk = {
  match: ManualChunkMatch;
  evidenceScore: number;
  keywordSupport: number;
};

export type EvidenceGateThresholds = {
  answered: number;
  cautious: number;
};

export type EvidenceGateResult = {
  /** 검색 단계까지의 판정. 생성 단계에서 insufficient로 더 내려갈 수 있다. */
  searchStatus: RagStatus;
  /** 모델에게 넘겨도 되는 근거만 점수 내림차순으로. */
  usableChunks: ScoredChunk[];
  /** 최상위 근거의 evidenceScore. 결과가 없으면 null. */
  topEvidenceScore: number | null;
};

function clampToUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function keywordSupportFor(match: ManualChunkMatch): number {
  const raw = Number.isFinite(match.raw_similarity_score) ? match.raw_similarity_score : 0;
  if (raw < MIN_SEMANTIC_SIMILARITY) {
    return 0;
  }
  const boost = Number.isFinite(match.keyword_boost) ? Math.max(0, match.keyword_boost) : 0;
  return Math.min(boost, KEYWORD_SUPPORT_CAP);
}

export function scoreChunk(match: ManualChunkMatch): ScoredChunk {
  const raw = Number.isFinite(match.raw_similarity_score) ? match.raw_similarity_score : 0;
  const keywordSupport = keywordSupportFor(match);
  return { match, keywordSupport, evidenceScore: clampToUnit(raw + keywordSupport) };
}

export function applyEvidenceGate(
  matches: readonly ManualChunkMatch[],
  thresholds: EvidenceGateThresholds,
): EvidenceGateResult {
  const scored = matches
    .map(scoreChunk)
    .sort((left, right) => right.evidenceScore - left.evidenceScore);

  const usableChunks = scored.filter((chunk) => chunk.evidenceScore >= thresholds.cautious);
  const topEvidenceScore = scored.length > 0 ? scored[0].evidenceScore : null;

  if (usableChunks.length === 0) {
    return { searchStatus: "insufficient", usableChunks: [], topEvidenceScore };
  }

  return {
    searchStatus: usableChunks[0].evidenceScore >= thresholds.answered ? "answered" : "cautious",
    usableChunks,
    topEvidenceScore,
  };
}
