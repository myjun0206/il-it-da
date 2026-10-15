import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createEmbedding } from "@/lib/rag/openai-embeddings";
import {
  extractSearchKeywords,
  formatSearchEmbeddingInput,
} from "@/lib/rag/search-query";
import { isClosingOrderDecisionQuestion } from "@/lib/rag/structured-answer";
import type { ManualChunkMatch } from "@/lib/rag/types";
import type { RecipeProviderUsage } from "@/lib/rag/private-recipe-fact-diagnostics";


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

function parseEmbeddingVector(value: unknown): number[] | null {
  let vector: unknown = value;
  if (typeof vector === "string") {
    try { vector = JSON.parse(vector); } catch { return null; }
  }
  if (!Array.isArray(vector) || vector.length !== 1536
    || vector.some(item => typeof item !== "number" || !Number.isFinite(item))) return null;
  return vector as number[];
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number | null {
  if (!left.length || left.length !== right.length) return null;
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return null;
  const score = dot / Math.sqrt(leftNorm * rightNorm);
  return Number.isFinite(score) ? Math.max(-1, Math.min(1, score)) : null;
}

async function searchClosingOrderLexicalMatches(
  supabase: ReturnType<typeof createAdminClient>, storeId: string, franchiseId: string,
  queryKeywords: readonly string[], queryEmbedding: readonly number[], excludedIds: ReadonlySet<string>,
): Promise<ManualChunkMatch[]> {
  const requiredTerms = ["마감시간 전 마지막 주문 여부", "POS에 표시된 주문 상태", "담당자에게 확인"];
  if (!requiredTerms.every(term => queryKeywords.includes(term))) return [];

  const [storeManuals, hqManuals] = await Promise.all([
    supabase.from("manuals").select("id,title,category,store_id").eq("status", "approved")
      .eq("scope_type", "store").eq("store_id", storeId).eq("category", "매장운영"),
    supabase.from("manuals").select("id,title,category,store_id").eq("status", "approved")
      .eq("scope_type", "hq").is("store_id", null).eq("franchise_id", franchiseId).eq("category", "매장운영"),
  ]);
  if (storeManuals.error || hqManuals.error) {
    throw Object.assign(new Error("Store-scoped closing-order source lookup failed."), { diagnosticService: "search_rpc" });
  }
  const manuals = [...storeManuals.data ?? [], ...hqManuals.data ?? []];
  if (!manuals.length) return [];
  const chunks = await supabase.from("manual_chunks").select("id,manual_id,content,embedding")
    .in("manual_id", manuals.map(manual => manual.id)).not("embedding", "is", null);
  if (chunks.error) throw Object.assign(new Error("Store-scoped closing-order chunk lookup failed."), { diagnosticService: "search_rpc" });

  const manualById = new Map(manuals.map(manual => [manual.id, manual]));
  const candidates: ManualChunkMatch[] = [];
  for (const chunk of chunks.data ?? []) {
    const normalizedContent = chunk.content.normalize("NFC").replace(/\s+/gu, " ");
    if (!requiredTerms.every(term => normalizedContent.includes(term)) || excludedIds.has(chunk.id)) continue;
    const vector = parseEmbeddingVector(chunk.embedding);
    const rawSimilarity = vector ? cosineSimilarity(queryEmbedding, vector) : null;
    if (rawSimilarity === null) continue;
    const manual = manualById.get(chunk.manual_id);
    if (!manual) continue;
    candidates.push({ chunk_id: chunk.id, manual_id: chunk.manual_id, title: manual.title,
      category: manual.category, content: chunk.content, raw_similarity_score: rawSimilarity,
      keyword_boost: .2, similarity_score: Math.min(1, rawSimilarity + .2),
      diagnostic_scope: manual.store_id === storeId ? "store" : "hq", diagnostic_scope_id: manual.store_id ?? franchiseId });
  }
  return candidates;
}

export const DEFAULT_SEARCH_CANDIDATE_COUNT = 10;

export async function searchManualChunks(
  question: string,
  storeId: string,
  franchiseId: string,
  matchCount = DEFAULT_SEARCH_CANDIDATE_COUNT,
  onUsage?: (usage: RecipeProviderUsage) => void,
): Promise<ManualChunkMatch[]> {
  const normalizedQuestion = validateAndNormalizeQuestion(question);
  const validatedMatchCount = validateMatchCount(matchCount);
  const formattedQuery = formatSearchEmbeddingInput(normalizedQuestion);
  const queryKeywords = extractSearchKeywords(normalizedQuestion);

  const embedding = await createEmbedding(formattedQuery, onUsage);
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
    throw Object.assign(new Error("Supabase store-scoped hybrid search failed."), { diagnosticService: "search_rpc" });
  }

  const matches = parseChunkMatches(data);
  if (matches.length === 0) {
    const [storeRows, hqRows] = await Promise.all([
      supabase.from("manuals").select("id").eq("status", "approved").eq("scope_type", "store").eq("store_id", storeId).limit(1),
      supabase.from("manuals").select("id").eq("status", "approved").eq("scope_type", "hq").is("store_id", null).eq("franchise_id", franchiseId).limit(1),
    ]);
    if (storeRows.error || hqRows.error) throw new Error("Manual search preparation lookup failed.");
    if ((storeRows.data?.length ?? 0) + (hqRows.data?.length ?? 0) > 0) {
      throw Object.assign(new Error("Approved manuals are not yet searchable."), { name: "ManualSearchNotReadyError" });
    }
  }
  if (isClosingOrderDecisionQuestion(normalizedQuestion)) {
    const excluded = new Set(matches.map(match => match.chunk_id));
    const supplemental = await searchClosingOrderLexicalMatches(supabase, storeId, franchiseId,
      queryKeywords, embedding, excluded);
    matches.push(...supplemental);
    matches.sort((left, right) => right.similarity_score - left.similarity_score
      || right.raw_similarity_score - left.raw_similarity_score);
  }

  const topMatch = matches[0];

  console.info("RAG vector search", {
    matchCount: matches.length,
    rawSimilarity: topMatch?.raw_similarity_score ?? null,
    keywordBoost: topMatch?.keyword_boost ?? null,
    finalSimilarity: topMatch?.similarity_score ?? null,
  });

  return matches;
}
