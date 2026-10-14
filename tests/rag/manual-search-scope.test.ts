import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { describe, test } from "node:test";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

// 실제 Postgres/pgvector가 없는 이 테스트 스위트에서는 SQL을 실행할 수 없으므로,
// 018 migration의 텍스트 계약(파라미터, 허용 범위 WHERE 절, DEFINER 미사용)만 정적으로 검증한다.
// 실제 필터링 동작 자체는 실 DB에서 별도로 확인해야 한다(최종 보고의 blocker 참고).
describe("018_scoped_hybrid_manual_search.sql (static contract)", () => {
  const sql = readSource("supabase/migrations/018_scoped_hybrid_manual_search.sql");

  test("defines match_manual_chunks_hybrid_scoped with target_store_id and target_franchise_id", () => {
    assert.match(sql, /create or replace function public\.match_manual_chunks_hybrid_scoped/);
    assert.match(sql, /target_store_id uuid/);
    assert.match(sql, /target_franchise_id uuid/);
  });

  test("restricts results to the target store's own manuals or the same-franchise HQ common manuals", () => {
    assert.match(sql, /m\.scope_type = 'store' and m\.store_id = target_store_id/);
    assert.match(
      sql,
      /m\.scope_type = 'hq' and m\.store_id is null and m\.franchise_id = target_franchise_id/,
    );
  });

  test("only ever selects approved manuals with a non-null embedding", () => {
    assert.match(sql, /m\.status = 'approved'/);
    assert.match(sql, /mc\.embedding is not null/);
  });

  test("does not use SECURITY DEFINER or dynamic SQL string concatenation", () => {
    const codeOnly = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    assert.equal(/security\s+definer/i.test(codeOnly), false);
    assert.equal(/execute\s+format/i.test(codeOnly), false);
    assert.equal(/execute\s+'/i.test(codeOnly), false);
  });

  test("preserves the existing hybrid keyword_boost/similarity_score columns and computation", () => {
    assert.match(sql, /keyword_boost/);
    assert.match(sql, /raw_similarity_score/);
    assert.match(sql, /similarity_score/);
    assert.match(sql, /greatest\(0\.60, scored\.raw_similarity_score \+ scored\.keyword_boost\)/);
  });

  test("does not modify the existing 003/005/010 hybrid search functions", () => {
    const hybrid003 = readSource("supabase/migrations/003_hybrid_manual_search.sql");
    const hybrid005 = readSource("supabase/migrations/005_store_scoped_hybrid_search.sql");
    const hqManuals010 = readSource("supabase/migrations/010_franchises_and_hq_manuals.sql");

    assert.match(hybrid003, /create or replace function public\.match_manual_chunks_hybrid\(/);
    assert.match(hybrid005, /create or replace function public\.match_manual_chunks_hybrid_by_store\(/);
    assert.match(hqManuals010, /create function public\.match_manual_chunks\(/);
  });
});

describe("lib/rag/search-manual-chunks.ts (static contract)", () => {
  const source = readSource("lib/rag/search-manual-chunks.ts");

  test("calls the new scoped RPC, not the old store-only RPC", () => {
    assert.match(source, /"match_manual_chunks_hybrid_scoped"/);
    assert.equal(source.includes("match_manual_chunks_hybrid_by_store"), false);
  });

  test("passes only target_store_id and target_franchise_id as the scope parameters", () => {
    assert.match(source, /target_store_id:\s*storeId/);
    assert.match(source, /target_franchise_id:\s*franchiseId/);
  });
});

test("closing-order lexical recall returns only approved store/same-brand phrase rows and ranks them with the request embedding", async () => {
  const searchSource = readSource("lib/rag/search-manual-chunks.ts");
  const compiled = ts.transpileModule(searchSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const require = createRequire(import.meta.url);
  const queryEmbedding = [1, ...Array(1535).fill(0)];
  const currentStore = { id: "soongsil-store-manual", title: "매장 운영 기준", category: "매장운영" };
  const hqManual = { id: "soongsil-hq-manual", title: "매장 운영 기준", category: "매장운영" };
  const foreignStore = { id: "foreign-store-manual", title: "매장 운영 기준", category: "매장운영" };
  const locationRow = { id: "soongsil-closing-order-row", manual_id: currentStore.id,
    content: "- 마감시간 전 마지막 주문 여부는 POS에 표시된 주문 상태를 확인하고, 애매한 경우 담당자에게 확인한다.",
    embedding: JSON.stringify(queryEmbedding) };
  const rpcMatches = Array.from({ length: 10 }, (_, index) => ({ chunk_id: `rpc-${index}`, manual_id: `rpc-manual-${index}`,
    title: "마감 운영", category: "매장운영", content: `마감 전 일반 정리 안내 ${index}`,
    raw_similarity_score: .4 + index / 100, keyword_boost: .25, similarity_score: .65 + index / 100 }));
  const manualQueries: Array<{ scope_type?: unknown; store_id?: unknown; franchise_id?: unknown }> = [];
  const chunkManualIds: string[][] = [];
  const fakeDatabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "match_manual_chunks_hybrid_scoped");
      assert.equal(args.match_count, 10);
      assert.equal(args.target_store_id, "soongsil-store");
      assert.equal(args.target_franchise_id, "soongsil-brand");
      return { data: rpcMatches, error: null };
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (key: string, value: unknown) => { filters[key] = value; return builder; },
        is: (key: string, value: unknown) => { filters[key] = value; return builder; },
        not: () => builder,
        in: (_key: string, ids: string[]) => { chunkManualIds.push(ids); return builder; },
        then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
          if (table === "manuals") {
            manualQueries.push({ scope_type: filters.scope_type, store_id: filters.store_id, franchise_id: filters.franchise_id });
            const rows = filters.scope_type === "store"
              ? filters.store_id === "soongsil-store" ? [currentStore] : [foreignStore]
              : filters.franchise_id === "soongsil-brand" ? [hqManual] : [];
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          }
          assert.equal(table, "manual_chunks");
          assert.equal(JSON.stringify(Array.from(chunkManualIds.at(-1) ?? [])), JSON.stringify([currentStore.id, hqManual.id]));
          return Promise.resolve({ data: [locationRow], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    "@/lib/supabase/admin": { createAdminClient: () => fakeDatabase },
    "@/lib/rag/openai-embeddings": { createEmbedding: async () => queryEmbedding },
    "@/lib/rag/search-query": require("../../lib/rag/search-query.ts"),
    "@/lib/rag/structured-answer": require("../../lib/rag/structured-answer.ts"),
  };
  const loaded = { exports: {} as Record<string, unknown> };
  new Script(compiled, { filename: "manual-search-closing-order.cjs" }).runInNewContext({
    module: loaded, exports: loaded.exports,
    require: (name: string) => { assert.ok(Object.hasOwn(dependencies, name), `Unmocked dependency: ${name}`); return dependencies[name]; },
    console: { info: () => {}, error: () => {} },
  });
  const search = loaded.exports.searchManualChunks as (question: string, storeId: string, franchiseId: string) => Promise<{
    chunk_id: string; manual_id: string; content: string; raw_similarity_score: number; similarity_score: number;
  }[]>;
  const question = "마감 직전에 주문이 들어왔는데 받아도 돼요?";
  const result = await search(question, "soongsil-store", "soongsil-brand");
  assert.equal(result.length, 11);
  assert.equal(result.filter(item => item.chunk_id === locationRow.id).length, 1);
  assert.equal(result[0].chunk_id, locationRow.id);
  assert.equal(result[0].raw_similarity_score, 1);
  assert.ok(manualQueries.some(query => query.scope_type === "store" && query.store_id === "soongsil-store"));
  assert.ok(manualQueries.some(query => query.scope_type === "hq" && query.store_id === null && query.franchise_id === "soongsil-brand"));

  const ordinary = await search("오늘 마감 순서 알려줘", "soongsil-store", "soongsil-brand");
  assert.equal(ordinary.length, 10);
  assert.equal(chunkManualIds.length, 1);
});

test("near-close recall supplements only exact approved store-scope rows with same-query cosine ranking", async () => {
  const source = readSource("lib/rag/search-manual-chunks.ts");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const require = createRequire(import.meta.url);
  const embedding = Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0);
  const phrase = "마감시간 전 마지막 주문 여부는 POS에 표시된 주문 상태를 확인하고, 애매한 경우 담당자에게 확인한다.";
  const storeManual = { id: "soongsil-manual", title: "매장 운영 기준", category: "매장운영" };
  const hqManual = { id: "hq-manual", title: "주문·결제 처리", category: "매장운영" };
  const row = { id: "soongsil-closing", manual_id: storeManual.id, content: `- ${phrase}`, embedding: JSON.stringify(embedding) };
  const rpcRows = Array.from({ length: 10 }, (_, index) => ({ chunk_id: `rpc-${index}`, manual_id: `manual-${index}`,
    title: "일반 안내", category: "매장운영", content: `무관한 일반 마감 안내 ${index}`,
    raw_similarity_score: .6 - index / 100, keyword_boost: .2, similarity_score: .8 - index / 100 }));
  const manualQueries: Array<{ scope_type?: unknown; store_id?: unknown; franchise_id?: unknown }> = [];
  const chunkQueries: { manualIds: string[] }[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "match_manual_chunks_hybrid_scoped");
      assert.equal(args.target_store_id, "soongsil-store"); assert.equal(args.target_franchise_id, "soongsil-brand");
      assert.equal(args.match_count, 10);
      return { data: rpcRows, error: null };
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (key: string, value: unknown) => { filters[key] = value; return builder; },
        is: (key: string, value: unknown) => { filters[key] = value; return builder; },
        in: (_key: string, values: string[]) => { chunkQueries.push({ manualIds: values }); filters.manualIds = values; return builder; },
        not: () => builder,
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
          if (table === "manuals") {
            manualQueries.push({ scope_type: filters.scope_type, store_id: filters.store_id, franchise_id: filters.franchise_id });
            const manuals = filters.scope_type === "store" ? [storeManual] : [hqManual];
            return Promise.resolve({ data: manuals, error: null }).then(resolve, reject);
          }
          assert.equal(table, "manual_chunks");
          assert.deepEqual(Array.from(filters.manualIds as string[]), [storeManual.id, hqManual.id]);
          return Promise.resolve({ data: [row], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/rag/openai-embeddings": { createEmbedding: async (input: string) => {
      assert.ok(input.includes("마감 직전에 주문이 들어왔는데 받아도 돼요?"));
      return embedding;
    } },
    "@/lib/rag/search-query": require("../../lib/rag/search-query.ts"),
    "@/lib/rag/structured-answer": require("../../lib/rag/structured-answer.ts"),
  };
  const loaded = { exports: {} as Record<string, (...args: unknown[]) => Promise<unknown>> };
  new Script(compiled, { filename: "scoped-manual-search.cjs" }).runInNewContext({
    module: loaded, exports: loaded.exports,
    require: (name: string) => { assert.ok(Object.hasOwn(dependencies, name), `Unmocked dependency: ${name}`); return dependencies[name]; },
    console: { info: () => {}, error: () => {} },
  });
  const search = loaded.exports.searchManualChunks as (question: string, storeId: string, brandId: string, count?: number) => Promise<{
    chunk_id: string; manual_id: string; content: string; raw_similarity_score: number; keyword_boost: number;
  }[]>;
  const result = await search("마감 직전에 주문이 들어왔는데 받아도 돼요?", "soongsil-store", "soongsil-brand");
  const supplement = result.filter(candidate => candidate.chunk_id === row.id);
  assert.equal(result.length, 11);
  assert.equal(supplement.length, 1);
  assert.equal(supplement[0].manual_id, storeManual.id);
  assert.equal(supplement[0].raw_similarity_score, 1);
  assert.equal(supplement[0].keyword_boost, .2);
  assert.ok(manualQueries.some(query => query.scope_type === "store" && query.store_id === "soongsil-store"));
  assert.ok(manualQueries.some(query => query.scope_type === "hq" && query.store_id === null && query.franchise_id === "soongsil-brand"));
  assert.equal(chunkQueries.length, 1);
  assert.equal(JSON.stringify(Array.from(chunkQueries[0].manualIds)), JSON.stringify([storeManual.id, hqManual.id]));
});

describe("app/api/rag/query/route.ts (static contract)", () => {
  const source = readSource("app/api/rag/query/route.ts");

  test("resolves franchise scope from the server, never from the request body", () => {
    assert.match(source, /resolveRagStoreFranchiseForRequest\(storeId\)/);
    // The only "franchiseId"-shaped identifier in this route must be the server-resolved
    // franchiseScope.franchiseId; nothing should read a client-supplied body/query franchiseId.
    assert.equal(source.includes("body.franchiseId"), false);
    assert.equal(source.includes("validation.data.franchiseId"), false);
    assert.match(source, /franchiseScope\.franchiseId/);
  });

  test("checks UNAUTHENTICATED/FORBIDDEN before any search/embedding/OpenAI call", () => {
    const authIndex = source.indexOf('authorization.status === "UNAUTHENTICATED"');
    const searchIndex = source.indexOf("searchManualChunks(");
    const franchiseIndex = source.indexOf("resolveRagStoreFranchiseForRequest(");

    assert.ok(authIndex >= 0 && searchIndex >= 0 && franchiseIndex >= 0);
    assert.ok(authIndex < franchiseIndex);
    assert.ok(franchiseIndex < searchIndex);
  });

  test("fails closed into the existing generic error response when franchise scope cannot be resolved", () => {
    assert.match(source, /franchiseScope\.status !== "RESOLVED"/);
    // No new response shape: the throw is caught by the existing catch block below.
    assert.match(source, /catch \(error\) \{/);
  });
});
