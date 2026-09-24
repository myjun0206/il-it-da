import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createEmbedding } from "@/lib/rag/openai-embeddings";
import {
  extractSearchKeywords,
  formatSearchEmbeddingInput,
} from "@/lib/rag/search-query";
import type { ManualChunkMatch } from "@/lib/rag/types";


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

export async function searchManualChunks(
  question: string,
  storeId: string,
  franchiseId: string,
  matchCount = 5,
): Promise<ManualChunkMatch[]> {
  const normalizedQuestion = validateAndNormalizeQuestion(question);
  const validatedMatchCount = validateMatchCount(matchCount);
  const formattedQuery = formatSearchEmbeddingInput(normalizedQuestion);
  const queryKeywords = extractSearchKeywords(normalizedQuestion);

  const embedding = await createEmbedding(formattedQuery);
  const supabase = createAdminClient();

  // HQ 공통 매뉴얼(scope_type='hq', store_id is null, 같은 franchise) + 자기 store 전용 매뉴얼만 반환하는 scoped RPC(018 migration).
  const { data, error } = await supabase.rpc("match_manual_chunks_hybrid_scoped", {
    query_embedding: embedding,
    query_text: normalizedQuestion,
    query_keywords: queryKeywords,
    target_store_id: storeId,
    target_franchise_id: franchiseId,
    match_count: validatedMatchCount,
  });

  if (error) {
    console.error("RAG store-scoped hybrid search failed.");
    throw new Error("Supabase store-scoped hybrid search failed.");
  }

  const matches = parseChunkMatches(data);

  const topMatch = matches[0];

  console.info("RAG vector search", {
    matchCount: matches.length,
    rawSimilarity: topMatch?.raw_similarity_score ?? null,
    keywordBoost: topMatch?.keyword_boost ?? null,
    finalSimilarity: topMatch?.similarity_score ?? null,
  });

  return matches;
}
