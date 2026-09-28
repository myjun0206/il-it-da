import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { classifyManualGroups, isUnclassified } from "../../lib/manuals/manual-category-rules.ts";
import type { AnalyzedManualGroup } from "../../lib/manuals/analyze-manual-with-ai.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function group(category: string, topic: string, items: string[] = ["내용"]): AnalyzedManualGroup {
  return { category, topic, items };
}

function readMCoffeeTaxonomy(): {
  categories: { key: string; label: string; manualTitles: string[] }[];
} {
  const raw = readFileSync(
    path.join(repoRoot, "tests/fixtures/manual-categories/m-coffee-common-taxonomy.json"),
    "utf8",
  );
  return JSON.parse(raw);
}

describe("classifyManualGroups", () => {
  test("preserves the raw category instead of remapping it to a fixed taxonomy", () => {
    const [result] = classifyManualGroups([group("아무 카테고리", "오픈 운영")]);
    assert.equal(result.topCategoryKey, "category:아무 카테고리");
    assert.equal(result.topCategoryLabel, "아무 카테고리");
    assert.equal(result.classification, "dynamic_category");
  });

  test("preserves an existing category name verbatim", () => {
    const [result] = classifyManualGroups([group("위생·안전", "처음 보는 제목")]);
    assert.equal(result.topCategoryKey, "category:위생·안전");
    assert.equal(result.classification, "dynamic_category");
  });

  test("same category groups titles without title-based remapping", () => {
    const [opening] = classifyManualGroups([group("매장운영", "오픈 운영")]);
    const [closing] = classifyManualGroups([group("매장운영", "마감 운영")]);
    const [other] = classifyManualGroups([group("매장운영", "매장 전화 응대")]);

    assert.equal(opening.topCategoryKey, "category:매장운영");
    assert.equal(closing.topCategoryKey, "category:매장운영");
    assert.equal(other.topCategoryKey, "category:매장운영");
  });

  test("does not replace a new category based on title keywords", () => {
    const [result] = classifyManualGroups([group("새 분류", "냉장고 재고 확인 절차")]);
    assert.equal(result.topCategoryKey, "category:새 분류");
    assert.equal(result.classification, "dynamic_category");
  });

  test("falls back to UNCLASSIFIED when no rule matches at all", () => {
    const [result] = classifyManualGroups([group("", "완전히 새로운 제목")]);
    assert.equal(isUnclassified(result), true);
    assert.equal(result.classification, "unclassified");
    // The UI-facing label must never be the literal developer term "UNCLASSIFIED".
    assert.notEqual(result.topCategoryLabel, "UNCLASSIFIED");
    assert.equal(result.topCategoryLabel, "분류 확인 필요");
  });

  test("is deterministic: the same input always produces the same output", () => {
    const input = [group("위생·안전", "새 제목"), group("아무거나", "완전히 새로운 제목 2")];
    const first = classifyManualGroups(input);
    const second = classifyManualGroups(input);
    assert.deepEqual(first, second);
  });

  test("never assigns a group to more than one top category (exactly one key per group)", () => {
    const results = classifyManualGroups([
      group("오픈 운영", "오픈 운영"),
      group("위생·안전", "위생 청소"),
    ]);
    for (const result of results) {
      assert.equal(typeof result.topCategoryKey, "string");
      assert.ok(result.topCategoryKey.length > 0);
    }
  });

  test("never mutates title/category/items - only adds classification fields", () => {
    const input = group("원본 카테고리", "원본 제목", ["원본 내용 1", "원본 내용 2"]);
    const [result] = classifyManualGroups([input]);
    assert.equal(result.category, "원본 카테고리");
    assert.equal(result.topic, "원본 제목");
    assert.deepEqual(result.items, ["원본 내용 1", "원본 내용 2"]);
  });

  test("different source categories remain distinct regardless of title", () => {
    const taxonomy = readMCoffeeTaxonomy();
    const inputs = taxonomy.categories.map((category) => group(category.label, category.manualTitles[0]));
    const classified = classifyManualGroups(inputs);

    assert.equal(classified.length, taxonomy.categories.length);
    for (const result of classified) {
      assert.equal(result.topCategoryKey, `category:${result.category}`);
      assert.notEqual(result.classification, "unclassified");
    }
  });
});
