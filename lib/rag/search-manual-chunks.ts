import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createEmbedding } from "@/lib/rag/openai-embeddings";
import type { ManualChunkMatch } from "@/lib/rag/types";

const SHORT_QUERY_LENGTH = 10;
const MAX_KEYWORD_COUNT = 8;
const REFUND_QUERY_KEYWORDS = ["환불", "규정", "결제", "취소"] as const;
const REFUND_DOCUMENT_KEYWORDS = ["환불", "결제"] as const;
const REFUND_KEYWORD_BOOST = 0.35;
const MIN_REFUND_MATCH_SCORE = 0.60;
const QUERY_EXPANSIONS: ReadonlyArray<readonly [string, string]> = [
  ["환불", "취소 결제 취소 영수증 결제 내역 처리 정책"],
  ["발주", "주문 재고 입고 수량 평균 사용량 기준"],
  ["원두", "원두 재고 발주 입고 사용량"],
  ["청소", "세척 소독 위생 마감 점검"],
  ["오픈", "영업 시작 준비 점검 체크리스트"],
  ["마감", "영업 종료 청소 위생 점검"],
];

type RpcError = {
  code?: string;
  message?: string;
};

function validateAndNormalizeQuestion(question: unknown): string {
  if (typeof question !== "string") {
    throw new Error("Question must be a string.");
  }

  const normalized = question.trim();
  if (!normalized) {
    throw new Error("Question cannot be empty.");
  }

  if (normalized.length > 2_000) {
    throw new Error("Question must be 2,000 characters or fewer.");
  }

  return normalized;
}

function validateMatchCount(matchCount: unknown): number {
  if (typeof matchCount !== "number" || !Number.isInteger(matchCount)) {
    throw new Error("matchCount must be an integer.");
  }

  if (matchCount < 1 || matchCount > 10) {
    throw new Error("matchCount must be between 1 and 10.");
  }

  return matchCount;
}

function formatSearchEmbeddingInput(question: string): string {
  const formattedQuery = `매뉴얼 검색 질문: ${question.trim()}`;

  if (question.length < SHORT_QUERY_LENGTH) {
    const relatedTerms = QUERY_EXPANSIONS
      .filter(([keyword]) => question.includes(keyword))
      .map(([, expansion]) => expansion)
      .join(" ");
    const expandedContext = relatedTerms || "관련 업무 절차 기준 정책 처리 방법";

    return `제목: ${question}\n카테고리: 매장 업무\n내용: ${question} ${expandedContext}`;
  }

  return formattedQuery;
}

function extractSearchKeywords(question: string): string[] {
  const tokens = question
    .toLocaleLowerCase("ko-KR")
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const domainKeywords = QUERY_EXPANSIONS
    .map(([keyword]) => keyword)
    .filter((keyword) => question.includes(keyword));

  return [...new Set([...tokens, ...domainKeywords])].slice(0, MAX_KEYWORD_COUNT);
}

function getSafeErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : "Unknown error";

  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(api[_ -]?key|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
}

function isMissingHybridRpcError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const rpcError = error as RpcError;
  const message = rpcError.message ?? "";

  return (
    rpcError.code === "42883" ||
    rpcError.code === "PGRST202" ||
    /match_manual_chunks_hybrid.*(?:does not exist|not found|schema cache)/i.test(message)
  );
}

function calculateKeywordBoost(
  title: string | null | undefined,
  content: string | null | undefined,
  question: string,
  keywords: string[],
): number {
  const normalizedTitle = (title ?? "").toLocaleLowerCase("ko-KR");
  const normalizedContent = (content ?? "").toLocaleLowerCase("ko-KR");
  const normalizedQuestion = question.toLocaleLowerCase("ko-KR");
  const hasRefundIntent = REFUND_QUERY_KEYWORDS.some(
    (keyword) => normalizedQuestion.includes(keyword) || keywords.includes(keyword),
  );
  const hasRefundDocumentKeyword = REFUND_DOCUMENT_KEYWORDS.some(
    (keyword) => normalizedTitle.includes(keyword) || normalizedContent.includes(keyword),
  );

  if (hasRefundIntent && hasRefundDocumentKeyword) return REFUND_KEYWORD_BOOST;

  if (normalizedTitle.includes(normalizedQuestion)) return 0.30;
  if (normalizedContent.includes(normalizedQuestion)) return 0.25;
  if (keywords.some((keyword) => normalizedTitle.includes(keyword))) return 0.25;
  if (keywords.some((keyword) => normalizedContent.includes(keyword))) return 0.20;
  return 0;
}

function isManualChunkMatch(item: unknown): item is ManualChunkMatch {
  if (!item || typeof item !== "object") {
    return false;
  }

  const record = item as Record<string, unknown>;

  return (
    typeof record.chunk_id === "string" &&
    typeof record.manual_id === "string" &&
    typeof record.title === "string" &&
    typeof record.category === "string" &&
    typeof record.content === "string" &&
    typeof record.raw_similarity_score === "number" &&
    Number.isFinite(record.raw_similarity_score) &&
    typeof record.keyword_boost === "number" &&
    Number.isFinite(record.keyword_boost) &&
    typeof record.similarity_score === "number" &&
    Number.isFinite(record.similarity_score)
  );
}

