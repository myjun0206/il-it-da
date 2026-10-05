import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireManualWriteContract, sameManualRevision } from "../../lib/manuals/manual-write-contract.ts";
import { saveManualGroupsWithBatchGuard } from "../../lib/manuals/save-manuals-with-batch.ts";
import { manualSaveResult, manualSaveMessage } from "../../lib/manuals/manual-save-result.ts";
import type { ManualRecord } from "../../lib/types/manual.ts";
import { indexSavedManuals } from "../../lib/manuals/index-saved-manuals.ts";

test("preparation checks are read-only, versioned and never cached across operations", async () => {
  let count = 0;
  const client = { from: () => assert.fail("no writes"), rpc: async (name: string) => {
    assert.equal(name, "check_manual_write_contract"); count++; return { data: 2, error: null };
  } } as unknown as SupabaseClient;
  await requireManualWriteContract(client); await requireManualWriteContract(client);
  assert.equal(count, 2);
});

test("wrong contract, DB failure and missing RPC block uploads before batch or manual writes and embedding", async () => {
  for (const data of [null, 1, "2", true]) {
    const client = { from: () => assert.fail("no batch/manual writes"), rpc: async () => ({ data, error: null }) } as unknown as SupabaseClient;
    const result = await saveManualGroupsWithBatchGuard(client, {
      auth: { userId: "hq", franchiseId: "brand", brandName: "brand" },
      groups: [{ topic: "title", category: "category", items: ["text"] }],
      scope: { scopeType: "hq", franchiseId: "brand", storeId: null },
      indexManual: async () => assert.fail("no embedding"),
    });
    assert.equal(result.kind, "blocked");
    if (result.kind === "blocked") { assert.equal(result.status, 503); assert.match(result.error, /기능 준비 중/); }
  }
  const client = { rpc: async () => { throw new Error("secret DB error"); } } as unknown as SupabaseClient;
  await assert.rejects(requireManualWriteContract(client), (error: unknown) => {
    assert.equal(String(error).includes("secret"), false); return true;
  });
});

test("time zone normalization preserves microsecond conflicts", () => {
  assert.equal(sameManualRevision("2026-10-04T00:00:00.123456Z", "2026-10-04T09:00:00.123456+09:00"), true);
  assert.equal(sameManualRevision("2026-10-04T00:00:00.123456Z", "2026-10-04T00:00:00.123457Z"), false);
  assert.equal(sameManualRevision("invalid", "invalid"), false);
});

test("partial indexing and uncertain replay are explicit and never mean resolved questions", () => {
  const rows = [{ id: "a", search_status: "ready" }, { id: "b", search_status: "failed" }] as ManualRecord[];
  const result = manualSaveResult(rows);
  assert.equal(result.saveStatus, "saved"); assert.equal(result.searchStatus, "incomplete");
  assert.equal(result.searchResults[1].status, "failed");
  assert.match(manualSaveMessage(result), /실패/);
  assert.equal(manualSaveResult([{ id: "replayed" } as ManualRecord]).searchStatus, "incomplete");
});

test("SQL version2 checks active trigger, privileges, signature and full search scope", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/037_owner_manual_safe_edit.sql", import.meta.url), "utf8");
  for (const term of ["check_manual_write_contract", "proargnames", "has_function_privilege", "tgenabled", "tgtype = 19", "tgtype = 23", "invalidate_manual_parent_chunks", "TRIGGER_NAME_CONFLICT", "drop trigger if exists", "current_manual.scope_type", "current_manual.parent_manual_id", "pg_catalog, extensions"]) assert.ok(sql.includes(term), term);
});

test("HQ/bulk indexing returns per-item failure, skips parent/draft and passes saved revisions", async () => {
  const client = { from: () => ({ select: () => ({ in: async () => ({ data: [{ parent_manual_id: "parent" }], error: null }) }) }) } as unknown as SupabaseClient;
  const rows = [
    { id: "parent", status: "approved", updated_at: "r1" }, { id: "draft", status: "draft", updated_at: "r2" },
    { id: "ok", status: "approved", updated_at: "r3" }, { id: "failed", status: "approved", updated_at: "r4" },
  ] as ManualRecord[];
  const calls: string[] = [];
  const result = await indexSavedManuals(rows, { client, contractVersion: 2 }, async (id, revision) => {
    calls.push(id); assert.equal(revision, id === "ok" ? "r3" : "r4");
    if (id === "failed") throw new Error("fake embedding failure");
    return { manualId: id, chunkCount: 1 };
  });
  assert.deepEqual(calls, ["ok", "failed"]);
  assert.deepEqual(result.searchResults.map((item) => item.status), ["parent_only", "not_searchable", "ready", "failed"]);
  assert.equal(result.searchStatus, "incomplete");
});

test("hierarchy guards include scope-only changes, descendants, cycles and lock-before-row ordering", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/037_owner_manual_safe_edit.sql", import.meta.url), "utf8");
  assert.match(sql, /update of parent_manual_id,store_id,franchise_id,scope_type/);
  assert.match(sql, /where parent_manual_id = new.id loop/);
  assert.match(sql, /ancestor_id = any\(visited_ids\)/);
  assert.match(sql, /PARENT_CYCLE/);
  assert.match(sql, /CHILD_SCOPE_DENIED/);
  assert.match(sql, /or coalesce\(\(new.store_id is null/);
  assert.match(sql, /or coalesce\(\(parent_row.store_id is null/);
  assert.match(sql, /lower\(parent_row.scope_type\) in \('hq','common','shared'\)/);
  assert.match(sql, /for each statement execute function public.lock_manual_hierarchy_write/);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*?select \* into current_manual/);
  assert.match(sql, /indisunique and indisvalid and indisready and indimmediate/);
  assert.match(sql, /indpred is null and indexprs is null and indnkeyatts = 2/);
});

test("shared inspection SQL reads catalog metadata only and omits bodies and trigger arguments", () => {
  const sql = readFileSync(new URL("../../docs/sql/owner-manual-schema-inspection.readonly.sql", import.meta.url), "utf8");
  assert.match(sql, /^begin read only;/);
  assert.equal(/\b(from|join)\s+public\./i.test(sql), false);
  for (const forbidden of ["pg_get_functiondef", "prosrc", "tgargs", "pg_get_triggerdef", "rolpassword"]) assert.equal(sql.includes(forbidden), false, forbidden);
  assert.match(sql, /<arguments omitted>/);
  assert.match(sql, /redacted_definition/);
});

test("disposable runner has bounded retries and cleanup ownership without claiming embedding generation", () => {
  const source = readFileSync(new URL("../../scripts/verify-manual-postgres.mjs", import.meta.url), "utf8");
  for (const term of ["--host", "--network", "--rm", "ilitda.manual-test-owner", "if (created)", "actual === ownership", "retryDelay", "Date.now() < deadline", "no embedding generator run", "unchanged parent ID", "parents with children", "indirect cycles", "parent relationship change", "equivalent unique index"]) assert.ok(source.includes(term), term);
  assert.equal(source.includes("rm\", \"--force\", \"--volumes"), false);
});