import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { parseExcelTableGroups } from "../../lib/manuals/parse-excel-table.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  // Normalize CRLF to LF so multi-line regex assertions below are unaffected by the
  // checkout's line-ending style (this repo's files may be checked out with CRLF on Windows).
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

// lib/manuals/parse-excel-table.ts imports lib/manuals/detect-manual-item.ts through the
// "@/" path alias, which only Next.js's webpack/tsc understand, not plain `node --test`.
// Rather than duplicating the parser or leaving it untested at runtime, this suite runs
// under `node --import ./tests/support/register-alias-hooks.mjs` (see test:rag in
// package.json), which registers a Node module-customization hook that resolves "@/*"
// specifiers to real files under the repo root - same file, same behavior, just resolvable
// outside the Next.js bundler. No parser code was duplicated or modified to make this work.
describe("parseExcelTableGroups (runtime fixture tests)", () => {
  test("standard vertical structure: multiple categories/titles are split into distinct groups", () => {
    const groups = parseExcelTableGroups([
      ["category", "title", "content"],
      ["오픈/마감", "오픈 체크리스트", "문을 연다"],
      ["오픈/마감", "마감 체크리스트", "문을 잠근다"],
      ["안전", "화재 대응", "소화기 확인"],
    ]);

    assert.deepEqual(groups, [
      { category: "오픈/마감", topic: "오픈 체크리스트", items: ["문을 연다"] },
      { category: "오픈/마감", topic: "마감 체크리스트", items: ["문을 잠근다"] },
      { category: "안전", topic: "화재 대응", items: ["소화기 확인"] },
    ]);
  });

  test("merged cells: a category present only on the first row of a block is forward-filled onto the blank rows below it", () => {
    const groups = parseExcelTableGroups([
      ["category", "title", "content"],
      ["오픈마감", "오픈 체크", "문 연다"],
      ["", "마감 체크", "문 잠근다"],
      ["", "마감후 확인", "조명 끄기"],
      ["안전", "화재 대응", "소화기 확인"],
    ]);

    assert.deepEqual(groups, [
      { category: "오픈마감", topic: "오픈 체크", items: ["문 연다"] },
      { category: "오픈마감", topic: "마감 체크", items: ["문 잠근다"] },
      { category: "오픈마감", topic: "마감후 확인", items: ["조명 끄기"] },
      { category: "안전", topic: "화재 대응", items: ["소화기 확인"] },
    ]);
  });

  test("horizontal/transposed structure normalizes to the exact same result as its vertical equivalent", () => {
    const vertical = [
      ["오픈마감", "오픈 체크", "문 연다"],
      ["오픈마감", "마감 체크", "문 잠근다"],
      ["안전", "화재 대응", "소화기 확인"],
    ];
    // Same data, but category/title are laid out along rows instead of down columns.
    const transposed = [
      ["오픈마감", "오픈마감", "안전"],
      ["오픈 체크", "마감 체크", "화재 대응"],
      ["문 연다", "문 잠근다", "소화기 확인"],
    ];

    const verticalResult = parseExcelTableGroups(vertical);
    const transposedResult = parseExcelTableGroups(transposed);

    assert.ok(verticalResult);
    assert.deepEqual(transposedResult, verticalResult);
  });

  test("numeric cells (as real JS numbers, like xlsx's sheet_to_json produces) are normalized to plain strings without error", () => {
    const groups = parseExcelTableGroups([
      ["category", "title", "content"],
      ["안전", 1 as unknown as string, "소화기 점검"],
      ["안전", 2 as unknown as string, "비상구 확인"],
    ]);

    assert.deepEqual(groups, [
      { category: "안전", topic: "1", items: ["소화기 점검"] },
      { category: "안전", topic: "2", items: ["비상구 확인"] },
    ]);
  });

  test("fully blank rows are dropped, and an exact-duplicate row does not create a duplicate manual", () => {
    const groups = parseExcelTableGroups([
      ["category", "title", "content"],
      ["카테고리A", "제목1", "내용1"],
      ["", "", ""],
      ["카테고리A", "제목1", "내용1"],
      ["카테고리A", "제목2", "내용2"],
    ]);

    assert.deepEqual(groups, [
      { category: "카테고리A", topic: "제목1", items: ["내용1"] },
      { category: "카테고리A", topic: "제목2", items: ["내용2"] },
    ]);
  });

  test("a column whose value is identical on every row (noise) is never chosen as category/title/content", () => {
    const groups = parseExcelTableGroups([
      ["같은값", "오픈마감", "오픈 체크", "문 연다"],
      ["같은값", "오픈마감", "마감 체크", "문 잠근다"],
      ["같은값", "안전", "화재 대응", "소화기 확인"],
    ]);

    assert.deepEqual(groups, [
      { category: "오픈마감", topic: "오픈 체크", items: ["문 연다"] },
      { category: "오픈마감", topic: "마감 체크", items: ["문 잠근다"] },
      { category: "안전", topic: "화재 대응", items: ["소화기 확인"] },
    ]);

    for (const group of groups ?? []) {
      assert.notEqual(group.category, "같은값");
      assert.notEqual(group.topic, "같은값");
      assert.ok(!group.items.includes("같은값"));
    }
  });

  test("a plain leading-number cell ('1.', '2.') splits one content cell into multiple items", () => {
    const groups = parseExcelTableGroups([
      ["category", "title", "content"],
      ["안전", "화재 대응", "1. 소화기 확인\n2. 비상구 확인"],
    ]);

    assert.deepEqual(groups?.[0].items, ["1. 소화기 확인", "2. 비상구 확인"]);
  });

  test("a sub-numbered ('4-1.'/'4-2.') cell keeps each section's follow-up lines grouped as one item", () => {
    const groups = parseExcelTableGroups([
      ["category", "title", "content"],
      ["안전", "점검 절차", "4-1. 청소 확인\n세부 설명\n4-2. 소독 확인"],
    ]);

    assert.deepEqual(groups?.[0].items, ["4-1. 청소 확인\n세부 설명", "4-2. 소독 확인"]);
  });

  test("an indented/tab-triggered cell groups its non-triggering follow-up line into the same item", () => {
    const groups = parseExcelTableGroups([
      ["category", "title", "content"],
      ["공지", "안내사항", "공지 시작\n\t세부 안내\n이어지는 설명"],
    ]);

    assert.deepEqual(groups?.[0].items, ["공지 시작", "세부 안내\n이어지는 설명"]);
  });

  test("Korean content with CRLF line endings is preserved without loss or corruption", () => {
    const groups = parseExcelTableGroups([
      ["category", "title", "content"],
      ["안내", "공지사항", "줄바꿈 확인\r\n두번째 줄"],
    ]);

    assert.equal(groups?.length, 1);
    assert.equal(groups?.[0].category, "안내");
    assert.equal(groups?.[0].topic, "공지사항");
    assert.equal(groups?.[0].items.length, 1);
    assert.match(groups![0].items[0], /줄바꿈 확인/);
    assert.match(groups![0].items[0], /두번째 줄/);
  });

  test("Korean content with LF blank-line paragraphs (no numbered boundary) splits into separate items per paragraph", () => {
    const groups = parseExcelTableGroups([
      ["category", "title", "content"],
      ["안내", "공지사항", "첫 문단입니다.\n\n둘째 문단입니다."],
    ]);

    assert.deepEqual(groups?.[0].items, ["첫 문단입니다.", "둘째 문단입니다."]);
  });

  test("an empty workbook/sheet (no rows at all) returns null, never throws", () => {
    assert.equal(parseExcelTableGroups([]), null);
  });

  test("a header row with zero data rows below it returns null", () => {
    assert.equal(parseExcelTableGroups([["category", "title", "content"]]), null);
  });

  test("a table with only one meaningful (non-repeating) column returns null instead of guessing a category axis", () => {
    assert.equal(
      parseExcelTableGroups([["내용만있음"], ["내용만있음2"], ["내용만있음3"]]),
      null,
    );
  });

  test("a table whose cells are all whitespace returns null (never persists a blank placeholder)", () => {
    assert.equal(
      parseExcelTableGroups([
        ["category", "title", "content"],
        ["   ", "   ", "   "],
      ]),
      null,
    );
  });
});


