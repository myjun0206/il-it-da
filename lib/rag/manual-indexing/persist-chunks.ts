import type { SupabaseClient } from "@supabase/supabase-js";
import { requireManualWriteContract } from "@/lib/manuals/manual-write-contract";

export interface ManualChunkRow {
  content: string;
  embedding: number[];
}

export interface PersistManualChunksResult {
  chunkCount: number;
}

/**
 * Small adapter around the same idempotent write pattern already used by
 * lib/rag/index-approved-manual.ts: upsert on the existing
 * (manual_id, chunk_index) unique constraint (from 001_initial_rag_schema.sql)
 * so re-indexing the same manual overwrites its own chunks instead of
 * duplicating them, then delete any now-stale trailing chunk rows left over
 * from a previous run that produced more chunks than this one.
 */
export async function persistManualChunks(
  supabase: SupabaseClient,
  manualId: string,
  chunks: readonly ManualChunkRow[],
  expectedSnapshot?: Record<string, unknown>,
): Promise<PersistManualChunksResult> {
  if (!expectedSnapshot || chunks.length === 0) throw new Error("CHUNK_PERSIST_FAILED");
  await requireManualWriteContract(supabase);

  const rows = chunks.map((chunk, index) => ({
    manual_id: manualId,
    chunk_index: index,
    content: chunk.content,
    embedding: chunk.embedding,
  }));

  const { error } = await supabase.rpc("replace_manual_chunks_if_current", {
    p_manual_id: manualId, p_expected_snapshot: expectedSnapshot, p_chunks: rows,
  });
  if (error) {
    throw new Error("CHUNK_PERSIST_FAILED");
  }

  return { chunkCount: chunks.length };
}
