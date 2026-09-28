import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// app/api/store-manuals/preview/route.ts and .../preview/confirm/route.ts need next/server,
// Supabase admin client construction, and cookies() - none of which resolve outside the
// Next.js runtime, so (like the HQ preview route tests) their contracts are locked as a
// static source-text contract rather than executed directly.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("app/api/store-manuals/preview/route.ts (store preview never writes to Supabase)", () => {
  const source = readSource("app/api/store-manuals/preview/route.ts");

  test("never calls .insert(/.update(/.delete( - no manuals/manual_chunks write of any kind", () => {
    assert.equal(/\.insert\s*\(/.test(source), false);
    assert.equal(/\.update\s*\(/.test(source), false);
    assert.equal(/\.delete\s*\(/.test(source), false);
  });

  test("reuses requireStoreOwner (the existing store-manual auth function), not a new invented one", () => {
    assert.match(source, /from "@\/lib\/manuals\/store-manual-auth"/);
    assert.match(source, /requireStoreOwner\(adminClient, userData\.user\.id, storeId\)/);
  });

  test("fails closed (403) when requireStoreOwner returns null - covers pending/rejected/other-owner's store", () => {
    const authIndex = source.indexOf("requireStoreOwner(");
    const guardIndex = source.indexOf("if (!storeAuth)");
    const parseIndex = source.indexOf("extractManualGroups(");
    assert.ok(authIndex >= 0 && guardIndex >= 0 && parseIndex >= 0);
    assert.ok(authIndex < guardIndex && guardIndex < parseIndex);
    assert.match(source, /status: 403/);
  });

  test("resolves storeId from the request only as a candidate to verify, never trusts franchiseId/brandName from the client", () => {
    assert.equal(source.includes("formData.get(\"franchiseId\")"), false);
    assert.equal(source.includes("formData.get(\"brandName\")"), false);
  });

  test("builds the preview with scopeType store using the SERVER-VERIFIED storeAuth.storeId, not the raw request value", () => {
    assert.match(source, /buildManualPreview\(groups, \{ storeId: storeAuth\.storeId \}\)/);
  });

  test("reuses the shared extraction module and preview builder instead of duplicating parsing logic", () => {
    assert.match(source, /from "@\/lib\/manuals\/extract-manual-groups"/);
    assert.match(source, /from "@\/lib\/manuals\/build-manual-preview"/);
  });

  test("never logs the raw parse error object with request content, only a fixed prefix", () => {
    assert.match(source, /console\.error\("\[STORE_MANUALS_PREVIEW\] parse failed:", parseError\)/);
  });
});

describe("app/api/store-manuals/preview/confirm/route.ts (store confirm re-verifies everything server-side)", () => {
  const source = readSource("app/api/store-manuals/preview/confirm/route.ts");

  test("re-checks the logged-in user via auth.getUser(), not by trusting any request body field", () => {
    assert.match(source, /auth\.getUser\(\)/);
  });

  test("re-verifies owner role/approval/store access via requireStoreOwner on every confirm call", () => {
    assert.match(source, /requireStoreOwner\(adminClient, userData\.user\.id, storeId\)/);
    assert.match(source, /if \(!storeAuth\)/);
  });

  test("never reads franchiseId/brandName/scopeType from the request body - only from requireStoreOwner's own DB lookup", () => {
    const codeOnly = stripComments(source);
    assert.equal(codeOnly.includes("body.franchiseId"), false);
    assert.equal(codeOnly.includes("body.brandName"), false);
    assert.equal(codeOnly.includes("body.scopeType"), false);
  });

  test("saves with the server-verified storeAuth (franchiseId/brandName/storeId), never a client-supplied value", () => {
    assert.match(source, /auth: storeAuth,/);
    assert.match(source, /storeId: storeAuth\.storeId,/);
    assert.match(source, /scope: \{ scopeType: "store", franchiseId: storeAuth\.franchiseId, storeId: storeAuth\.storeId \}/);
  });

  test("reuses the shared parseConfirmedManualGroups instead of duplicating the confirm-payload parsing rule", () => {
    assert.match(source, /from "@\/lib\/manuals\/parse-confirmed-manual-groups"/);
    assert.match(source, /parseConfirmedManualGroups\(body\.manuals\)/);
  });

  test("never logs the raw request body/manual content, only a fixed log line with the caught error object", () => {
    assert.equal(/console\.error\([^)]*body/i.test(source), false);
    const guardSource = readSource("lib/manuals/save-manuals-with-batch.ts");
    assert.match(guardSource, /console\.error\("\[MANUAL_SAVE_GUARD\] save failed:", \{ name: e instanceof Error \? e\.name : "UnknownError" \}\)/);
  });
});

describe("existing store-manual API contracts are untouched (no regression)", () => {
  test("app/api/store-manuals/analyze/route.ts is unchanged (still the existing AI-preview-analog contract)", () => {
    const source = readSource("app/api/store-manuals/analyze/route.ts");
    assert.match(source, /return NextResponse\.json\(\{ groups \}\);/);
  });

  test("app/api/store-manuals/batch-create/route.ts still accepts { storeId, groups } and now saves through the shared batch guard", () => {
    const source = readSource("app/api/store-manuals/batch-create/route.ts");
    assert.match(source, /parseGroups\(body\.groups\)/);
    assert.match(source, /saveManualGroupsWithBatchGuard\(adminClient, \{/);
  });
});
