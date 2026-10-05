import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { indexApprovedManual } from "../../lib/rag/index-approved-manual.ts";

const manualId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const manual = { id: manualId, title: "제목", category: "운영", content: "새 본문", brand_name: "브랜드", status: "approved", updated_at: "2026-10-04T00:00:00.000Z", franchise_id: "brand", store_id: "store", scope_type: "store", parent_manual_id: null };
function fake(errorCode?: string, contractReady = true) {
  let chunks = ["old 0", "old 1", "old 2"];
  let publishes = 0;
  const client = {
    from(table: string) {
      assert.equal(table, "manuals", "no non-atomic chunk writes");
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: manual, error: null }) };
      return query;
    },
    async rpc(name: string, args: { p_expected_snapshot: unknown; p_chunks: { content: string }[] }) {
      if (name === "check_manual_write_contract") return { data: contractReady ? 2 : null, error: contractReady ? null : { code: "PGRST202" } };
      publishes++;
      assert.equal(name, "replace_manual_chunks_if_current");
      assert.deepEqual(args.p_expected_snapshot, manual);
      if (errorCode) return { error: { code: errorCode } };
      chunks = args.p_chunks.map((chunk) => chunk.content);
      return { error: null };
    },
  } as unknown as SupabaseClient;
  return { client, inspect: () => ({ chunks, publishes }) };
}

test("atomic publish replaces the complete chunk set, including stale tail", async () => {
  const db = fake();
  const result = await indexApprovedManual(manualId, db.client, async (inputs) => {
    assert.match(inputs[0], /브랜드: 브랜드\n제목: 제목\n카테고리: 운영\n내용: 새 본문/);
    return inputs.map(() => Array(1536).fill(0));
  });
  assert.equal(result.chunkCount, 1);
  assert.deepEqual(db.inspect(), { chunks: ["새 본문"], publishes: 1 });
});

test("embedding failure and count mismatch leave previous chunks untouched", async () => {
  for (const embed of [async () => { throw new Error("fake failure"); }, async () => []]) {
    const db = fake();
    await assert.rejects(indexApprovedManual(manualId, db.client, embed));
    assert.deepEqual(db.inspect(), { chunks: ["old 0", "old 1", "old 2"], publishes: 0 });
  }
});

test("concurrent edit and publish failure cannot report success or mix chunks", async () => {
  for (const code of ["40001", "XX000", "PGRST202"]) {
    const db = fake(code);
    await assert.rejects(indexApprovedManual(manualId, db.client, async () => [Array(1536).fill(0)]),
      code === "40001" ? /MANUAL_INDEX_CONFLICT/ : /MANUAL_INDEX_PUBLISH_FAILED/);
    assert.deepEqual(db.inspect().chunks, ["old 0", "old 1", "old 2"]);
  }
});

test("migration 037 defines locking, scope, revision and rollback contract", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/037_owner_manual_safe_edit.sql", import.meta.url), "utf8");
  assert.match(sql, /begin;[\s\S]*commit;/);
  assert.match(sql, /store_id = p_store_id and franchise_id = p_franchise_id[\s\S]*for update/);
  assert.match(sql, /current_manual.updated_at is distinct from p_expected_updated_at/);
  assert.match(sql, /current_manual.status <> 'approved'/);
  assert.match(sql, /delete from public.manual_chunks[\s\S]*insert into public.manual_chunks/);
  assert.match(sql, /before update on public.manuals/);
  assert.equal(sql.includes("exception when"), false);
  assert.match(sql, /from public, anon, authenticated/);
});

test("indexing a saved revision rejects a newer manual before any embedding call", async () => {
  const db = fake();
  await assert.rejects(indexApprovedManual(manualId, db.client, async () => assert.fail("no paid call"), "2026-10-03T00:00:00.000Z"), /MANUAL_INDEX_CONFLICT/);
  assert.equal(db.inspect().publishes, 0);
});

test("missing DB contract blocks indexing before reads, embedding and chunk publication", async () => {
  const db = fake(undefined, false);
  await assert.rejects(indexApprovedManual(manualId, db.client, async () => assert.fail("no external call")), /기능 준비 중/);
  assert.deepEqual(db.inspect(), { chunks: ["old 0", "old 1", "old 2"], publishes: 0 });
});