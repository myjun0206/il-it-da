import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AnalyzedManualGroup } from "../../lib/manuals/analyze-manual-with-ai.ts";
import { buildConfirmedManualsPayload, buildManualPreview } from "../../lib/manuals/build-manual-preview.ts";
import { parseConfirmedManualGroups } from "../../lib/manuals/parse-confirmed-manual-groups.ts";
import {
  MAX_CONFIRM_ITEM_CONTENT_LENGTH,
  MAX_CONFIRM_MANUAL_COUNT,
  MAX_CONFIRM_TITLE_LENGTH,
} from "../../lib/manuals/upload-limits.ts";
import { saveManualGroupsWithChunks } from "../../lib/rag/save-manual-sections.ts";

// Executes the real preview -> confirm-payload -> server parse -> save pipeline with a fake
// Supabase client; nothing here touches a real database or embedding API.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readMCoffeeGroups(): AnalyzedManualGroup[] {
  const taxonomy = JSON.parse(
    readFileSync(path.join(repoRoot, "tests/fixtures/manual-categories/m-coffee-common-taxonomy.json"), "utf8"),
  ) as { categories: { label: string; manualTitles: string[] }[] };
  return taxonomy.categories.flatMap((category) =>
    category.manualTitles.map((title) => ({
      category: category.label,
      topic: title,
      items: [`${title} 1단계`, `${title} 2단계`],
    })),
  );
}

type InsertedRow = Record<string, unknown> & { id: string };

