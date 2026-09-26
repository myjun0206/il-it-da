import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// app/boss/store-manuals/upload/page.tsx is a client component that needs the browser
// DOM/React runtime, so (like the HQ onboarding page tests) its usability/duplicate-click
// contract is locked as a static source-text contract; the shared accessibility markup itself
// is already covered once by tests/manuals/manual-onboarding-preview-ui.test.ts's
// ManualPreviewEditor checks, since both pages render the exact same shared component.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

describe("app/boss/store-manuals/upload/page.tsx (store-owner preview screen)", () => {
  const source = readSource("app/boss/store-manuals/upload/page.tsx");

  test("reuses the shared ManualPreviewEditor component instead of duplicating the editing UI", () => {
    assert.match(source, /from "@\/components\/manuals\/ManualPreviewEditor"/);
    assert.match(source, /<ManualPreviewEditor/);
  });

  test("shows the three required plain-language summary lines after a successful preview", () => {
    assert.match(source, /세부 매뉴얼 \{preview\.totalDetailManualCount\}개를 찾았습니다\./);
    assert.match(source, /\{preview\.topCategoryCount\}개의 항목으로 정리했습니다\./);
    assert.match(source, /내용을 확인한 후 저장해 주세요\./);
  });

  test("calls the store preview/confirm endpoints, never the HQ ones or the legacy analyze/batch-create ones", () => {
    assert.match(source, /fetch\("\/api\/store-manuals\/preview", \{/);
    assert.match(source, /fetch\("\/api\/store-manuals\/preview\/confirm", \{/);
    assert.equal(source.includes('fetch("/api/manuals/preview"'), false);
    assert.equal(source.includes('fetch("/api/store-manuals/analyze"'), false);
    assert.equal(source.includes('fetch("/api/store-manuals/batch-create"'), false);
  });

  test("sends storeId in both the preview upload and the confirm save request", () => {
    assert.match(source, /formData\.append\("storeId", storeId\)/);
    assert.match(source, /JSON\.stringify\(\{ storeId, manuals: payloadManuals, idempotencyKey \}\)/);
  });

  test("the save button is disabled while saving (prevents duplicate-click double submits)", () => {
    const buttonBlock = source.slice(
      source.indexOf("onClick={handleSave}") - 200,
      source.indexOf("onClick={handleSave}") + 50,
    );
    assert.match(buttonBlock, /disabled=\{isSaving\}/);
    assert.match(buttonBlock, /isLoading=\{isSaving\}/);
  });

  test("handleSave has an in-flight guard (isSubmittingRef) in addition to the isSaving disabled state", () => {
    assert.match(source, /isSubmittingRef\.current/);
    assert.match(source, /if \(!preview \|\| !storeId \|\| !idempotencyKey \|\| isSubmittingRef\.current\) return;/);
  });

  test("redirects unapproved/non-owner sessions before any file can be uploaded", () => {
    assert.match(source, /profile\?\.role !== "owner"/);
    assert.match(source, /profile\.approvalStatus !== "approved"/);
  });

  test("errors are announced to assistive tech (role=alert) with plain Korean sentences", () => {
    assert.match(source, /role="alert"/);
    assert.match(source, /매뉴얼 저장 중 오류가 발생했습니다\./);
  });

  test("the file picker exposes keyboard access (role=button + tabIndex + Enter/Space handling)", () => {
    assert.match(source, /role="button"/);
    assert.match(source, /onKeyDown=\{\(e\) => \{/);
    assert.match(source, /e\.key === "Enter" \|\| e\.key === " "/);
  });
});

describe("app/boss/store-manuals/page.tsx (entry point link, minimal touch)", () => {
  const source = readSource("app/boss/store-manuals/page.tsx");

  test("adds a link to the new preview-upload page without removing the existing AI-analyze flow", () => {
    assert.match(source, /router\.push\("\/boss\/store-manuals\/upload"\)/);
    assert.match(source, /openAnalyzeFilePicker/);
  });
});
