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
    from(table: string) {
      calls.push({ method: "from", args: [table] });
      return {
        upsert(rows: unknown, upsertOptions: unknown) {
          calls.push({ method: "upsert", args: [rows, upsertOptions] });
          return Promise.resolve({ error: options.upsertError ?? null });
        },
        delete() {
          calls.push({ method: "delete", args: [] });
          return {
            eq(column: string, value: unknown) {
              calls.push({ method: "eq", args: [column, value] });
              // Returned value must be directly awaitable (the empty-chunks path awaits
              // `.eq(...)` with no further chaining) while also exposing `.gte(...)`
              // (the non-empty path chains `.eq(...).gte(...)` before awaiting).
              const settled = Promise.resolve({ error: options.deleteError ?? null });
              return Object.assign(settled, {
                gte(gteColumn: string, gteValue: unknown) {
                  calls.push({ method: "gte", args: [gteColumn, gteValue] });
                  return Promise.resolve({ error: options.deleteError ?? null });
                },
              });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe("persistManualChunks (idempotent upsert + stale-row cleanup)", () => {
  test("upserts on (manual_id, chunk_index) and deletes now-stale trailing rows, preserving chunk order", async () => {
    const { client, calls } = fakeSupabase();

    const result = await persistManualChunks(client, "manual-1", [
      { content: "첫 번째 청크", embedding: [0.1, 0.2] },
      { content: "두 번째 청크", embedding: [0.3, 0.4] },
    ]);

    assert.equal(result.chunkCount, 2);

    const upsertCall = calls.find((call) => call.method === "upsert");
    assert.ok(upsertCall);
    assert.deepEqual(upsertCall.args[0], [
      { manual_id: "manual-1", chunk_index: 0, content: "첫 번째 청크", embedding: [0.1, 0.2] },
      { manual_id: "manual-1", chunk_index: 1, content: "두 번째 청크", embedding: [0.3, 0.4] },
    ]);
    assert.deepEqual(upsertCall.args[1], { onConflict: "manual_id,chunk_index" });

    const gteCall = calls.find((call) => call.method === "gte");
    assert.deepEqual(gteCall?.args, ["chunk_index", 2]);
  });

  test("re-running with the same chunks is idempotent: same manual_id/chunk_index pairs are reused", async () => {
    const { client, calls } = fakeSupabase();
    await persistManualChunks(client, "manual-1", [{ content: "a", embedding: [1] }]);
    await persistManualChunks(client, "manual-1", [{ content: "a", embedding: [1] }]);

    const upsertCalls = calls.filter((call) => call.method === "upsert");
    assert.equal(upsertCalls.length, 2);
    assert.deepEqual(upsertCalls[0].args[0], upsertCalls[1].args[0]);
  });

  test("deletes all existing chunks when the new chunk list is empty", async () => {
    const { client, calls } = fakeSupabase();
    const result = await persistManualChunks(client, "manual-1", []);

    assert.equal(result.chunkCount, 0);
    assert.equal(calls.some((call) => call.method === "upsert"), false);
    assert.ok(calls.some((call) => call.method === "delete"));
  });

  test("throws a fixed CHUNK_PERSIST_FAILED error (not the raw Supabase error) when upsert fails", async () => {
    const { client } = fakeSupabase({ upsertError: { message: "connection refused", code: "500" } });

    await assert.rejects(
      () => persistManualChunks(client, "manual-1", [{ content: "a", embedding: [1] }]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "CHUNK_PERSIST_FAILED");
        return true;
      },
    );
  });
});
