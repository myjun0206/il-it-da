import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { parseConfirmedManualGroups } from "../../lib/manuals/parse-confirmed-manual-groups.ts";

// app/api/manuals/preview/route.ts and .../preview/confirm/route.ts need next/server, Supabase
// admin client construction, and cookies() - none of which resolve outside the Next.js runtime,
// so (like tests/rag/manuals-cascade-delete.test.ts and other route tests in this repo) their
// contracts are locked as a static source-text contract rather than executed directly.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

describe("app/api/manuals/preview/route.ts (preview never writes to Supabase)", () => {
  const source = readSource("app/api/manuals/preview/route.ts");

  test("never calls .insert(/.update(/.delete( - no manuals/manual_chunks write of any kind", () => {
    assert.equal(/\.insert\s*\(/.test(source), false);
    assert.equal(/\.update\s*\(/.test(source), false);
    assert.equal(/\.delete\s*\(/.test(source), false);
  });

  test("never imports createAdminClient (no Supabase client is even constructed)", () => {
    assert.equal(source.includes("createAdminClient"), false);
  });

  test("resolves scope only via requireHqUser(), never trusting a client-supplied franchiseId/brandName/storeId", () => {
    assert.match(source, /requireHqUser\(\)/);
    assert.equal(source.includes("formData.get(\"franchiseId\")"), false);
    assert.equal(source.includes("formData.get(\"brandName\")"), false);
    assert.equal(source.includes("formData.get(\"storeId\")"), false);
  });

  test("returns 403 when requireHqUser() resolves to null, before any parsing happens", () => {
    const authIndex = source.indexOf("requireHqUser()");
    const guardIndex = source.indexOf("if (!hqUser)");
    const parseIndex = source.indexOf("extractManualGroups(");
    assert.ok(authIndex >= 0 && guardIndex >= 0 && parseIndex >= 0);
    assert.ok(authIndex < guardIndex && guardIndex < parseIndex);
  });

  test("reuses the shared extraction module and preview builder instead of duplicating parsing logic", () => {
    assert.match(source, /from "@\/lib\/manuals\/extract-manual-groups"/);
    assert.match(source, /from "@\/lib\/manuals\/build-manual-preview"/);
    assert.match(source, /buildManualPreview\(groups\)/);
  });

  test("reuses the same file-size/mime/pdf guards as the direct-save upload route", () => {
    assert.match(source, /isFileSizeWithinLimit/);
    assert.match(source, /isPlausibleXlsxMimeType/);
    assert.match(source, /"\.pdf"/);
  });
});

describe("app/api/manuals/preview/confirm/route.ts (only route that actually saves)", () => {
  const source = readSource("app/api/manuals/preview/confirm/route.ts");
  const guardSource = readSource("lib/manuals/save-manuals-with-batch.ts");

  test("resolves scope only via requireHqUser(), never a client-supplied franchiseId/brandName", () => {
    assert.match(source, /requireHqUser\(\)/);
    assert.equal(source.includes("body.franchiseId"), false);
    assert.equal(source.includes("body.brandName"), false);
  });

  test("never accepts a client-supplied storeId (every save through this route is scope_type hq)", () => {
    assert.equal(source.includes("body.storeId"), false);
    assert.equal(/saveManualGroupsWithChunks\([^)]*storeId/.test(source), false);
  });

  test("reuses saveManualGroupsWithChunks instead of a new duplicated save/chunk/embed implementation", () => {
    // 저장 호출은 중복 방지 가드와 함께 lib/manuals/save-manuals-with-batch.ts로 옵겨졌다.
    assert.match(source, /from "@\/lib\/manuals\/save-manuals-with-batch"/);
    assert.match(guardSource, /from "@\/lib\/rag\/save-manual-sections"/);
    assert.match(guardSource, /saveManualGroupsWithChunks\(client, auth, groups, storeId, undefined, claim\.batchId\)/);
  });

  test("reuses the shared parseConfirmedManualGroups instead of duplicating the confirm-payload parsing rule", () => {
    assert.match(source, /from "@\/lib\/manuals\/parse-confirmed-manual-groups"/);
    assert.match(source, /parseConfirmedManualGroups\(body\.manuals\)/);
  });

  test("excludes manuals flagged excluded:true before they ever reach saveManualGroupsWithChunks", () => {
    const groups = parseConfirmedManualGroups([
      { title: "오픈 준비", topCategoryLabel: "오픈/마감", items: [{ content: "불 켜기" }] },
      { title: "제외", topCategoryLabel: "오픈/마감", items: [{ content: "x" }], excluded: true },
    ]);
    assert.deepEqual(groups, [{ category: "오픈/마감", topic: "오픈 준비", items: ["불 켜기"] }]);
  });

  test("rejects a request with no items/topic/category instead of guessing a value", () => {
    const valid = { title: "t", topCategoryLabel: "c", items: [{ content: "x" }] };
    assert.equal(parseConfirmedManualGroups([{ ...valid, title: "  " }]), null);
    assert.equal(parseConfirmedManualGroups([{ ...valid, topCategoryLabel: "" }]), null);
    assert.equal(parseConfirmedManualGroups([{ ...valid, items: [{ content: " " }] }]), null);
    assert.equal(parseConfirmedManualGroups([{ ...valid, items: undefined }]), null);
  });

  test("never logs the raw request body/manual content, only a fixed log line with the caught error object", () => {
    assert.equal(/console\.error\([^)]*body/i.test(source), false);
    assert.match(guardSource, /console\.error\("\[MANUAL_SAVE_GUARD\] save failed:", \{ name: e instanceof Error \? e\.name : "UnknownError" \}\)/);
  });
});

describe("app/api/manuals/upload/route.ts (still the direct-save path, now reusing the shared extractor)", () => {
  const source = readSource("app/api/manuals/upload/route.ts");

  test("imports extractManualGroups from the shared module instead of defining its own copy", () => {
    assert.match(source, /from "@\/lib\/manuals\/extract-manual-groups"/);
    assert.equal(/async function extractManualGroups/.test(source), false);
  });
});
