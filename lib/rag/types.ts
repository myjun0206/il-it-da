export type RagStatus = "answered" | "cautious" | "insufficient";

export type RagSource = {
  manualId: string;
  title: string;
  category: string;
};

export type RagQueryRequest = {
  question: string;
  storeId: string;
};

export type RagSearchMatch = {
  title: string;
  category: string;
  similarity: number;
  rawSimilarity: number;
  keywordBoost: number;
};

export type RagQuerySuccessResponse = {
  answer: string;
  similarity: number | null;
  /** 하위 호환용 대표 출처. sources[0]과 같다. */
  source: RagSource | null;
  /** 답변에 실제로 사용한 근거 전부. 근거가 없으면 빈 배열. */
  sources?: RagSource[];
  status?: RagStatus;
  matches: RagSearchMatch[];
};

export type RagQueryErrorResponse = {
  error: string;
};

export type RagQueryResponse = RagQuerySuccessResponse | RagQueryErrorResponse;

export type ManualChunkMatch = {
  chunk_id: string;
  manual_id: string;
  title: string;
  category: string;
  content: string;
  raw_similarity_score: number;
  keyword_boost: number;
  similarity_score: number;
};
