import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveStoreManualEdit } from "../../lib/manuals/save-store-manual-edit.ts";

const input = { userId: "owner", storeId: "store", manualId: "manual", content: "새 본문", expectedUpdatedAt: "2026-10-04T01:00:00.000Z" };
function fake(options: { denied?: boolean; error?: string; status?: string; parent?: boolean } = {}) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(table);
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: options.denied ? null
          : table === "stores" ? { franchise_id: "brand" }
          : table === "franchises" ? { id: "brand", name: "브랜드" } : { id: "membership" }, error: null }),
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "check_manual_write_contract") return { data: 2, error: null };
      calls.push(name);
      assert.equal(args.p_user_id, "owner");
      assert.equal(args.p_store_id, "store");
      assert.equal(args.p_franchise_id, "brand");
      assert.deepEqual(args.p_update, { content: "새 본문" });
      return { data: options.error ? null : { manual: { id: "manual", status: options.status ?? "approved", updated_at: "2026-10-04T01:01:00.000Z" }, hasChildren: !!options.parent },
        error: options.error ? { code: options.error } : null };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

test("store edit saves separately from indexing and never changes question status", async () => {
  for (const failIndex of [false, true]) {
    const { client, calls } = fake();
    const result = await saveStoreManualEdit(client, input, async (manualId, revision) => {
      assert.equal(manualId, "manual");
      assert.equal(revision, "2026-10-04T01:01:00.000Z");
      if (failIndex) throw new Error("fake");
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.searchStatus, failIndex ? "failed" : "ready");
    assert.equal(calls.includes("question_logs"), false);
    assert.equal(calls.includes("manual_chunks"), false);
  }
});

test("draft and parent edits are not indexed or advertised as searchable", async () => {
  for (const options of [{ status: "draft" }, { parent: true }]) {
    const { client } = fake(options);
    const result = await saveStoreManualEdit(client, input, async () => { assert.fail("must not index"); });
    assert.equal(result.body.searchStatus, options.parent ? "parent_only" : "not_searchable");
  }
});

test("bad input, missing revision and denied owner never reach a write", async () => {
  for (const change of [{ content: " " }, { expectedUpdatedAt: undefined }]) {
    const { client, calls } = fake();
    const result = await saveStoreManualEdit(client, { ...input, ...change }, async () => assert.fail());
    assert.ok([400, 409].includes(result.status));
    assert.deepEqual(calls, []);
  }
  const { client, calls } = fake({ denied: true });
  assert.equal((await saveStoreManualEdit(client, input, async () => assert.fail())).status, 403);
  assert.equal(calls.includes("edit_store_manual_if_current"), false);
});

test("conflict, HQ/out-of-scope, missing migration and DB failure are not save success", async () => {
  for (const [code, status] of [["40001", 409], ["P0002", 404], ["42501", 404], ["PGRST202", 503], ["42883", 503], ["XX000", 500]] as const) {
    const { client } = fake({ error: code });
    const result = await saveStoreManualEdit(client, input, async () => assert.fail("must not index"));
    assert.equal(result.status, status);
    assert.equal(result.body.manual, undefined);
  }
});