function fakeSaveClient(options: { failParentInsert?: boolean } = {}) {
  const manualRows: InsertedRow[] = [];
  const chunkRows: { manual_id: string }[] = [];
  let sequence = 0;

  const client = {
    from(table: string) {
      if (table === "manuals") {
        return {
          insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
            const isParent = !Array.isArray(payload);
            const rows = (isParent ? [payload] : payload).map((row) => ({ ...row, id: `row-${++sequence}` }));
            const failed = isParent && options.failParentInsert;
            if (!failed) {
              manualRows.push(...rows);
            }
            const result = failed
              ? {
                  data: null,
                  error: { message: "duplicate key 3f2a9c1e-0000-4000-8000-000000000000 owner@example.com", code: "23505" },
                }
              : { data: rows, error: null };
            return {
              select() {
                return {
                  single: () => Promise.resolve(failed ? result : { data: rows[0], error: null }),
                  then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
                    Promise.resolve(result).then(resolve, reject),
                };
              },
            };
          },
        };
      }
      if (table === "manual_chunks") {
        return {
          insert(rows: { manual_id: string }[]) {
            chunkRows.push(...rows);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`Unexpected table in fake Supabase client: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { client, manualRows, chunkRows };
}

const hqAuth = { userId: "hq-user", franchiseId: "franchise-hq", brandName: "M Coffee" };
const storeAuth = { userId: "owner-user", storeId: "store-1", franchiseId: "franchise-store", brandName: "M Coffee" };

let consoleErrors: unknown[][] = [];
const originalConsoleError = console.error;

beforeEach(() => {
  consoleErrors = [];
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args);
  };
});

afterEach(() => {
  console.error = originalConsoleError;
});

describe("preview -> confirm payload -> parseConfirmedManualGroups (real functions)", () => {
  test("19 M Coffee detail manuals round-trip as 19 separate groups with every item preserved", () => {
    const groups = readMCoffeeGroups();
    const preview = buildManualPreview(groups);
    const parsed = parseConfirmedManualGroups(buildConfirmedManualsPayload(preview, {}, {}));

    assert.equal(parsed?.length, 19);
    assert.deepEqual(
      parsed?.map((group) => [group.topic, group.items]),
      groups.map((group) => [group.topic, group.items]),
    );
  });

  test("a renamed category is applied to every manual in it, and a moved manual takes its new category", () => {
    const preview = buildManualPreview(readMCoffeeGroups());
    const [firstCategory, secondCategory] = preview.categories;
    const categoryLabels = Object.fromEntries(preview.categories.map((c) => [c.tempId, c.label]));
    categoryLabels[firstCategory.tempId] = "  새 이름  ";

    const moved = preview.manuals.find((m) => m.topCategoryTempId === secondCategory.tempId);
    assert.ok(moved);
    const manualEdits = { [moved.tempId]: { topCategoryTempId: firstCategory.tempId } };

    const parsed = parseConfirmedManualGroups(buildConfirmedManualsPayload(preview, categoryLabels, manualEdits));
    const expectedInFirst = preview.manuals.filter(
      (m) => m.topCategoryTempId === firstCategory.tempId || m.tempId === moved.tempId,
    );

    assert.deepEqual(
      parsed?.filter((g) => g.category === "새 이름").map((g) => g.topic),
      expectedInFirst.map((m) => m.title),
    );
  });

  test("excluded manuals are dropped server-side and an all-excluded payload yields null (no save call)", () => {
    const preview = buildManualPreview(readMCoffeeGroups());
    const [kept, ...rest] = preview.manuals;
    const edits = Object.fromEntries(rest.map((m) => [m.tempId, { excluded: true }]));

    const parsed = parseConfirmedManualGroups(buildConfirmedManualsPayload(preview, {}, edits));
    assert.deepEqual(parsed?.map((g) => g.topic), [kept.title]);

    const allExcluded = Object.fromEntries(preview.manuals.map((m) => [m.tempId, { excluded: true }]));
    assert.equal(parseConfirmedManualGroups(buildConfirmedManualsPayload(preview, {}, allExcluded)), null);
  });

  test("the payload carries no tempId/scopeType/classification - only title/label/items/excluded", () => {
    const preview = buildManualPreview(readMCoffeeGroups(), { storeId: "store-1" });
    const [first] = buildConfirmedManualsPayload(preview, {}, {});
    assert.deepEqual(Object.keys(first).sort(), ["excluded", "items", "title", "topCategoryLabel"]);
  });

  test("an unclassifiable manual is saved under the user-facing label, never the internal 'unclassified' key", () => {
    const preview = buildManualPreview([{ category: "", topic: "알 수 없는 문서", items: ["본문"] }]);
    const parsed = parseConfirmedManualGroups(buildConfirmedManualsPayload(preview, {}, {}));
    assert.equal(parsed?.[0].category, "분류 확인 필요");

    const forged = parseConfirmedManualGroups([
      { title: "t", topCategoryLabel: "UNCLASSIFIED", items: [{ content: "x" }] },
    ]);
    assert.equal(forged?.[0].category, "분류 확인 필요");
  });

  test("rejects empty title, empty category and empty content", () => {
    const valid = { title: "t", topCategoryLabel: "c", items: [{ content: "x" }] };
    assert.equal(parseConfirmedManualGroups([{ ...valid, title: "" }]), null);
    assert.equal(parseConfirmedManualGroups([{ ...valid, topCategoryLabel: "   " }]), null);
    assert.equal(parseConfirmedManualGroups([{ ...valid, items: [{ content: "" }] }]), null);
    assert.equal(parseConfirmedManualGroups([]), null);
  });

  test("rejects oversized payloads (manual count, title length, item content length)", () => {
    const valid = { title: "t", topCategoryLabel: "c", items: [{ content: "x" }] };
    assert.equal(parseConfirmedManualGroups(Array.from({ length: MAX_CONFIRM_MANUAL_COUNT + 1 }, () => valid)), null);
    assert.equal(parseConfirmedManualGroups([{ ...valid, title: "a".repeat(MAX_CONFIRM_TITLE_LENGTH + 1) }]), null);
    assert.equal(
      parseConfirmedManualGroups([{ ...valid, items: [{ content: "a".repeat(MAX_CONFIRM_ITEM_CONTENT_LENGTH + 1) }] }]),
      null,
    );
  });
});

describe("saveManualGroupsWithChunks contract used by both confirm routes (fake Supabase)", () => {
  const groups = [{ category: "오픈 및 마감", topic: "오픈 운영", items: ["불 켜기", "포스 켜기"] }];

  test("HQ save (no storeId) is forced to scope_type hq with store_id null and the auth franchise", async () => {
    const { client, manualRows } = fakeSaveClient();
    await saveManualGroupsWithChunks(client, hqAuth, groups, undefined, async () => undefined);

    assert.equal(manualRows.length, 3);
    for (const row of manualRows) {
      assert.equal(row.scope_type, "hq");
      assert.equal(row.store_id, null);
      assert.equal(row.franchise_id, "franchise-hq");
      assert.equal(row.category, "오픈 및 마감");
    }
  });

  test("store save is forced to scope_type store with the verified storeId and the store's franchise", async () => {
    const { client, manualRows } = fakeSaveClient();
    await saveManualGroupsWithChunks(client, storeAuth, groups, storeAuth.storeId, async () => undefined);

    for (const row of manualRows) {
      assert.equal(row.scope_type, "store");
      assert.equal(row.store_id, "store-1");
      assert.equal(row.franchise_id, "franchise-store");
      assert.equal(row.category, "오픈 및 마감");
    }
  });

  test("only children are chunked and embedded; the parent card is never chunked", async () => {
    const { client, manualRows, chunkRows } = fakeSaveClient();
    const indexed: string[] = [];
    await saveManualGroupsWithChunks(client, hqAuth, groups, undefined, async (id) => {
      indexed.push(id);
    });

    const parent = manualRows.find((row) => row.parent_manual_id === null);
    const children = manualRows.filter((row) => row.parent_manual_id === parent?.id);
    assert.equal(children.length, 2);
    assert.deepEqual([...new Set(chunkRows.map((row) => row.manual_id))], children.map((c) => c.id));
    assert.deepEqual(indexed, children.map((c) => c.id));
  });

  test("one child's embedding failure does not stop the others and is logged without its message", async () => {
    const { client, manualRows } = fakeSaveClient();
    const indexed: string[] = [];
    let calls = 0;
    const saved = await saveManualGroupsWithChunks(client, hqAuth, groups, undefined, async (id) => {
      calls += 1;
      if (calls === 1) throw new Error("embedding failed for owner@example.com");
      indexed.push(id);
    });

    assert.equal(saved.length, manualRows.length);
    assert.equal(indexed.length, 1);
    assert.equal(JSON.stringify(consoleErrors).includes("owner@example.com"), false);
  });

  test("a DB insert error surfaces only a fixed Korean message - no raw DB text, UUID or email", async () => {
    const { client, manualRows } = fakeSaveClient({ failParentInsert: true });
    await assert.rejects(
      saveManualGroupsWithChunks(client, hqAuth, groups, undefined, async () => undefined),
      (error: unknown) => error instanceof Error && error.message === "매뉴얼 주제 저장 중 오류가 발생했습니다.",
    );
    assert.equal(manualRows.length, 0);
    const logged = JSON.stringify(consoleErrors);
    assert.equal(logged.includes("owner@example.com"), false);
    assert.equal(logged.includes("3f2a9c1e"), false);
  });
});
