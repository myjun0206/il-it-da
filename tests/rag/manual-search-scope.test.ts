import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

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
