import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  // Normalize CRLF to LF so multi-line regex assertions below are unaffected by the
  // checkout's line-ending style (this repo's files may be checked out with CRLF on Windows).
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

// lib/rag/save-manual-sections.ts imports OpenAI/Supabase-backed modules through the
// "@/" path alias, which only resolves via the Next.js bundler (not plain `node --test`),
// so it cannot be exercised at runtime in this test suite. Instead this locks its
// documented parent/child + chunk contract as a static text contract, the same pattern
// already used for supabase/migrations/018_scoped_hybrid_manual_search.sql (see
// tests/rag/manual-search-scope.test.ts).
describe("lib/rag/save-manual-sections.ts (static contract)", () => {
  const source = readSource("lib/rag/save-manual-sections.ts");

  test("parent (topic card) manuals are inserted with parent_manual_id: null and are never chunked", () => {
    assert.match(source, /parent_manual_id:\s*null/);
    // syncChunksForManuals is only ever called with `children`, never with the parent record.
    assert.match(source, /await syncChunksForManuals\(supabase,\s*children,\s*indexManual\)/);
  });

  test("children are linked to the parent via parent_manual_id: parent.id and saved as approved", () => {
    assert.match(source, /parent_manual_id:\s*parent\.id/);
    // Both the parent insert and the children insert use a literal "approved" status.
    const approvedCount = (source.match(/status:\s*"approved"/g) ?? []).length;
    assert.ok(approvedCount >= 2, "expected both parent and child inserts to use status: \"approved\"");
  });

  test("never falls back to using topic as category when category is missing (regression guard)", () => {
    // The buggy fallback line must stay commented out, not reintroduced.
    assert.doesNotMatch(source, /^\s*const category = group\.category\?\.trim\(\) \|\| topic;/m);
    assert.match(source, /const category = group\.category\?\.trim\(\) \|\| "미분류";/);
  });

  test("chunk sync failures are logged and swallowed, never thrown, so manual saving itself is not blocked", () => {
    assert.match(source, /logSafeManualError\("MANUAL_CHUNKS_INSERT_FAILED", chunkError\)/);
    assert.match(source, /logSafeManualError\("MANUAL_CHUNKING_FAILED", chunkParseError\)/);
  });

  test("re-embedding is delegated to reembedApprovedManuals, which isolates per-manual embedding failures", () => {
    assert.match(source, /await reembedApprovedManuals\(manuals, indexManual, logSafeManualError\)/);
  });

  test("safe error logging never forwards raw error message/details, only a fixed code and error name", () => {
    assert.match(source, /function logSafeManualError\(code: string, error: unknown\): void/);
    assert.match(source, /const name = error instanceof Error \? error\.name : "UnknownError"/);
    assert.match(source, /console\.error\(`\[MANUALS\] \$\{code\}`, \{ name \}\)/);
  });
});

describe("lib/rag/manual-indexing/reembed-approved-manuals.ts (reused contract)", () => {
  // tests/rag/manual-indexing/reembed-approved-manuals.test.ts already exercises this module
  // at runtime (it has zero "@/" imports), covering: skip-draft, continue-after-one-failure,
  // and safe logging. Re-asserting here only that save-manual-sections.ts actually wires the
  // same module in, so that runtime coverage transitively applies to the real save path.
  const source = readSource("lib/rag/save-manual-sections.ts");

  test("imports reembedApprovedManuals from lib/rag/manual-indexing/reembed-approved-manuals", () => {
    assert.match(
      source,
      /import \{ reembedApprovedManuals \} from "@\/lib\/rag\/manual-indexing\/reembed-approved-manuals"/,
    );
  });
});
