import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ERROR_CODES,
  VERBOSE_WARNING,
  buildErrorResult,
  buildReviewWarnings,
  buildSummaryRow,
  buildVerboseDetail,
  formatScore,
  getSafeEndpointOrigin,
} from "../../scripts/rag-eval/evaluate-rag-log.mjs";
import { CASES, evaluateCase } from "../../scripts/evaluate-rag.mjs";

const FAKE_STORE_ID = "57181130-4449-4299-a864-25a2098147e4";
const FAKE_TOKEN = "sk-test-super-secret-token-value";

const SAMPLE_TEST_CASE = {
  caseId: 1,
  store: "이수점",
  storeId: FAKE_STORE_ID,
  question: "이수점은 평일에 언제부터 언제까지 하나요?",
  expectedCategory: "지점운영",
  expectedAnswer: "이수점의 평일 영업시간은 오전 9시부터 오후 10시까지입니다.",
  positive: true,
};

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

describe("getSafeEndpointOrigin", () => {
  test("keeps only protocol+host+pathname", () => {
    const origin = getSafeEndpointOrigin("http://localhost:3000/api/rag/query?foo=bar#frag");
    assert.equal(origin, "http://localhost:3000/api/rag/query");
  });

  test("strips embedded userinfo credentials", () => {
    const origin = getSafeEndpointOrigin("https://user:pass@example.com/api/rag/query");
    assert.equal(origin, "https://example.com/api/rag/query");
    assert.equal(origin.includes("user"), false);
    assert.equal(origin.includes("pass"), false);
  });

  test("returns null for an invalid URL instead of throwing", () => {
    assert.equal(getSafeEndpointOrigin("not a url"), null);
  });
});

describe("formatScore", () => {
  test("formats a finite number to 4 decimals", () => {
    assert.equal(formatScore(0.6), "0.6000");
  });

  test("returns a dash for non-numeric or non-finite values", () => {
    assert.equal(formatScore(null), "-");
    assert.equal(formatScore(undefined), "-");
    assert.equal(formatScore(Number.NaN), "-");
    assert.equal(formatScore(Number.POSITIVE_INFINITY), "-");
  });
});

describe("buildErrorResult", () => {
  test("never includes a raw error message and defaults errorCode to NETWORK_ERROR", () => {
    const result = buildErrorResult(SAMPLE_TEST_CASE, {});
    assert.equal(result.errorCode, "NETWORK_ERROR");
    assert.equal(result.actualAnswer, "");
    assert.equal(result.topTitle, "-");
    assert.equal(result.topManualId, "-");
  });

  test("preserves the provided errorCode and httpStatus", () => {
    const result = buildErrorResult(SAMPLE_TEST_CASE, {
      errorCode: ERROR_CODES.HTTP_ERROR,
      httpStatus: 500,
      ragStatus: null,
    });
    assert.equal(result.errorCode, "HTTP_ERROR");
    assert.equal(result.httpStatus, 500);
  });
});

describe("buildSummaryRow", () => {
  test("does not include question, answer, store, storeId, manual title/id, or raw error text", () => {
    const result = {
      ...SAMPLE_TEST_CASE,
      actualAnswer: "실제 답변 원문",
      topTitle: "매뉴얼 제목",
      topManualId: "11111111-2222-3333-4444-555555555555",
      topCategory: "지점운영",
      httpStatus: 200,
      ragStatus: "answered",
      errorCode: null,
      rawSimilarity: 0.9123,
      keywordBoost: 0.1,
      finalSimilarity: 0.95,
    };

    const row = buildSummaryRow(result);
    const serialized = JSON.stringify(row);

    assert.equal("question" in row, false);
    assert.equal("expectedAnswer" in row, false);
    assert.equal("actualAnswer" in row, false);
    assert.equal("store" in row, false);
    assert.equal("storeId" in row, false);
    assert.equal("topManualId" in row, false);
    assert.equal("topTitle" in row, false);
    assert.equal(serialized.includes(FAKE_STORE_ID), false);
    assert.equal(serialized.includes("실제 답변 원문"), false);
    assert.equal(serialized.includes("매뉴얼 제목"), false);
    assert.equal(row.case, 1);
    assert.equal(row.ragStatus, "answered");
    assert.equal(row.httpStatus, 200);
  });
});

