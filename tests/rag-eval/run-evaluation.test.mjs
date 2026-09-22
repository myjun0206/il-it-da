import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createStoreMap } from "../../scripts/rag-eval/store-map.mjs";
import { callRagQuery, runEvaluation } from "../../scripts/rag-eval/run-evaluation.mjs";

const ISU_ID = "57181130-4449-4299-a864-25a2098147e4";
const SOONGSIL_ID = "f9bc865b-5722-40b3-8548-1c181f5ad7fb";
const ENDPOINT = "http://localhost:3000/api/rag/query";

const STORE_MAP = createStoreMap([
  { name: "이수점", id: ISU_ID },
  { name: "숭실대점", id: SOONGSIL_ID },
]);

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function createRecordingFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(calls.length - 1, url, init);
  };
  return { fetchImpl, calls };
}

const NORMAL_CASE = {
  question_id: "q-001",
  question_type: "normal",
  target_store: "이수점",
  question: "영업시간이 어떻게 되나요?",
  expected_status: "answered",
  expected_keywords: ["9시"],
  forbidden_content: ["모르겠습니다"],
};

describe("callRagQuery", () => {
  test("sends a POST request with a {question, storeId} JSON body", async () => {
    const { fetchImpl, calls } = createRecordingFetch(() =>
      jsonResponse(200, { status: "answered", answer: "9시부터 운영합니다." }),
    );

    await callRagQuery({ endpoint: ENDPOINT, question: "질문", storeId: ISU_ID, fetchImpl });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, ENDPOINT);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(calls[0].init.body), { question: "질문", storeId: ISU_ID });
  });

  test("distinguishes an HTTP error from a successful response", async () => {
    const { fetchImpl } = createRecordingFetch(() => jsonResponse(500, {}));

    const result = await callRagQuery({ endpoint: ENDPOINT, question: "q", storeId: ISU_ID, fetchImpl });

    assert.equal(result.ok, false);
    assert.equal(result.code, "HTTP_ERROR");
  });

  test("distinguishes an invalid JSON response from an HTTP error", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    });

    const result = await callRagQuery({ endpoint: ENDPOINT, question: "q", storeId: ISU_ID, fetchImpl });

    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_JSON_RESPONSE");
  });

  test("flags a response missing the required status/answer fields", async () => {
    const { fetchImpl } = createRecordingFetch(() => jsonResponse(200, { source: null }));

    const result = await callRagQuery({ endpoint: ENDPOINT, question: "q", storeId: ISU_ID, fetchImpl });

    assert.equal(result.ok, false);
    assert.equal(result.code, "MISSING_RESPONSE_FIELDS");
  });
});

describe("runEvaluation", () => {
  test("grades a normal answered response as passing", async () => {
    const { fetchImpl } = createRecordingFetch(() =>
      jsonResponse(200, { status: "answered", answer: "영업시간은 9시부터입니다." }),
    );

    const { results, summary } = await runEvaluation({
      questionSet: [NORMAL_CASE],
      storeMap: STORE_MAP,
      endpoint: ENDPOINT,
      fetchImpl,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].pass, true);
    assert.equal(summary.total, 1);
    assert.equal(summary.passed, 1);
  });

  test("fails a case when status does not match", async () => {
    const { fetchImpl } = createRecordingFetch(() =>
      jsonResponse(200, { status: "cautious", answer: "영업시간은 9시부터입니다." }),
    );

    const { results } = await runEvaluation({
      questionSet: [NORMAL_CASE],
      storeMap: STORE_MAP,
      endpoint: ENDPOINT,
      fetchImpl,
    });

    assert.equal(results[0].statusMatched, false);
    assert.equal(results[0].pass, false);
  });

  test("fails a case when a required keyword is missing", async () => {
    const { fetchImpl } = createRecordingFetch(() =>
      jsonResponse(200, { status: "answered", answer: "영업시간을 확인해 주세요." }),
    );

    const { results } = await runEvaluation({
      questionSet: [NORMAL_CASE],
      storeMap: STORE_MAP,
      endpoint: ENDPOINT,
      fetchImpl,
    });

    assert.equal(results[0].keywordPassed, false);
    assert.equal(results[0].pass, false);
  });

  test("fails a case when forbidden content appears in the answer", async () => {
    const { fetchImpl } = createRecordingFetch(() =>
      jsonResponse(200, { status: "answered", answer: "9시부터인지 정확히는 모르겠습니다." }),
    );

    const { results } = await runEvaluation({
      questionSet: [NORMAL_CASE],
      storeMap: STORE_MAP,
      endpoint: ENDPOINT,
      fetchImpl,
    });

    assert.equal(results[0].forbiddenPassed, false);
    assert.equal(results[0].pass, false);
  });

  test("records an HTTP error case with error:true", async () => {
    const { fetchImpl } = createRecordingFetch(() => jsonResponse(500, {}));

    const { results, summary } = await runEvaluation({
      questionSet: [NORMAL_CASE],
      storeMap: STORE_MAP,
      endpoint: ENDPOINT,
      fetchImpl,
    });

    assert.equal(results[0].error, true);
    assert.equal(results[0].code, "HTTP_ERROR");
    assert.equal(summary.errorCount, 1);
  });

  test("continues with the next case after one case errors", async () => {
    let callIndex = 0;
    const fetchImpl = async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return jsonResponse(500, {});
      }
      return jsonResponse(200, { status: "answered", answer: "9시부터입니다." });
    };

    const secondCase = { ...NORMAL_CASE, question_id: "q-002" };

    const { results } = await runEvaluation({
      questionSet: [NORMAL_CASE, secondCase],
      storeMap: STORE_MAP,
      endpoint: ENDPOINT,
      fetchImpl,
    });

    assert.equal(results.length, 2);
    assert.equal(results[0].error, true);
    assert.equal(results[1].error, undefined);
    assert.equal(results[1].pass, true);
  });

  test("expands target_store='all' into one case per registered store", async () => {
    const { fetchImpl, calls } = createRecordingFetch(() =>
      jsonResponse(200, { status: "answered", answer: "9시부터입니다." }),
    );

    const allStoresCase = { ...NORMAL_CASE, target_store: "all" };

    const { results } = await runEvaluation({
      questionSet: [allStoresCase],
      storeMap: STORE_MAP,
      endpoint: ENDPOINT,
      fetchImpl,
    });

    assert.equal(results.length, 2);
    assert.equal(calls.length, 2);
  });

  test("does not store question text, full answer text, or storeId in results", async () => {
    const { fetchImpl } = createRecordingFetch(() =>
      jsonResponse(200, { status: "answered", answer: "영업시간은 9시부터입니다." }),
    );

    const { results } = await runEvaluation({
      questionSet: [NORMAL_CASE],
      storeMap: STORE_MAP,
      endpoint: ENDPOINT,
      fetchImpl,
    });

    const serialized = JSON.stringify(results);
    assert.equal(serialized.includes(NORMAL_CASE.question), false);
    assert.equal(serialized.includes("영업시간은 9시부터입니다."), false);
    assert.equal(serialized.includes(ISU_ID), false);
  });

  test("only calls the injected fetchImpl, never a real network fetch", async () => {
    const { fetchImpl, calls } = createRecordingFetch(() =>
      jsonResponse(200, { status: "answered", answer: "9시부터입니다." }),
    );

    await runEvaluation({
      questionSet: [NORMAL_CASE],
      storeMap: STORE_MAP,
      endpoint: ENDPOINT,
      fetchImpl,
    });

    assert.equal(calls.length, 1);
  });
});
