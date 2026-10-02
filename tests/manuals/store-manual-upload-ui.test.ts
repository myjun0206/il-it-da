import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// The owner manual analysis screen requires the browser DOM/React runtime, so its
// submission and integrated classification UI contracts are kept as source checks.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

describe("app/boss/store-manuals/page.tsx (integrated store manual analysis)", () => {
  const source = readSource("app/boss/store-manuals/page.tsx");

  test("integrates the shared category classification editor into the analysis screen", () => {
    assert.match(source, /from "@\/components\/manuals\/ManualPreviewEditor"/);
    assert.match(source, /<ManualPreviewEditor/);
  });

  test("shows the analysis category and item counts before save", () => {
    assert.match(source, /preview\.totalDetailManualCount/);
    assert.match(source, /preview\.topCategoryCount/);
    assert.match(source, /매뉴얼 등록 미리보기/);
  });

  test("uses only the store-scoped analysis and confirmation endpoints", () => {
    assert.match(source, /fetch\("\/api\/store-manuals\/preview", \{/);
    assert.match(source, /fetch\("\/api\/store-manuals\/preview\/confirm", \{/);
    assert.equal(source.includes('fetch("/api/manuals/preview"'), false);
    assert.equal(source.includes('router.push("/boss/store-manuals/upload")'), false);
  });

  test("sends storeId and idempotency key through the store-scoped save", () => {
    assert.match(source, /formData\.append\("storeId", selectedStoreId\)/);
    assert.match(source, /JSON\.stringify\(\{ storeId: selectedStoreId, manuals: payloadManuals, idempotencyKey \}\)/);
  });

  test("the save button is disabled while saving (prevents duplicate-click double submits)", () => {
    const buttonBlock = source.slice(
      source.indexOf("onClick={handleSaveAnalysis}") - 200,
      source.indexOf("onClick={handleSaveAnalysis}") + 50,
    );
    assert.match(buttonBlock, /disabled=\{isSavingAnalysis\}/);
    assert.match(buttonBlock, /isLoading=\{isSavingAnalysis\}/);
  });

  test("handleSave has an in-flight guard (isSubmittingRef) in addition to the isSaving disabled state", () => {
    assert.match(source, /isSubmittingRef\.current/);
    assert.match(source, /if \(!preview \|\| !selectedStoreId \|\| !idempotencyKey \|\| isSubmittingRef\.current\) return;/);
  });

  test("redirects unapproved/non-owner sessions before any file can be uploaded", () => {
    assert.match(source, /profile\?\.role !== "owner"/);
    assert.match(source, /profile\.approvalStatus !== "approved"/);
  });

  test("errors are announced to assistive tech (role=alert) with plain Korean sentences", () => {
    assert.match(source, /role="alert"/);
    assert.match(source, /매뉴얼 저장 중 오류가 발생했습니다\./);
  });

  test("the analysis picker is the only owner upload entry point", () => {
    assert.match(source, /<Button variant="outline" onClick=\{openAnalyzeFilePicker\}/);
    assert.match(source, /매뉴얼 등록/);
    assert.equal(source.includes("미리보기로 올리기"), false);
  });
});

describe("HQ preview edit accessibility contract", () => {
  const source = readSource("components/manuals/ManualPreviewEditor.tsx");

  test("retains category move, collapse, exclude and restore controls shared with HQ", () => {
    assert.match(source, /onManualCategoryMove/);
    assert.match(source, /onToggleCategoryCollapsed/);
    assert.match(source, /onManualExcludeToggle/);
    assert.match(source, /onCategoryLabelChange/);
  });
});
