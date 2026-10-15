import type { RecipeEvidenceSupport } from "@/lib/rag/recipe-fact-verification";
import type { ProviderSystemErrorCode } from "@/lib/rag/provider-error";

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
  evidenceSupport?: RecipeEvidenceSupport | null;
  responseKind?: "answer" | "clarification" | "out_of_scope";
  answer: string;
  similarity: number | null;
  /** 하위 호환용 대표 출처. sources[0]과 같다. */
  source: RagSource | null;
  /** 답변에 실제로 사용한 근거 전부. 근거가 없으면 빈 배열. */
  sources?: RagSource[];
  status?: RagStatus;
  matches: RagSearchMatch[];
  questionLogSaveError?: "QUESTION_LOG_SAVE_FAILED";
};

export type RagQueryErrorResponse = {
  error: string;
  code?: "SEARCH_FAILED" | "GENERATION_FAILED" | "GENERATION_UNPARSABLE" | "RAG_QUERY_FAILED" | ProviderSystemErrorCode;
};

export type RagQueryResponse = RagQuerySuccessResponse | RagQueryErrorResponse;

export type ManualChunkMatch = {
  diagnostic_scope_id?: string;
  diagnostic_scope?: "hq" | "store" | "unknown";
  chunk_id: string;
  manual_id: string;
  title: string;
  category: string;
  content: string;
  raw_similarity_score: number;
  keyword_boost: number;
  similarity_score: number;
};
