import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { analyzeQuestionSet, computeRate } from "../../scripts/rag-eval/analyze-question-set.mjs";

function makeItem(overrides = {}) {
  return {
    question_id: "QA-001",
    question_type: "normal",
    target_store: "이수점",
    question: "질문 내용입니다",
    expected_status: "answered",
    expected_keywords: ["키워드"],
    forbidden_content: ["금지어"],
    category: "카테고리",
    priority: "medium",
    note: "메모",
    expected_result: "기대 결과",
    ...overrides,
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe("computeRate", () => {
  test("returns 0 when the denominator is 0", () => {
    assert.equal(computeRate(0, 0), 0);
    assert.equal(computeRate(5, 0), 0);
  });

  test("never returns NaN or Infinity", () => {
    assert.equal(Number.isFinite(computeRate(0, 0)), true);
    assert.equal(Number.isFinite(computeRate(1, 0)), true);
  });

  test("rounds to 4 decimal places", () => {
    assert.equal(computeRate(1, 3), 0.3333);
  });
});

describe("analyzeQuestionSet", () => {
  test("analyzes a balanced dataset without unexpected warnings", () => {
    const dataset = [
      makeItem({ question_id: "QA-001", target_store: "이수점", expected_status: "answered" }),
      makeItem({ question_id: "QA-002", target_store: "숭실대점", expected_status: "cautious" }),
      makeItem({
        question_id: "QA-003",
        question_type: "out_of_scope",
        target_store: "all",
        expected_status: "insufficient",
        expected_keywords: undefined,
      }),
    ];

    const analysis = analyzeQuestionSet(dataset);

    assert.equal(analysis.total, 3);
    assert.equal(analysis.distributions.expectedStatus.answered, 1);
    assert.equal(analysis.distributions.expectedStatus.cautious, 1);
    assert.equal(analysis.distributions.expectedStatus.insufficient, 1);
    assert.equal(
      analysis.warnings.some((warning) => warning.code === "STATUS_NOT_COVERED"),
      false,
    );
  });

  test("flags EMPTY_DATASET for a zero-length question set", () => {
    const analysis = analyzeQuestionSet([]);

    assert.equal(analysis.total, 0);
    assert.deepEqual(analysis.warnings, [{ code: "EMPTY_DATASET", severity: "warning", count: 0 }]);
  });

  test("counts every expected_status value in the distribution", () => {
    const dataset = [
      makeItem({ question_id: "QA-001", expected_status: "answered" }),
      makeItem({ question_id: "QA-002", expected_status: "cautious" }),
      makeItem({ question_id: "QA-003", expected_status: "insufficient", expected_keywords: undefined }),
    ];

    const analysis = analyzeQuestionSet(dataset);

    assert.deepEqual(analysis.distributions.expectedStatus, { answered: 1, cautious: 1, insufficient: 1 });
  });

  test("counts every question_type value in the distribution", () => {
    const dataset = [
      makeItem({ question_id: "QA-001", question_type: "normal" }),
      makeItem({ question_id: "QA-002", question_type: "paraphrase" }),
      makeItem({ question_id: "QA-003", question_type: "out_of_scope" }),
    ];

    const analysis = analyzeQuestionSet(dataset);

    assert.equal(analysis.distributions.questionType.normal, 1);
    assert.equal(analysis.distributions.questionType.paraphrase, 1);
    assert.equal(analysis.distributions.questionType.out_of_scope, 1);
    assert.equal(analysis.distributions.questionType.insufficient, 0);
    assert.equal(analysis.distributions.questionType.store_isolation, 0);
  });

  test("builds a dynamic target_store distribution from observed values only", () => {
    const dataset = [
      makeItem({ question_id: "QA-001", target_store: "이수점" }),
      makeItem({ question_id: "QA-002", target_store: "이수점" }),
    ];

    const analysis = analyzeQuestionSet(dataset);

    assert.deepEqual(analysis.distributions.targetStore, { 이수점: 2 });
  });

  test("builds dynamic category/priority/manual_scope distributions", () => {
    const dataset = [
      makeItem({ question_id: "QA-001", category: "지점운영", priority: "high", manual_scope: "store" }),
      makeItem({ question_id: "QA-002", category: "재고", priority: "low", manual_scope: "hq" }),
    ];

    const analysis = analyzeQuestionSet(dataset);

    assert.deepEqual(analysis.distributions.category, { 지점운영: 1, 재고: 1 });
    assert.deepEqual(analysis.distributions.priority, { high: 1, low: 1 });
    assert.deepEqual(analysis.distributions.manualScope, { store: 1, hq: 1 });
  });

  test("computes completeness for optional fields", () => {
    const dataset = [
      makeItem({ question_id: "QA-001" }),
      makeItem({
        question_id: "QA-002",
        expected_keywords: undefined,
        forbidden_content: undefined,
        expected_result: undefined,
        category: undefined,
        note: undefined,
      }),
    ];

    const analysis = analyzeQuestionSet(dataset);

    assert.equal(analysis.completeness.withExpectedKeywords, 1);
    assert.equal(analysis.completeness.withoutExpectedKeywords, 1);
    assert.equal(analysis.completeness.withForbiddenContent, 1);
    assert.equal(analysis.completeness.withoutForbiddenContent, 1);
    assert.equal(analysis.completeness.withExpectedResult, 1);
    assert.equal(analysis.completeness.withoutExpectedResult, 1);
    assert.equal(analysis.completeness.withCategory, 1);
    assert.equal(analysis.completeness.withoutCategory, 1);
    assert.equal(analysis.completeness.withNote, 1);
    assert.equal(analysis.completeness.withoutNote, 1);
  });

  test("flags ANSWERED_WITHOUT_KEYWORDS", () => {
    const dataset = [makeItem({ question_id: "QA-001", expected_status: "answered", expected_keywords: [] })];
    const analysis = analyzeQuestionSet(dataset);

    const warning = analysis.warnings.find((entry) => entry.code === "ANSWERED_WITHOUT_KEYWORDS");
    assert.deepEqual(warning, {
      code: "ANSWERED_WITHOUT_KEYWORDS",
      severity: "warning",
      count: 1,
      questionIds: ["QA-001"],
    });
  });

  test("flags CAUTIOUS_WITHOUT_KEYWORDS", () => {
    const dataset = [makeItem({ question_id: "QA-001", expected_status: "cautious", expected_keywords: undefined })];
    const analysis = analyzeQuestionSet(dataset);

    const warning = analysis.warnings.find((entry) => entry.code === "CAUTIOUS_WITHOUT_KEYWORDS");
    assert.deepEqual(warning.questionIds, ["QA-001"]);
  });

  test("flags INSUFFICIENT_WITH_EXPECTED_KEYWORDS", () => {
    const dataset = [
      makeItem({ question_id: "QA-001", expected_status: "insufficient", expected_keywords: ["키워드"] }),
    ];
    const analysis = analyzeQuestionSet(dataset);

    const warning = analysis.warnings.find((entry) => entry.code === "INSUFFICIENT_WITH_EXPECTED_KEYWORDS");
    assert.deepEqual(warning.questionIds, ["QA-001"]);
  });

  test("flags CATEGORY_MISSING", () => {
    const dataset = [makeItem({ question_id: "QA-001", category: undefined })];
    const analysis = analyzeQuestionSet(dataset);

    const warning = analysis.warnings.find((entry) => entry.code === "CATEGORY_MISSING");
    assert.deepEqual(warning.questionIds, ["QA-001"]);
  });

  test("flags PRIORITY_MISSING", () => {
    const dataset = [makeItem({ question_id: "QA-001", priority: undefined })];
    const analysis = analyzeQuestionSet(dataset);

    const warning = analysis.warnings.find((entry) => entry.code === "PRIORITY_MISSING");
    assert.deepEqual(warning.questionIds, ["QA-001"]);
  });

  test("flags STORE_NOT_COVERED when only target_store='all' is used", () => {
    const dataset = [makeItem({ question_id: "QA-001", target_store: "all" })];
    const analysis = analyzeQuestionSet(dataset);

    assert.ok(analysis.warnings.some((warning) => warning.code === "STORE_NOT_COVERED"));
  });

  test("does not flag STORE_NOT_COVERED once a specific store appears", () => {
    const dataset = [makeItem({ question_id: "QA-001", target_store: "이수점" })];
    const analysis = analyzeQuestionSet(dataset);

    assert.equal(
      analysis.warnings.some((warning) => warning.code === "STORE_NOT_COVERED"),
      false,
    );
  });

  test("defensively detects a duplicate questionId even though the validator normally rejects it", () => {
    const dataset = [makeItem({ question_id: "QA-DUP" }), makeItem({ question_id: "QA-DUP" })];
    const analysis = analyzeQuestionSet(dataset);

    const warning = analysis.warnings.find((entry) => entry.code === "DUPLICATE_QUESTION_ID");
    assert.deepEqual(warning, {
      code: "DUPLICATE_QUESTION_ID",
      severity: "warning",
      count: 1,
      questionIds: ["QA-DUP"],
    });
  });

  test("sorts and deduplicates questionIds within a warning", () => {
    const dataset = [
      makeItem({ question_id: "QA-003", category: undefined }),
      makeItem({ question_id: "QA-001", category: undefined }),
      makeItem({ question_id: "QA-001", category: undefined }),
    ];
    const analysis = analyzeQuestionSet(dataset);

    const warning = analysis.warnings.find((entry) => entry.code === "CATEGORY_MISSING");
    assert.deepEqual(warning.questionIds, ["QA-001", "QA-003"]);
  });

  test("does not mutate the input question set", () => {
    const dataset = deepFreeze([makeItem({ question_id: "QA-001" }), makeItem({ question_id: "QA-002" })]);

    assert.doesNotThrow(() => analyzeQuestionSet(dataset));
  });

  test("never returns question text, expected_result text, keyword/forbidden text, or storeId", () => {
    const dataset = [
      makeItem({
        question_id: "QA-001",
        question: "이것은 절대 노출되면 안 되는 질문 원문입니다",
        expected_result: "이것도 노출되면 안 되는 기대 결과 원문입니다",
        expected_keywords: ["절대노출금지키워드"],
        forbidden_content: ["절대노출금지금지어"],
      }),
    ];

    const analysis = analyzeQuestionSet(dataset);
    const serialized = JSON.stringify(analysis);

    assert.equal(serialized.includes("절대 노출되면 안 되는 질문 원문"), false);
    assert.equal(serialized.includes("노출되면 안 되는 기대 결과 원문"), false);
    assert.equal(serialized.includes("절대노출금지키워드"), false);
    assert.equal(serialized.includes("절대노출금지금지어"), false);
  });
});
