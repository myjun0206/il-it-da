import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { gradeCase, summarizeResults } from "../../scripts/rag-eval/grading.mjs";

const BASE_CASE = {
  question_id: "q-001",
  expected_status: "answered",
  expected_keywords: ["9시", "10시"],
  forbidden_content: ["모르겠습니다"],
};

describe("gradeCase", () => {
  test("passes when status matches, keywords are present, and no forbidden content appears", () => {
    const result = gradeCase(BASE_CASE, {
      status: "answered",
      answer: "영업시간은 오전 9시부터 오후 10시까지입니다.",
    });

    assert.equal(result.pass, true);
    assert.equal(result.statusMatched, true);
    assert.equal(result.keywordPassed, true);
    assert.equal(result.forbiddenPassed, true);
    assert.equal(result.questionId, "q-001");
  });

  test("fails when the status does not match", () => {
    const result = gradeCase(BASE_CASE, {
      status: "cautious",
      answer: "영업시간은 오전 9시부터 오후 10시까지입니다.",
    });

    assert.equal(result.statusMatched, false);
    assert.equal(result.pass, false);
  });

  test("fails when a required keyword is missing from the answer", () => {
    const result = gradeCase(BASE_CASE, {
      status: "answered",
      answer: "영업시간은 오전 9시부터입니다.",
    });

    assert.equal(result.keywordPassed, false);
    assert.equal(result.missingKeywordCount, 1);
    assert.equal(result.pass, false);
  });

  test("fails when forbidden content appears in the answer", () => {
    const result = gradeCase(BASE_CASE, {
      status: "answered",
      answer: "영업시간은 오전 9시부터 오후 10시까지지만 정확히는 모르겠습니다.",
    });

    assert.equal(result.forbiddenPassed, false);
    assert.equal(result.forbiddenMatchCount, 1);
    assert.equal(result.pass, false);
  });

  test("matches keywords and forbidden content regardless of case or extra whitespace", () => {
    const result = gradeCase(BASE_CASE, {
      status: "answered",
      answer: "영업시간은   오전 9시부터\n오후 10시까지입니다.",
    });

    assert.equal(result.keywordPassed, true);
    assert.equal(result.forbiddenPassed, true);
  });

  test("treats missing keyword/forbidden arrays as automatically passing", () => {
    const result = gradeCase(
      { question_id: "q-002", expected_status: "insufficient" },
      { status: "insufficient", answer: "매장 관리자에게 문의해 주세요." },
    );

    assert.equal(result.keywordPassed, true);
    assert.equal(result.forbiddenPassed, true);
    assert.equal(result.pass, true);
  });

  test("does not include the question text or full answer in the result", () => {
    const result = gradeCase(BASE_CASE, {
      status: "answered",
      answer: "영업시간은 오전 9시부터 오후 10시까지입니다.",
    });

    assert.deepEqual(Object.keys(result).sort(), [
      "actualStatus",
      "expectedStatus",
      "forbiddenMatchCount",
      "forbiddenPassed",
      "keywordPassed",
      "missingKeywordCount",
      "pass",
      "questionId",
      "statusMatched",
    ]);
  });
});

describe("summarizeResults", () => {
  test("returns zeroed, non-NaN values for an empty result set", () => {
    const summary = summarizeResults([]);

    assert.deepEqual(summary, {
      total: 0,
      passed: 0,
      failed: 0,
      passRate: 0,
      statusMatched: 0,
      statusAccuracy: 0,
      keywordPassed: 0,
      keywordPassRate: 0,
      forbiddenViolations: 0,
      errorCount: 0,
    });
  });

  test("summarizes a mix of passing and failing results", () => {
    const results = [
      gradeCase(BASE_CASE, { status: "answered", answer: "9시부터 10시까지입니다." }),
      gradeCase(BASE_CASE, { status: "cautious", answer: "9시부터 10시까지입니다." }),
      gradeCase(BASE_CASE, { status: "answered", answer: "9시부터입니다." }),
    ];

    const summary = summarizeResults(results);

    assert.equal(summary.total, 3);
    assert.equal(summary.passed, 1);
    assert.equal(summary.failed, 2);
    assert.equal(summary.passRate, 1 / 3);
    assert.equal(summary.statusMatched, 2);
    assert.equal(summary.statusAccuracy, 2 / 3);
    assert.equal(summary.keywordPassed, 2);
    assert.equal(summary.keywordPassRate, 2 / 3);
    assert.equal(summary.forbiddenViolations, 0);
  });

  test("counts error entries separately from graded pass/fail results", () => {
    const results = [
      gradeCase(BASE_CASE, { status: "answered", answer: "9시부터 10시까지입니다." }),
      { error: true, questionId: "q-999" },
    ];

    const summary = summarizeResults(results);

    assert.equal(summary.total, 2);
    assert.equal(summary.errorCount, 1);
    assert.equal(summary.passed, 1);
    assert.equal(summary.failed, 0);
    assert.equal(summary.statusAccuracy, 1);
  });
});