function parseChunkMatches(data: unknown): ManualChunkMatch[] {
  if (!Array.isArray(data)) {
    if (data === null || data === undefined) {
      return [];
    }
    throw new Error("Invalid Supabase RPC response: expected an array.");
  }

  const matches: ManualChunkMatch[] = [];

  for (const item of data) {
    if (!isManualChunkMatch(item)) {
      throw new Error("Supabase RPC returned an item with invalid structure.");
    }
    matches.push({
      chunk_id: item.chunk_id,
      manual_id: item.manual_id,
      title: item.title,
      category: item.category,
      content: item.content,
      raw_similarity_score: item.raw_similarity_score,
      keyword_boost: item.keyword_boost,
      similarity_score: item.similarity_score,
    });
  }

  return matches;
}

function parseLegacyChunkMatches(
  data: unknown,
  question: string,
  keywords: string[],
): ManualChunkMatch[] {
  if (!Array.isArray(data)) {
    if (data === null || data === undefined) return [];
    throw new Error("Invalid legacy Supabase RPC response: expected an array.");
  }

  return data.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Legacy Supabase RPC returned an invalid item.");
    }

    const record = item as Record<string, unknown>;
    if (
      typeof record.chunk_id !== "string" ||
      typeof record.manual_id !== "string" ||
      typeof record.similarity_score !== "number" ||
      !Number.isFinite(record.similarity_score)
    ) {
      throw new Error("Legacy Supabase RPC returned an item with invalid structure.");
    }

    const title = typeof record.title === "string" ? record.title : "";
    const category = typeof record.category === "string" ? record.category : "";
    const content = typeof record.content === "string" ? record.content : "";
    const rawSimilarity = record.similarity_score;
    const keywordBoost = calculateKeywordBoost(title, content, question, keywords);
    const boostedSimilarity = rawSimilarity + keywordBoost;

    return {
      chunk_id: record.chunk_id,
      manual_id: record.manual_id,
      title,
      category,
      content,
      raw_similarity_score: rawSimilarity,
      keyword_boost: keywordBoost,
      similarity_score: Math.min(
        1,
        keywordBoost === REFUND_KEYWORD_BOOST
          ? Math.max(MIN_REFUND_MATCH_SCORE, boostedSimilarity)
          : boostedSimilarity,
      ),
    };
  }).sort((left, right) => right.similarity_score - left.similarity_score);
}

async function searchWithLegacyRpc(
  supabase: ReturnType<typeof createAdminClient>,
  embedding: number[],
  question: string,
  keywords: string[],
  matchCount: number,
): Promise<ManualChunkMatch[]> {
  const { data, error } = await supabase.rpc("match_manual_chunks", {
    query_embedding: embedding,
    match_count: matchCount,
  });

  if (error) {
    console.error("RAG legacy RPC failed:", getSafeErrorMessage(error));
    throw new Error(`Supabase fallback search failed: ${getSafeErrorMessage(error)}`);
  }

  return parseLegacyChunkMatches(data, question, keywords);
}

export async function searchManualChunks(
  question: string,
  matchCount = 5,
): Promise<ManualChunkMatch[]> {
  const normalizedQuestion = validateAndNormalizeQuestion(question);
  const validatedMatchCount = validateMatchCount(matchCount);
  const formattedQuery = formatSearchEmbeddingInput(normalizedQuestion);
  const queryKeywords = extractSearchKeywords(normalizedQuestion);

  const embedding = await createEmbedding(formattedQuery);
  const supabase = createAdminClient();

  let matches: ManualChunkMatch[];

  try {
    const { data, error } = await supabase.rpc("match_manual_chunks_hybrid", {
      query_embedding: embedding,
      query_text: normalizedQuestion,
      query_keywords: queryKeywords,
      match_count: validatedMatchCount,
    });

    if (error) throw error;
    matches = parseChunkMatches(data);
  } catch (error) {
    if (!isMissingHybridRpcError(error)) {
      console.error("RAG hybrid RPC failed:", getSafeErrorMessage(error));
      throw new Error(`Supabase hybrid search failed: ${getSafeErrorMessage(error)}`);
    }

    console.warn(
      "RAG hybrid RPC is unavailable; falling back to match_manual_chunks:",
      getSafeErrorMessage(error),
    );
    matches = await searchWithLegacyRpc(
      supabase,
      embedding,
      normalizedQuestion,
      queryKeywords,
      validatedMatchCount,
    );
  }

  const topMatch = matches[0];

  console.info("RAG vector search", {
    formattedQuery,
    topManualTitle: topMatch?.title ?? null,
    rawSimilarity: topMatch?.raw_similarity_score ?? null,
    keywordBoost: topMatch?.keyword_boost ?? null,
    finalSimilarity: topMatch?.similarity_score ?? null,
  });

  return matches;
}
