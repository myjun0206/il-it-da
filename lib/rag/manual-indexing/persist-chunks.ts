import type { SupabaseClient } from "@supabase/supabase-js";

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
): Promise<PersistManualChunksResult> {
  if (chunks.length === 0) {
    const { error: deleteAllError } = await supabase
      .from("manual_chunks")
      .delete()
      .eq("manual_id", manualId);

    if (deleteAllError) {
      throw new Error("CHUNK_PERSIST_FAILED");
    }

    return { chunkCount: 0 };
  }

  const rows = chunks.map((chunk, index) => ({
    manual_id: manualId,
    chunk_index: index,
    content: chunk.content,
    embedding: chunk.embedding,
  }));

  const { error: upsertError } = await supabase
    .from("manual_chunks")
    .upsert(rows, { onConflict: "manual_id,chunk_index" });

  if (upsertError) {
    throw new Error("CHUNK_PERSIST_FAILED");
  }

  const { error: deleteStaleError } = await supabase
    .from("manual_chunks")
    .delete()
    .eq("manual_id", manualId)
    .gte("chunk_index", chunks.length);

  if (deleteStaleError) {
    throw new Error("CHUNK_PERSIST_FAILED");
  }

  return { chunkCount: chunks.length };
}
