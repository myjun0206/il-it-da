import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildManualPreview } from "../../lib/manuals/build-manual-preview.ts";
import type { AnalyzedManualGroup } from "../../lib/manuals/analyze-manual-with-ai.ts";

const GROUPS: AnalyzedManualGroup[] = [
  { category: "매장운영", topic: "오픈 운영", items: ["1. 문을 연다"] },
  { category: "매장운영", topic: "마감 운영", items: ["1. 문을 잠근다"] },
  { category: "새 카테고리", topic: "완전히 새로운 제목", items: [""] },
];

describe("buildManualPreview", () => {
  test("counts detected detail manuals and generated top categories", () => {
    const preview = buildManualPreview(GROUPS);
    assert.equal(preview.totalDetailManualCount, 3);
    assert.equal(preview.topCategoryCount, preview.categories.length);
    assert.ok(preview.topCategoryCount >= 1);
  });

  test("assigns stable, clearly-non-DB temp ids to categories and manuals", () => {
    const preview = buildManualPreview(GROUPS);
    for (const category of preview.categories) {
      assert.match(category.tempId, /^preview-category-\d+$/);
    }
    for (const manual of preview.manuals) {
      assert.match(manual.tempId, /^preview-manual-\d+$/);
      for (const item of manual.items) {
        assert.match(item.tempId, /^preview-item-\d+-\d+$/);
      }
    }
  });

  test("with no storeId, every manual's scopeType is \"hq\" (common HQ upload -> hq contract)", () => {
    const preview = buildManualPreview(GROUPS);
    for (const manual of preview.manuals) {
      assert.equal(manual.scopeType, "hq");
    }
  });

  test("with a storeId, every manual's scopeType is \"store\" (store stays store)", () => {
    const preview = buildManualPreview(GROUPS, { storeId: "store-1" });
    for (const manual of preview.manuals) {
      assert.equal(manual.scopeType, "store");
    }
  });

  test("flags an unclassified manual with a non-empty warning and never silently drops it", () => {
    const preview = buildManualPreview(GROUPS);
    const unclassified = preview.manuals.find((manual) => manual.classification === "unclassified");
    assert.ok(unclassified);
    assert.ok(unclassified!.warnings.length > 0);
    assert.equal(unclassified!.topCategoryLabel, "분류 확인 필요");
  });

  test("flags a manual with only blank item content as needing attention", () => {
    const preview = buildManualPreview(GROUPS);
    const blank = preview.manuals.find((manual) => manual.title === "완전히 새로운 제목");
    assert.ok(blank);
    assert.ok(blank!.warnings.some((w) => w.includes("내용")));
  });

  test("every manual starts as not excluded, and title/original category/items are preserved as-is", () => {
    const preview = buildManualPreview(GROUPS);
    const opening = preview.manuals.find((m) => m.title === "오픈 운영");
    assert.ok(opening);
    assert.equal(opening!.excluded, false);
    assert.equal(opening!.originalCategory, "매장운영");
    assert.deepEqual(
      opening!.items.map((i) => i.content),
      ["1. 문을 연다"],
    );
  });

  test("category manualCount matches the number of manuals actually assigned to it", () => {
    const preview = buildManualPreview(GROUPS);
    for (const category of preview.categories) {
      const actual = preview.manuals.filter((m) => m.topCategoryTempId === category.tempId).length;
      assert.equal(category.manualCount, actual);
    }
  });

  test("is a pure function: calling it twice with the same input produces the same result", () => {
    const first = buildManualPreview(GROUPS);
    const second = buildManualPreview(GROUPS);
    assert.deepEqual(first, second);
  });
});
