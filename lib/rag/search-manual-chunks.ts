import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createEmbedding } from "@/lib/rag/openai-embeddings";
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
      similarity_score: item.similarity_score,
    });
  }

  return matches;
}

export async function searchManualChunks(
  question: string,
  matchCount = 5,
): Promise<ManualChunkMatch[]> {
  const normalizedQuestion = validateAndNormalizeQuestion(question);
  const validatedMatchCount = validateMatchCount(matchCount);

  const embedding = await createEmbedding(normalizedQuestion);
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("match_manual_chunks", {
    query_embedding: embedding,
    match_count: validatedMatchCount,
  });

  if (error) {
    console.error("Supabase RPC Error Details:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw new Error(`RPC match_manual_chunks failed: ${error.message}`);
  }

  return parseChunkMatches(data);
}
