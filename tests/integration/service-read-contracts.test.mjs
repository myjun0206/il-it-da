import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadRoute(file, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const routeModule = { exports: {} };
  new Script(code).runInNewContext({ module: routeModule, exports: routeModule.exports, console: { error() {}, info() {} },
    require: name => name === "next/server" ? require("next/server.js") : dependencies[name] ?? assert.fail(`unmocked ${name}`),
  });
  return routeModule.exports;
}
function clientFor(tables, failCount = false) {
  return { from(table) {
    const filters = [], query = {
      select(_columns, options = {}) { query.count = options.count; query.head = options.head; return query; },
      eq(field, value) { filters.push(row => row[field] === value); return query; },
      is(field, value) { return query.eq(field, value); },
      in(field, values) { filters.push(row => values.includes(row[field])); return query; },
      neq(field, value) { filters.push(row => row[field] !== value); return query; },
      order() { return query; }, limit(value) { query.max = value; return query; },
      result() { const rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row))); return { data: query.head ? null : rows.slice(0, query.max ?? rows.length), count: rows.length, error: failCount && query.count ? { code: "FIXTURE_COUNT_FAILED" } : null }; },
      maybeSingle: async () => { const result = query.result(); return { ...result, data: result.data[0] ?? null }; },
      then(resolve) { return Promise.resolve(query.result()).then(resolve); },
    }; return query;
  } };
}

test("notification totals are user-scoped, filter-independent and distinct from returned page size", async () => {
  const rows = [{ id: "a", recipient_user_id: "me", is_read: false }, { id: "b", recipient_user_id: "me", is_read: false },
    { id: "c", recipient_user_id: "me", is_read: true }, { id: "foreign", recipient_user_id: "other", is_read: false }];
  const route = loadRoute("app/api/notifications/route.ts", {
    "@/lib/supabase/admin": { createAdminClient: () => clientFor({ notifications: rows }) },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "me" } }, error: null }) } }) },
  });
  for (const includeRead of [true, false]) {
    const response = await route.GET({ nextUrl: new URL(`http://localhost/api/notifications?limit=1&includeRead=${includeRead}`) });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.totalCount, 3); assert.equal(data.unreadCount, 2); assert.equal(data.filteredCount, includeRead ? 3 : 2);
    assert.equal(data.returnedCount, 1); assert.equal(data.hasMore, true); assert.equal(data.notifications[0].recipientUserId, "me");
  }
  rows[0].is_read = true;
  const body = await (await route.GET({ nextUrl: new URL("http://localhost/api/notifications?limit=20&includeRead=false") })).json();
  assert.equal(body.data.totalCount, 3); assert.equal(body.data.unreadCount, 1); assert.equal(body.data.returnedCount, 1); assert.equal(body.data.hasMore, false);
  const invalid = await route.GET({ nextUrl: new URL("http://localhost/api/notifications?limit=NaN") }); assert.equal(invalid.status, 400);
});

test("notification count failures are not converted into zero-count success", async () => {
  const route = loadRoute("app/api/notifications/route.ts", {
    "@/lib/supabase/admin": { createAdminClient: () => clientFor({ notifications: [] }, true) },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "me" } }, error: null }) } }) },
  });
  assert.equal((await route.GET({ nextUrl: new URL("http://localhost/api/notifications") })).status, 500);
});

test("HQ store summaries and detail share valid canonical owners, retain unnamed profiles and exclude missing ones", async () => {
  const tables = {
    stores: [{ id: "store", franchise_id: "brand", store_name: "fixture store" }, { id: "foreign", franchise_id: "other", store_name: "other" }],
    store_memberships: [{ id: "one", store_id: "store", user_id: "valid", role: "owner", status: "approved" },
      { id: "two", store_id: "store", user_id: "unnamed", role: "owner", status: "approved" },
      { id: "ghost", store_id: "store", user_id: "deleted", role: "owner", status: "approved" }],
    profiles: [{ id: "independent", user_id: "valid", full_name: "현재 이름", brand_id: null }, { id: "different", user_id: "unnamed", full_name: null, brand_id: null }],
    manuals: [],
  };
  const deps = { "@/lib/supabase/admin": { createAdminClient: () => clientFor(tables) },
    "@/lib/supabase/hq-auth": { requireHqUser: async () => ({ franchiseId: "brand" }) },
    "@/lib/manuals/constants": { STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT: "placeholder" } };
  const summary = await (await loadRoute("app/api/hq/stores/route.ts", deps).GET()).json();
  assert.equal(summary.stores.length, 1); assert.deepEqual(summary.stores[0].ownerNames, ["현재 이름", "이름 미등록"]);
  const detail = loadRoute("app/api/hq/stores/[id]/members/route.ts", deps);
  const result = await (await detail.GET({}, { params: Promise.resolve({ id: "store" }) })).json();
  assert.equal(result.members.length, 2); assert.equal(result.members.some(row => row.userId === "deleted"), false);
  assert.equal((await detail.GET({}, { params: Promise.resolve({ id: "foreign" }) })).status, 404);
});

test("manual list latest-request guard protects deletion refresh and existing grouping and URL detail", () => {
  const source = readFileSync(new URL("../../app/boss/store-manuals/page.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("sequence !== manualRequestSequence.current"));
  for (const retained of ["groupByParent", "parent_manual_id", "manualId", "selectedCategoryName", "searchRetryManualIds"]) assert.ok(source.includes(retained));
  assert.equal(source.includes(".push(...manuals)"), false);
});