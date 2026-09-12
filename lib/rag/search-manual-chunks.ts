import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ManualChunkMatch } from "@/lib/rag/types";

const OPENAI_EMBEDDING_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EXPECTED_EMBEDDING_DIMENSION = 1536;
const TIMEOUT_MS = 15_000;

function getOpenAiApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }
  return apiKey;
}

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

function parseOpenAiEmbedding(payload: unknown): number[] {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid response format from OpenAI Embeddings API.");
  }

  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.data) || record.data.length === 0) {
    throw new Error("OpenAI Embeddings response data is empty or not an array.");
  }

  const firstItem = record.data[0];
  if (!firstItem || typeof firstItem !== "object") {
    throw new Error("Invalid first item in OpenAI Embeddings data.");
  }

  const itemRecord = firstItem as Record<string, unknown>;
  if (!Array.isArray(itemRecord.embedding)) {
    throw new Error("OpenAI embedding array is missing.");
  }

  const embedding = itemRecord.embedding;
  if (embedding.length !== EXPECTED_EMBEDDING_DIMENSION) {
    throw new Error(
      `OpenAI embedding dimension mismatch: expected ${EXPECTED_EMBEDDING_DIMENSION}, received ${embedding.length}.`,
    );
  }

  for (let i = 0; i < embedding.length; i++) {
    const val = embedding[i];
    if (typeof val !== "number" || !Number.isFinite(val)) {
      throw new Error("OpenAI embedding contains invalid non-finite numbers.");
    }
  }

  return embedding as number[];
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
  const apiKey = getOpenAiApiKey();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);

  let embedding: number[];

  try {
    const response = await fetch(OPENAI_EMBEDDING_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: normalizedQuestion,
        encoding_format: "float",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI Embeddings API request failed with status ${response.status}.`);
    }

    const payload: unknown = await response.json();
    embedding = parseOpenAiEmbedding(payload);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenAI Embeddings API request timed out after ${TIMEOUT_MS / 1000} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("match_manual_chunks", {
    query_embedding: embedding,
    match_count: validatedMatchCount,
  });

  if (error) {
    throw new Error(`Supabase match_manual_chunks RPC failed: ${error.message}`);
  }

  return parseChunkMatches(data);
}
