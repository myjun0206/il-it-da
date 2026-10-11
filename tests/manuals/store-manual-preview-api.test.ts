import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as extraction from "../../lib/manuals/extract-manual-groups.ts";
import { extractStoreManualGroups } from "../../lib/manuals/extract-store-manual-groups.ts";
import * as limits from "../../lib/manuals/upload-limits.ts";
import { buildManualPreview } from "../../lib/manuals/build-manual-preview.ts";

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
    const parseIndex = source.indexOf("extractStoreManualGroups(");
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

describe("CSV 미리보기 실제 handler (인증·DB만 synthetic)", () => {
  function previewHandler() {
    let databaseCalls = 0;
    const exportsObject = {} as { POST: (request: Request) => Promise<Response> };
    const dependencies: Record<string, unknown> = {
      "node:crypto": { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
      "next/server": { NextResponse: { json: Response.json } },
      "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => { databaseCalls += 1; throw new Error("Unexpected database call"); } }) },
      "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner-fixture" } }, error: null }) } }) },
      "@/lib/manuals/store-manual-auth": { requireStoreOwner: async () => ({ storeId: "store-fixture", franchiseId: "brand-fixture" }) },
      "@/lib/manuals/extract-manual-groups": extraction,
      "@/lib/manuals/extract-store-manual-groups": { extractStoreManualGroups },
      "@/lib/manuals/upload-limits": limits,
      "@/lib/manuals/build-manual-preview": { buildManualPreview },
    };
    const compiled = ts.transpileModule(readSource("app/api/store-manuals/preview/route.ts"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, {
      exports: exportsObject, File, Error, console: { error: () => undefined },
      require: (name: string) => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected module ${name}`);
        return dependencies[name];
      },
    });
    return { post: exportsObject.POST, databaseCalls: () => databaseCalls };
  }

  function csvRequest(content: string) {
    const data = new FormData();
    data.set("storeId", "store-fixture");
    data.set("file", new File([content], "test.csv", { type: "text/csv" }));
    return new Request("http://localhost/api/store-manuals/preview", { method: "POST", body: data });
  }

  test("승인 V1 두 줄 본문이 HTTP200 미리보기에서 그대로 유지된다", async () => {
    const content = "TEST ONLY. 검증표식 E2E-R1의 확인 문자열은\nPOC-CHECK-R1-V1이다. 운영 지침이 아닌 시험 자료다.";
    const handler = previewHandler();
    const response = await handler.post(csvRequest(`category,title,content\n__poc_escalation_20261011_R1,__poc_marker_E2E_R1,"${content}"`));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.preview.totalDetailManualCount, 1);
    assert.equal(body.preview.manuals[0].content, content);
    assert.equal(handler.databaseCalls(), 0);
  });

  test("잘못 닫힌 따옴표는 잘린 미리보기 없이 HTTP400 명확한 오류다", async () => {
    const handler = previewHandler();
    for (const content of ['"닫히지 않은 본문\n확인값', '"본문"뒤문자', '본문"따옴표']) {
      const response = await handler.post(csvRequest(`category,title,content\n안내,제목,${content}`));
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.match(body.error, /CSV.*따옴표/);
      assert.equal(body.preview, undefined);
      assert.equal(body.idempotencyKey, undefined);
    }
    assert.equal(handler.databaseCalls(), 0);
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
