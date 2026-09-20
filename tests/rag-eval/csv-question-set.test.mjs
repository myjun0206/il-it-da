import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  loadCsvQuestionSet,
  parseQuestionSetCsv,
} from "../../scripts/rag-eval/csv-question-set.mjs";

const HEADER =
  "question_id,question_type,manual_scope,target_store,category,question,expected_status,expected_result,expected_keywords,forbidden_content,priority,note";

function csvOf(...rows) {
  return [HEADER, ...rows].join("\n");
}

describe("parseQuestionSetCsv", () => {
  test("converts a normal Korean CSV question set", () => {
    const csv = csvOf(
      "q-001,normal,store,이수점,카테고리,영업시간이 어떻게 되나요?,answered,영업시간 답변입니다,영업시간|9시,모르겠습니다,medium,메모",
    );

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, true);
    assert.equal(result.data.length, 1);
    assert.deepEqual(result.data[0], {
      question_id: "q-001",
      question_type: "normal",
      manual_scope: "store",
      target_store: "이수점",
      category: "카테고리",
      question: "영업시간이 어떻게 되나요?",
      expected_status: "answered",
      expected_result: "영업시간 답변입니다",
      expected_keywords: ["영업시간", "9시"],
      forbidden_content: ["모르겠습니다"],
      priority: "medium",
      note: "메모",
    });
  });

  test("supports a quoted field containing a comma", () => {
    const csv = csvOf(
      'q-002,normal,store,이수점,"카테고리, 세부",질문 내용입니다,answered,,,,,',
    );

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, true);
    assert.equal(result.data[0].category, "카테고리, 세부");
  });

  test("supports an embedded newline inside a quoted cell", () => {
    const csv = csvOf(
      'q-003,normal,store,이수점,카테고리,"줄바꿈\n테스트 질문입니다",answered,,,,,',
    );

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, true);
    assert.equal(result.data[0].question, "줄바꿈\n테스트 질문입니다");
  });

  test("supports an escaped double quote inside a quoted cell", () => {
    const csv = csvOf(
      'q-004,normal,store,이수점,"그는 ""좋다""라고 말했다",질문입니다,answered,,,,,',
    );

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, true);
    assert.equal(result.data[0].category, '그는 "좋다"라고 말했다');
  });

  test("trims leading/trailing whitespace in header names", () => {
    const paddedHeader = HEADER.split(",")
      .map((name) => ` ${name} `)
      .join(",");
    const csv = [paddedHeader, "q-005,normal,store,이수점,카테고리,질문입니다,answered,,,,,"].join("\n");

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, true);
    assert.equal(result.data[0].question_id, "q-005");
  });

  test("splits expected_keywords and forbidden_content on |, trimming and dropping empty tokens", () => {
    const csv = csvOf(
      "q-006,normal,store,이수점,카테고리,질문입니다,answered,,영업시간 | 9시 ||,모르겠습니다||,medium,",
    );

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, true);
    assert.deepEqual(result.data[0].expected_keywords, ["영업시간", "9시"]);
    assert.deepEqual(result.data[0].forbidden_content, ["모르겠습니다"]);
  });

  test("omits blank optional fields instead of writing empty strings", () => {
    const csv = csvOf("q-007,normal,,이수점,,질문입니다,answered,,,,,");

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, true);
    const record = result.data[0];
    assert.equal("manual_scope" in record, false);
    assert.equal("category" in record, false);
    assert.equal("expected_keywords" in record, false);
    assert.equal("forbidden_content" in record, false);
    assert.equal("priority" in record, false);
    assert.equal("note" in record, false);
  });

  test("keeps a numeric-looking question_id as a string", () => {
    const csv = csvOf("007,normal,store,이수점,카테고리,질문입니다,answered,,,,,");

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, true);
    assert.equal(result.data[0].question_id, "007");
  });

  test("skips fully blank rows", () => {
    const csv = [
      HEADER,
      "q-008,normal,store,이수점,카테고리,질문입니다,answered,,,,,",
      ",,,,,,,,,,,",
      "q-009,normal,store,이수점,카테고리,다른 질문입니다,answered,,,,,",
    ].join("\n");

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, true);
    assert.equal(result.data.length, 2);
  });

  test("reports a missing required header", () => {
    const headerWithoutStatus = HEADER.split(",")
      .filter((name) => name !== "expected_status")
      .join(",");
    const csv = [headerWithoutStatus, "q-010,normal,store,이수점,카테고리,질문입니다,,,,,"].join("\n");

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(
        (error) => error.row === 1 && error.field === "expected_status" && error.code === "MISSING_REQUIRED_HEADER",
      ),
    );
  });

  test("reports a duplicate header", () => {
    const csv = [`${HEADER},question_id`, "q-011,normal,store,이수점,카테고리,질문입니다,answered,,,,,,q-011"].join(
      "\n",
    );

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(
        (error) => error.row === 1 && error.field === "question_id" && error.code === "DUPLICATE_HEADER",
      ),
    );
  });

  test("reports an unknown header", () => {
    const csv = [`${HEADER},extra_col`, "q-012,normal,store,이수점,카테고리,질문입니다,answered,,,,,,값"].join("\n");

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((error) => error.row === 1 && error.field === "extra_col" && error.code === "UNKNOWN_HEADER"),
    );
  });

  test("reports a required cell that is blank", () => {
    const csv = csvOf("q-013,normal,store,이수점,카테고리,   ,answered,,,,,");

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(
        (error) => error.row === 2 && error.field === "question" && error.code === "QUESTION_EMPTY",
      ),
    );
  });

  test("accepts a question exactly at the 2000 character limit", () => {
    const longQuestion = "가".repeat(2_000);
    const csv = csvOf(`q-014,normal,store,이수점,카테고리,${longQuestion},answered,,,,,`);

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, true);
  });

  test("maps a validateQuestionSet error back to the correct CSV row number", () => {
    const csv = csvOf(
      "q-015,normal,store,이수점,카테고리,첫 번째 질문입니다,answered,,,,,",
      "q-016,not-a-real-type,store,이수점,카테고리,두 번째 질문입니다,answered,,,,,",
    );

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(
        (error) => error.row === 3 && error.questionId === "q-016" && error.code === "INVALID_ENUM_VALUE",
      ),
    );
  });

  test("accumulates errors from multiple rows instead of stopping at the first", () => {
    const csv = csvOf(
      "q-017,not-a-real-type,store,이수점,카테고리,첫 번째 질문입니다,answered,,,,,",
      "q-018,normal,store,이수점,카테고리,   ,answered,,,,,",
    );

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.row === 2));
    assert.ok(result.errors.some((error) => error.row === 3));
  });

  test("does not include the question text or the full CSV row in error results", () => {
    const secretLikeQuestion = "이것은-절대-로그에-남으면-안되는-질문-원문-VERY-SECRET-TEXT";
    const csv = csvOf(`q-019,not-a-real-type,store,이수점,카테고리,${secretLikeQuestion},answered,,,,,`);

    const result = parseQuestionSetCsv(csv);

    assert.equal(result.valid, false);
    for (const error of result.errors) {
      assert.deepEqual(Object.keys(error).sort(), ["code", "field", "questionId", "row"]);
    }
    assert.equal(JSON.stringify(result.errors).includes(secretLikeQuestion), false);
  });
});

describe("loadCsvQuestionSet", () => {
  let tempDir;

  before(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "rag-eval-csv-"));
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("strips a UTF-8 BOM before parsing", () => {
    const filePath = path.join(tempDir, "bom.csv");
    const csv = csvOf("q-020,normal,store,이수점,카테고리,질문입니다,answered,,,,,");
    writeFileSync(filePath, `\uFEFF${csv}`, "utf8");

    const result = loadCsvQuestionSet(filePath);

    assert.equal(result.valid, true);
    assert.equal(result.data.length, 1);
  });

  test("throws a distinct error when the file cannot be read", () => {
    const filePath = path.join(tempDir, "does-not-exist.csv");

    assert.throws(() => loadCsvQuestionSet(filePath), (error) => {
      assert.equal(error.code, "CSV_READ_ERROR");
      return true;
    });
  });
});
