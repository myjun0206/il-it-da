import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { validateQueryRequest } from "../../lib/rag/validate-query-request.ts";

const VALID_STORE_ID = "57181130-4449-4299-a864-25a2098147e4";

describe("validateQueryRequest", () => {
  test("rejects a non-object body", () => {
    assert.deepEqual(validateQueryRequest("invalid"), {
      success: false,
      error: "Invalid JSON body.",
      status: 400,
    });
  });

  test("rejects a missing question", () => {
    assert.equal(validateQueryRequest({ storeId: VALID_STORE_ID }).success, false);
  });

  test("rejects a non-string question", () => {
    assert.equal(validateQueryRequest({ question: 123, storeId: VALID_STORE_ID }).success, false);
  });

  test("rejects an empty question", () => {
    assert.equal(validateQueryRequest({ question: "   ", storeId: VALID_STORE_ID }).success, false);
  });

  test("rejects a question over the maximum length", () => {
    assert.deepEqual(validateQueryRequest({ question: "가".repeat(2_001), storeId: VALID_STORE_ID }), {
      success: false,
      error: "question must be 2000 characters or fewer.",
      status: 413,
    });
  });

  test("rejects a missing storeId", () => {
    assert.equal(validateQueryRequest({ question: "영업시간을 알려주세요." }).success, false);
  });

  test("rejects a non-string storeId", () => {
    assert.equal(validateQueryRequest({ question: "영업시간을 알려주세요.", storeId: 123 }).success, false);
  });

  test("rejects an empty storeId", () => {
    assert.equal(validateQueryRequest({ question: "영업시간을 알려주세요.", storeId: "  " }).success, false);
  });

  test("rejects an invalid UUID storeId", () => {
    assert.deepEqual(validateQueryRequest({ question: "영업시간을 알려주세요.", storeId: "store-1" }), {
      success: false,
      error: "storeId must be a valid UUID.",
      status: 400,
    });
  });

  test("accepts a valid question and storeId", () => {
    assert.deepEqual(validateQueryRequest({ question: "영업시간을 알려주세요.", storeId: VALID_STORE_ID }), {
      success: true,
      data: { question: "영업시간을 알려주세요.", storeId: VALID_STORE_ID },
    });
  });

  test("trims question and storeId whitespace", () => {
    assert.deepEqual(validateQueryRequest({
      question: "  영업시간을 알려주세요.  ",
      storeId: `  ${VALID_STORE_ID}  `,
    }), {
      success: true,
      data: { question: "영업시간을 알려주세요.", storeId: VALID_STORE_ID },
    });
  });
});