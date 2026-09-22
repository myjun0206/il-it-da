import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  loadQuestionSet,
  normalizeText,
  validateQuestionSet,
} from "../../scripts/rag-eval/question-set.mjs";

const VALID_ITEM = {
  question_id: "q-001",
  question_type: "normal",
  target_store: "이수점",
  question: "이수점은 평일에 언제부터 언제까지 하나요?",
  expected_status: "answered",
  manual_scope: "store",
  category: "지점운영",
  expected_result: "평일 오전 9시부터 오후 10시까지 운영합니다.",
  expected_keywords: ["9시", "10시"],
  forbidden_content: ["모르겠습니다"],
  priority: "high",
  note: "샘플 케이스",
};

describe("normalizeText", () => {
  test("trims, lowercases, and collapses whitespace", () => {
    assert.equal(normalizeText("  Hello   World \n\n"), "hello world");
  });

  test("normalizes Korean text consistently", () => {
    assert.equal(normalizeText("영업시간은   몇시 인가요?\n"), "영업시간은 몇시 인가요?");
  });

  test("returns an empty string for non-string input", () => {
    assert.equal(normalizeText(undefined), "");
    assert.equal(normalizeText(null), "");
    assert.equal(normalizeText(123), "");
  });
});

describe("validateQuestionSet", () => {
  test("accepts a fully valid question set", () => {
    const result = validateQuestionSet([VALID_ITEM]);

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.ok(Array.isArray(result.data));
    assert.equal(result.data.length, 1);
  });

  test("rejects a non-array top-level value", () => {
    const result = validateQuestionSet({ not: "an array" });

    assert.equal(result.valid, false);
    assert.equal(result.data, null);
    assert.deepEqual(result.errors, [
      { index: null, questionId: null, field: "root", code: "TOP_LEVEL_NOT_ARRAY" },
    ]);
  });

  test("reports a required field missing error", () => {
    const item = { ...VALID_ITEM };
    delete item.question_type;

    const result = validateQuestionSet([item]);

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(
        (error) => error.field === "question_type" && error.code === "REQUIRED_FIELD_MISSING",
      ),
    );
  });

  test("reports an invalid enum value", () => {
    const result = validateQuestionSet([{ ...VALID_ITEM, target_store: "부산점" }]);

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(
        (error) => error.field === "target_store" && error.code === "INVALID_ENUM_VALUE",
      ),
    );
  });

  test("reports a duplicate question_id without stopping at the first error", () => {
    const result = validateQuestionSet([
      { ...VALID_ITEM, target_store: "숭실대점" },
      { ...VALID_ITEM },
    ]);

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(
        (error) =>
          error.index === 1 && error.field === "question_id" && error.code === "DUPLICATE_QUESTION_ID",
      ),
    );
  });

  test("rejects an empty question", () => {
    const result = validateQuestionSet([{ ...VALID_ITEM, question: "   " }]);

    assert.ok(
      result.errors.some((error) => error.field === "question" && error.code === "QUESTION_EMPTY"),
    );
  });

  test("accepts a question exactly at the 2000 character limit", () => {
    const result = validateQuestionSet([{ ...VALID_ITEM, question: "가".repeat(2_000) }]);

    assert.equal(result.valid, true);
  });

  test("rejects a question over the 2000 character limit", () => {
    const result = validateQuestionSet([{ ...VALID_ITEM, question: "가".repeat(2_001) }]);

    assert.ok(
      result.errors.some((error) => error.field === "question" && error.code === "QUESTION_TOO_LONG"),
    );
  });

  test("rejects expected_keywords that is not an array of strings", () => {
    const result = validateQuestionSet([{ ...VALID_ITEM, expected_keywords: ["ok", 123] }]);

    assert.ok(
      result.errors.some(
        (error) => error.field === "expected_keywords" && error.code === "INVALID_ARRAY_OF_STRINGS",
      ),
    );
  });

  test("rejects an empty string inside expected_keywords", () => {
    const result = validateQuestionSet([{ ...VALID_ITEM, expected_keywords: ["ok", "   "] }]);

    assert.ok(
      result.errors.some(
        (error) => error.field === "expected_keywords" && error.code === "EMPTY_STRING_IN_ARRAY",
      ),
    );
  });

  test("does not include the original question text in error objects", () => {
    const result = validateQuestionSet([{ ...VALID_ITEM, question_type: "invalid" }]);

    for (const error of result.errors) {
      assert.deepEqual(Object.keys(error).sort(), ["code", "field", "index", "questionId"]);
      assert.equal(JSON.stringify(error).includes(VALID_ITEM.question), false);
    }
  });
});

describe("loadQuestionSet", () => {
  let tempDir;

  before(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "rag-eval-question-set-"));
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("loads and validates a plain UTF-8 JSON file", () => {
    const filePath = path.join(tempDir, "valid.json");
    writeFileSync(filePath, JSON.stringify([VALID_ITEM]), "utf8");

    const result = loadQuestionSet(filePath);

    assert.equal(result.valid, true);
    assert.equal(result.data.length, 1);
  });

  test("strips a UTF-8 BOM before parsing", () => {
    const filePath = path.join(tempDir, "bom.json");
    writeFileSync(filePath, `\uFEFF${JSON.stringify([VALID_ITEM])}`, "utf8");

    const result = loadQuestionSet(filePath);

    assert.equal(result.valid, true);
    assert.equal(result.data.length, 1);
  });

  test("throws a distinct error for invalid JSON syntax", () => {
    const filePath = path.join(tempDir, "invalid.json");
    writeFileSync(filePath, "{ not valid json", "utf8");

    assert.throws(() => loadQuestionSet(filePath), (error) => {
      assert.equal(error.code, "QUESTION_SET_JSON_SYNTAX_ERROR");
      return true;
    });
  });

  test("throws a distinct error when the file cannot be read", () => {
    const filePath = path.join(tempDir, "does-not-exist.json");

    assert.throws(() => loadQuestionSet(filePath), (error) => {
      assert.equal(error.code, "QUESTION_SET_READ_ERROR");
      return true;
    });
  });
});
