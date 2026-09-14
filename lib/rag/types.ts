export type RagStatus = "answered" | "cautious" | "insufficient";

export type RagSource = {
  manualId: string;
  title: string;
  category: string;
};

export type RagQueryRequest = {
  question: string;
};

export type RagQuerySuccessResponse = {
  answer: string;
  similarity: number | null;
  source: RagSource | null;
  status?: RagStatus;
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
  similarity_score: number;
};
