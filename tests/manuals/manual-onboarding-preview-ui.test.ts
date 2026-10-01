import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// app/hq/manuals/onboarding/page.tsx is a client component that needs the browser DOM/React
// runtime, so (like other UI-contract checks in this repo) its accessibility and
// double-submit-guard contracts are locked as a static source-text contract.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

// The category/manual editing UI (collapse/expand, rename, move, exclude/restore, warnings) is
// a single shared component reused by both the HQ and store-owner upload screens - see
// components/manuals/ManualPreviewEditor.tsx's own doc comment.
describe("components/manuals/ManualPreviewEditor.tsx (shared preview editor accessibility contract)", () => {
  const source = readSource("components/manuals/ManualPreviewEditor.tsx");

  test("never renders the literal developer terms UUID/scope_type/UNCLASSIFIED to the user", () => {
    assert.equal(/>\s*UNCLASSIFIED\s*</.test(source), false);
    assert.equal(/>\s*scope_type\s*</.test(source), false);
    assert.equal(/>\s*UUID\s*</.test(source), false);
  });

  test("flags an unclassified category with an icon, not color alone", () => {
    const isUnclassifiedIndex = source.indexOf("isUnclassified &&");
    const alertTriangleIndex = source.indexOf("AlertTriangle", isUnclassifiedIndex);
    assert.ok(isUnclassifiedIndex >= 0);
    assert.ok(alertTriangleIndex > isUnclassifiedIndex);
  });

  test("category collapse/expand toggle exposes aria-expanded and a descriptive aria-label", () => {
    assert.match(source, /aria-expanded=\{!isCollapsed\}/);
    assert.match(source, /aria-label=\{`\$\{categoryLabels\[category\.tempId\] \?\? category\.label\} 그룹/);
  });

  test("category name and manual title inputs each have an associated (even if visually hidden) label", () => {
    assert.match(source, /htmlFor=\{`category-label-\$\{category\.tempId\}`\}/);
    assert.match(source, /id=\{`category-label-\$\{category\.tempId\}`\}/);
    assert.match(source, /htmlFor=\{`manual-title-\$\{manual\.tempId\}`\}/);
    assert.match(source, /id=\{`manual-title-\$\{manual\.tempId\}`\}/);
  });

  test("the exclude/restore toggle exposes aria-pressed and a plain-language aria-label", () => {
    assert.match(source, /aria-pressed=\{isExcluded\}/);
    assert.match(source, /aria-label=\{isExcluded \? "이 항목 다시 포함하기" : "이 항목 저장에서 빼기"\}/);
  });

  test("long manual content wraps instead of overflowing (break-keep + whitespace-pre-wrap)", () => {
    assert.match(source, /whitespace-pre-wrap break-keep/);
  });

  test("never calls an API itself - only reports edits upward via on* callback props", () => {
    assert.equal(source.includes("fetch("), false);
  });
});

describe("app/hq/manuals/onboarding/page.tsx (preview screen usability contract)", () => {
  const source = readSource("app/hq/manuals/onboarding/page.tsx");

  test("renders the preview in a centered, scrollable dialog with a close button", () => {
    const previewModal = source.slice(source.indexOf("{step === \"review\" && preview && ("), source.indexOf("{/* 승인 전 정리 결과를 버리고 나갈 때 확인 모달 */}"));
    assert.match(previewModal, /className="fixed inset-0 z-50[^\"]*bg-black\/40/);
    assert.match(previewModal, /role="dialog"/);
    assert.match(previewModal, /aria-modal="true"/);
    assert.match(previewModal, /max-h-\[88vh\]/);
    assert.match(previewModal, /overflow-y-auto/);
    assert.match(previewModal, /aria-label="미리보기 닫기"/);
    assert.match(previewModal, /세부 매뉴얼 \{preview\.totalDetailManualCount\}개/);
    assert.match(previewModal, /카테고리 \{preview\.topCategoryCount\}개/);
  });

  test("modal footer contains only cancel and green primary batch-register actions", () => {
    const previewModal = source.slice(source.indexOf("{step === \"review\" && preview && ("), source.indexOf("{/* 승인 전 정리 결과를 버리고 나갈 때 확인 모달 */}"));
    const footer = previewModal.slice(previewModal.indexOf("shrink-0 border-t"));
    assert.equal((footer.match(/<Button/g) ?? []).length, 2);
    assert.match(footer, />\s*취소\s*</);
    assert.match(footer, /variant="primary"[\s\S]*?>\s*일괄 등록\s*</);
    assert.match(footer, /onClick=\{handleSave\}/);
    assert.match(footer, /onClick=\{handleReupload\}/);
  });

  test("reuses the shared ManualPreviewEditor component instead of duplicating the editing UI", () => {
    assert.match(source, /from "@\/components\/manuals\/ManualPreviewEditor"/);
    assert.match(source, /<ManualPreviewEditor/);
  });

  test("the save button is disabled while saving (prevents duplicate-click double submits)", () => {
    const buttonBlock = source.slice(source.indexOf("onClick={handleSave}") - 200, source.indexOf("onClick={handleSave}") + 50);
    assert.match(buttonBlock, /disabled=\{isSaving\}/);
    assert.match(buttonBlock, /isLoading=\{isSaving\}/);
  });

  test("handleSave has an in-flight guard (isSubmittingRef) in addition to the isSaving disabled state", () => {
    assert.match(source, /isSubmittingRef\.current/);
    assert.match(source, /if \(!preview \|\| !idempotencyKey \|\| isSubmittingRef\.current\) return;/);
  });

  test("save success/failure feedback uses plain Korean sentences, and errors are announced (role=alert)", () => {
    assert.match(source, /매뉴얼 저장 중 오류가 발생했습니다\./);
    assert.match(source, /role="alert"/);
  });

  test("this page calls the preview endpoint (not the direct-save upload endpoint) for every supported extension", () => {
    assert.match(source, /fetch\("\/api\/manuals\/preview", \{/);
    assert.match(source, /fetch\("\/api\/manuals\/preview\/confirm", \{/);
    assert.equal(source.includes('fetch("/api/manuals/upload"'), false);
  });
});
