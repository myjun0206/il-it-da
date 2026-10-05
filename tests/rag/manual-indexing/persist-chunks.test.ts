import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { persistManualChunks } from "../../../lib/rag/manual-indexing/persist-chunks.ts";

type Call = { method: string; args: unknown[] };

function fakeSupabase(options: { upsertError?: unknown; deleteError?: unknown } = {}): {
  client: SupabaseClient;
  calls: Call[];
} {
  const calls: Call[] = [];

  const client = {
    from() { assert.fail("direct chunk writes forbidden"); },
    rpc(name: string, args?: unknown) {
      calls.push({ method: "rpc", args: [name, args] });
      return Promise.resolve(name === "check_manual_write_contract" ? { data: 2, error: null }
        : { data: null, error: options.upsertError ?? options.deleteError ?? null });
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

const snapshot = { id: "manual-1", updated_at: "2026-10-04T00:00:00.000001Z", title: "title", category: "category", content: "text", brand_name: "brand", status: "approved", franchise_id: null, store_id: null, scope_type: "hq", parent_manual_id: null };
describe("persistManualChunks (versioned atomic replacement)", () => {
  test("atomically replaces all chunks including stale tail, preserving chunk order and snapshot", async () => {
    const { client, calls } = fakeSupabase();

    const result = await persistManualChunks(client, "manual-1", [
      { content: "첫 번째 청크", embedding: [0.1, 0.2] },
      { content: "두 번째 청크", embedding: [0.3, 0.4] },
    ], snapshot);

    assert.equal(result.chunkCount, 2);

    const upsertCall = calls.find((call) => call.args[0] === "replace_manual_chunks_if_current");
    assert.ok(upsertCall);
    const args = upsertCall.args[1] as { p_chunks: unknown; p_expected_snapshot: unknown };
    assert.deepEqual(args.p_chunks, [
      { manual_id: "manual-1", chunk_index: 0, content: "첫 번째 청크", embedding: [0.1, 0.2] },
      { manual_id: "manual-1", chunk_index: 1, content: "두 번째 청크", embedding: [0.3, 0.4] },
    ]);
    assert.deepEqual(args.p_expected_snapshot, snapshot);
    assert.equal(calls.some((call) => call.method === "from"), false);
  });

  test("re-running with the same chunks is idempotent: same manual_id/chunk_index pairs are reused", async () => {
    const { client, calls } = fakeSupabase();
    await persistManualChunks(client, "manual-1", [{ content: "a", embedding: [1] }], snapshot);
    await persistManualChunks(client, "manual-1", [{ content: "a", embedding: [1] }], snapshot);

    const upsertCalls = calls.filter((call) => call.args[0] === "replace_manual_chunks_if_current");
    assert.equal(upsertCalls.length, 2);
    assert.deepEqual(upsertCalls[0].args[1], upsertCalls[1].args[1]);
  });

  test("rejects empty chunks and missing snapshot without deleting existing chunks", async () => {
    const { client, calls } = fakeSupabase();
    await assert.rejects(persistManualChunks(client, "manual-1", [], snapshot), /CHUNK_PERSIST_FAILED/);
    await assert.rejects(persistManualChunks(client, "manual-1", [{ content: "a", embedding: [1] }]), /CHUNK_PERSIST_FAILED/);
    assert.deepEqual(calls, []);
  });

  test("throws a fixed CHUNK_PERSIST_FAILED error (not the raw Supabase error) when upsert fails", async () => {
    const { client } = fakeSupabase({ upsertError: { message: "connection refused", code: "500" } });

    await assert.rejects(
      () => persistManualChunks(client, "manual-1", [{ content: "a", embedding: [1] }], snapshot),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "CHUNK_PERSIST_FAILED");
        return true;
      },
    );
  });
});
