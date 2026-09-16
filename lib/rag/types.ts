export type RagStatus = "answered" | "cautious" | "insufficient";

export type RagSource = {
  manualId: string;
  title: string;
  category: string;
};

export type RagQueryRequest = {
  question: string;
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
  source: RagSource | null;
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