describe("app/api/manuals/upload/route.ts (Excel wiring contract)", () => {
  const source = readSource("app/api/manuals/upload/route.ts");

  test("routes .xlsx/.xls/.csv through parseExcelTableGroups first, falling back to parseManualText only when it returns null", () => {
    assert.match(source, /return parseExcelTableGroups\(rows\) \?\? parseManualText\(rowsToFlatText\(rows\)\)/);
  });

  test("still supports the existing .txt/.md/.docx contract unchanged (parseManualText, not the table parser)", () => {
    assert.match(source, /if \(TEXT_EXTENSIONS\.has\(extension\)\) \{\s*\n\s*return parseManualText\(await file\.text\(\)\);/);
    assert.match(source, /if \(extension === "\.docx"\) \{\s*\n\s*return parseManualText\(await extractDocxManualText\(file\)\);/);
  });

  test("the parsed groups are saved via saveManualGroupsWithChunks, the same function HQ manual create/store-manual create use", () => {
    assert.match(source, /const manuals = await saveManualGroupsWithChunks\(supabase, hqUser, groups\);/);
  });

  test("no AI/OpenAI/Vision classification is used for Excel parsing (parseManualText is a local-rules-only fallback)", () => {
    assert.equal(source.includes("openai"), false);
    assert.equal(source.toLowerCase().includes("vision"), false);
  });
});
