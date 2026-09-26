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
  test("priority 1: an exact title match wins even when the raw category disagrees", () => {
    const [result] = classifyManualGroups([group("아무 카테고리", "오픈 운영")]);
    assert.equal(result.topCategoryKey, "opening_closing");
    assert.equal(result.classification, "exact_title");
  });

  test("priority 2: an existing (coarse) category maps onto a top category when no exact title matches", () => {
    const [result] = classifyManualGroups([group("위생·안전", "처음 보는 제목")]);
    assert.equal(result.topCategoryKey, "hygiene_safety_emergency");
    assert.equal(result.classification, "existing_category");
  });

  test("'매장운영' existing category ties-break by exact title: 오픈/마감 운영 -> opening_closing, otherwise -> store_operations_staff", () => {
    const [opening] = classifyManualGroups([group("매장운영", "오픈 운영")]);
    const [closing] = classifyManualGroups([group("매장운영", "마감 운영")]);
    const [other] = classifyManualGroups([group("매장운영", "매장 전화 응대")]);

    assert.equal(opening.topCategoryKey, "opening_closing");
    assert.equal(closing.topCategoryKey, "opening_closing");
    assert.equal(other.topCategoryKey, "store_operations_staff");
  });

  test("priority 3: a limited keyword rule matches when neither title nor category matched", () => {
    const [result] = classifyManualGroups([group("새 분류", "냉장고 재고 확인 절차")]);
    assert.equal(result.topCategoryKey, "inventory_ordering_equipment");
    assert.equal(result.classification, "keyword");
  });

  test("falls back to UNCLASSIFIED when no rule matches at all", () => {
    const [result] = classifyManualGroups([group("완전히 새로운 카테고리", "완전히 새로운 제목")]);
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

  test("the M Coffee common-manual taxonomy's 19 titles are each classified exactly once, with no omission and no duplication", () => {
    const taxonomy = readMCoffeeTaxonomy();
    const expectedByTitle = new Map<string, string>();
    for (const category of taxonomy.categories) {
      for (const title of category.manualTitles) {
        expectedByTitle.set(title, category.key);
      }
    }

    const inputs = [...expectedByTitle.keys()].map((title) => group("본사 공통", title));
    const classified = classifyManualGroups(inputs);

    assert.equal(classified.length, 19);
    const seenTitles = new Set<string>();
    for (const result of classified) {
      assert.equal(seenTitles.has(result.topic), false, `duplicate classification for "${result.topic}"`);
      seenTitles.add(result.topic);
      assert.equal(
        result.topCategoryKey,
        expectedByTitle.get(result.topic),
        `"${result.topic}" should classify as "${expectedByTitle.get(result.topic)}"`,
      );
      assert.notEqual(result.classification, "unclassified");
    }
    assert.equal(seenTitles.size, 19);
  });
});