describe("buildVerboseDetail", () => {
  test("exposes only case/question/expectedAnswer/actualAnswer", () => {
    const result = {
      ...SAMPLE_TEST_CASE,
      actualAnswer: "실제 답변",
      storeId: FAKE_STORE_ID,
    };
    const detail = buildVerboseDetail(result);

    assert.deepEqual(Object.keys(detail).sort(), ["actualAnswer", "case", "expectedAnswer", "question"]);
    assert.equal(detail.question, SAMPLE_TEST_CASE.question);
    assert.equal(detail.actualAnswer, "실제 답변");
  });

  test("never includes storeId, tokens, or UUIDs even though the source result carries them", () => {
    const result = {
      ...SAMPLE_TEST_CASE,
      actualAnswer: "실제 답변",
      storeId: FAKE_STORE_ID,
      authorizationHeader: `Bearer ${FAKE_TOKEN}`,
    };
    const serialized = JSON.stringify(buildVerboseDetail(result));

    assert.equal(serialized.includes(FAKE_STORE_ID), false);
    assert.equal(serialized.includes(FAKE_TOKEN), false);
  });
});

describe("buildReviewWarnings", () => {
  test("flags an empty actualAnswer without printing the question or store", () => {
    const warnings = buildReviewWarnings({ ...SAMPLE_TEST_CASE, actualAnswer: "", topManualId: "some-id" });
    assert.equal(warnings.some((line) => line.includes("actualAnswer is empty")), true);
    assert.equal(warnings.some((line) => line.includes(SAMPLE_TEST_CASE.question)), false);
  });

  test("flags a missing source", () => {
    const warnings = buildReviewWarnings({ ...SAMPLE_TEST_CASE, actualAnswer: "답변", topManualId: "-" });
    assert.equal(warnings.some((line) => line.includes("source is missing")), true);
  });
});

describe("VERBOSE_WARNING", () => {
  test("is a non-empty safety notice", () => {
    assert.equal(typeof VERBOSE_WARNING, "string");
    assert.equal(VERBOSE_WARNING.length > 0, true);
  });
});

describe("evaluateCase (with injected fetchImpl, no real network)", () => {
  test("returns NETWORK_ERROR without leaking the thrown error's message", async () => {
    const secretDetail = "internal-secret-detail-should-not-leak";
    const fetchImpl = async () => {
      throw new Error(secretDetail);
    };

    const result = await evaluateCase(SAMPLE_TEST_CASE, { fetchImpl });

    assert.equal(result.errorCode, "NETWORK_ERROR");
    assert.equal(JSON.stringify(result).includes(secretDetail), false);
  });

  test("returns INVALID_JSON_RESPONSE when response.json() rejects", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token");
      },
    });

    const result = await evaluateCase(SAMPLE_TEST_CASE, { fetchImpl });
    assert.equal(result.errorCode, "INVALID_JSON_RESPONSE");
    assert.equal(result.httpStatus, 200);
  });

  test("returns HTTP_ERROR for a non-2xx response", async () => {
    const fetchImpl = async () => jsonResponse(500, { error: "Internal error detail" });

    const result = await evaluateCase(SAMPLE_TEST_CASE, { fetchImpl });
    assert.equal(result.errorCode, "HTTP_ERROR");
    assert.equal(result.httpStatus, 500);
  });

  test("returns MISSING_RESPONSE_FIELDS when answer/status are absent", async () => {
    const fetchImpl = async () => jsonResponse(200, { foo: "bar" });

    const result = await evaluateCase(SAMPLE_TEST_CASE, { fetchImpl });
    assert.equal(result.errorCode, "MISSING_RESPONSE_FIELDS");
  });

  test("returns a successful result with httpStatus/ragStatus and no errorCode", async () => {
    const fetchImpl = async () => jsonResponse(200, {
      answer: "영업시간은 9시부터입니다.",
      status: "answered",
      source: { manualId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      matches: [{ title: "영업시간 매뉴얼", category: "지점운영", rawSimilarity: 0.9, keywordBoost: 0.05, similarity: 0.95 }],
    });

    const result = await evaluateCase(SAMPLE_TEST_CASE, { fetchImpl });

    assert.equal(result.errorCode, null);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.ragStatus, "answered");
    assert.equal(result.finalSimilarity, 0.95);
  });

  test("calls fetchImpl exactly once per case", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse(200, { answer: "답변", status: "answered" });
    };

    await evaluateCase(SAMPLE_TEST_CASE, { fetchImpl });
    assert.equal(calls, 1);
  });
});

describe("CASES", () => {
  test("every case has a sequential, non-identifying caseId", () => {
    CASES.forEach((testCase, index) => {
      assert.equal(testCase.caseId, index + 1);
    });
  });
});
