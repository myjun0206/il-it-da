import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  saveQuestionLog,
  type QuestionLogPayload,
  type QuestionLogWriter,
  type SaveQuestionLogInput,
} from "../../lib/rag/save-question-log.ts";

const VALID_MANUAL_ID = "57181130-4449-4299-a864-25a2098147e4";
const BASE_INPUT: SaveQuestionLogInput = {
  question: "환불 절차를 알려주세요.",
  answer: "결제 내역을 확인한 뒤 처리합니다.",
  similarityScore: 0.82,
  status: "answered",
  sourceManualId: VALID_MANUAL_ID,
};

function createWriter(result: { error: unknown | null } = { error: null }) {
  const payloads: QuestionLogPayload[] = [];
  const writer: QuestionLogWriter = async (payload) => {
    payloads.push(payload);
    return result;
  };

  return { payloads, writer };
}

function asInput(value: unknown): SaveQuestionLogInput {
  return value as SaveQuestionLogInput;
}

describe("saveQuestionLog", () => {
  test("converts an answered input to the exact snake_case payload", async () => {
    const { payloads, writer } = createWriter();

    await saveQuestionLog(BASE_INPUT, writer);

    assert.deepEqual(payloads, [{
      question: BASE_INPUT.question,
      answer: BASE_INPUT.answer,
      similarity_score: BASE_INPUT.similarityScore,
      status: BASE_INPUT.status,
      source_manual_id: BASE_INPUT.sourceManualId,
    }]);
  });

  test("saves a cautious status", async () => {
    const { payloads, writer } = createWriter();

    const result = await saveQuestionLog({ ...BASE_INPUT, status: "cautious" }, writer);

    assert.deepEqual(result, { saved: true });
    assert.equal(payloads[0].status, "cautious");
  });

  test("saves null similarity and source for an insufficient result", async () => {
    const { payloads, writer } = createWriter();

    const result = await saveQuestionLog({
      ...BASE_INPUT,
      similarityScore: null,
      status: "insufficient",
      sourceManualId: null,
    }, writer);

    assert.deepEqual(result, { saved: true });
    assert.equal(payloads[0].similarity_score, null);
    assert.equal(payloads[0].source_manual_id, null);
  });

  test("preserves similarity boundary values 1 and -1", async () => {
    const { payloads, writer } = createWriter();

    await saveQuestionLog({ ...BASE_INPUT, similarityScore: 1 }, writer);
    await saveQuestionLog({ ...BASE_INPUT, similarityScore: -1 }, writer);

    assert.deepEqual(payloads.map((payload) => payload.similarity_score), [1, -1]);
  });

  test("normalizes NaN similarity to null", async () => {
    const { payloads, writer } = createWriter();

    await saveQuestionLog({ ...BASE_INPUT, similarityScore: Number.NaN }, writer);

    assert.equal(payloads[0].similarity_score, null);
  });

  test("normalizes positive and negative Infinity similarity to null", async () => {
    const { payloads, writer } = createWriter();

    await saveQuestionLog({ ...BASE_INPUT, similarityScore: Number.POSITIVE_INFINITY }, writer);
    await saveQuestionLog({ ...BASE_INPUT, similarityScore: Number.NEGATIVE_INFINITY }, writer);

    assert.deepEqual(payloads.map((payload) => payload.similarity_score), [null, null]);
  });

  test("normalizes similarity outside the database range to null", async () => {
    const { payloads, writer } = createWriter();

    await saveQuestionLog({ ...BASE_INPUT, similarityScore: 1.01 }, writer);
    await saveQuestionLog({ ...BASE_INPUT, similarityScore: -1.01 }, writer);

    assert.deepEqual(payloads.map((payload) => payload.similarity_score), [null, null]);
  });

  test("trims and saves a valid source manual UUID", async () => {
    const { payloads, writer } = createWriter();

    await saveQuestionLog({ ...BASE_INPUT, sourceManualId: `  ${VALID_MANUAL_ID}  ` }, writer);

    assert.equal(payloads[0].source_manual_id, VALID_MANUAL_ID);
  });

  test("normalizes an empty source manual UUID to null", async () => {
    const { payloads, writer } = createWriter();

    await saveQuestionLog({ ...BASE_INPUT, sourceManualId: "   " }, writer);

    assert.equal(payloads[0].source_manual_id, null);
  });

  test("normalizes an invalid source manual UUID to null", async () => {
    const { payloads, writer } = createWriter();

    await saveQuestionLog({ ...BASE_INPUT, sourceManualId: "manual-1" }, writer);

    assert.equal(payloads[0].source_manual_id, null);
  });

  test("rejects an empty question without calling the writer", async () => {
    const { payloads, writer } = createWriter();

    const result = await saveQuestionLog({ ...BASE_INPUT, question: "   " }, writer);

    assert.deepEqual(result, { saved: false, code: "INVALID_INPUT" });
    assert.equal(payloads.length, 0);
  });

  test("rejects an empty answer without calling the writer", async () => {
    const { payloads, writer } = createWriter();

    const result = await saveQuestionLog({ ...BASE_INPUT, answer: "   " }, writer);

    assert.deepEqual(result, { saved: false, code: "INVALID_INPUT" });
    assert.equal(payloads.length, 0);
  });

  test("rejects an invalid status without calling the writer", async () => {
    const { payloads, writer } = createWriter();

    const result = await saveQuestionLog(asInput({ ...BASE_INPUT, status: "unknown" }), writer);

    assert.deepEqual(result, { saved: false, code: "INVALID_INPUT" });
    assert.equal(payloads.length, 0);
  });

  test("returns saved true when the writer succeeds", async () => {
    const { writer } = createWriter();

    assert.deepEqual(await saveQuestionLog(BASE_INPUT, writer), { saved: true });
  });

  test("returns a safe failure when the writer returns an error", async () => {
    const { writer } = createWriter({ error: { private: "database details" } });

    assert.deepEqual(await saveQuestionLog(BASE_INPUT, writer), {
      saved: false,
      code: "QUESTION_LOG_SAVE_FAILED",
    });
  });

  test("does not propagate an exception thrown by the writer", async () => {
    const writer: QuestionLogWriter = async () => {
      throw new Error("database failure");
    };

    await assert.doesNotReject(() => saveQuestionLog(BASE_INPUT, writer));
    assert.deepEqual(await saveQuestionLog(BASE_INPUT, writer), {
      saved: false,
      code: "QUESTION_LOG_SAVE_FAILED",
    });
  });

  test("does not print input, payload, or database errors to the console", async () => {
    const originalConsole = {
      error: console.error,
      info: console.info,
      log: console.log,
      warn: console.warn,
    };
    const consoleCalls: unknown[][] = [];
    const capture = (...args: unknown[]) => consoleCalls.push(args);
    console.error = capture;
    console.info = capture;
    console.log = capture;
    console.warn = capture;

    try {
      const { writer } = createWriter({
        error: { question: BASE_INPUT.question, answer: BASE_INPUT.answer },
      });
      await saveQuestionLog(BASE_INPUT, writer);
    } finally {
      console.error = originalConsole.error;
      console.info = originalConsole.info;
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
    }

    assert.deepEqual(consoleCalls, []);
  });

  test("does not mutate the input object", async () => {
    const input = {
      ...BASE_INPUT,
      question: `  ${BASE_INPUT.question}  `,
      sourceManualId: `  ${VALID_MANUAL_ID}  `,
    };
    const snapshot = structuredClone(input);
    const { writer } = createWriter();

    await saveQuestionLog(input, writer);

    assert.deepEqual(input, snapshot);
  });

  test("calls the writer exactly once for one save request", async () => {
    let callCount = 0;
    const writer: QuestionLogWriter = async () => {
      callCount += 1;
      return { error: null };
    };

    await saveQuestionLog(BASE_INPUT, writer);

    assert.equal(callCount, 1);
  });

  test("uses an injected writer without network or environment access", async () => {
    const originalFetch = globalThis.fetch;
    let networkCallCount = 0;
    globalThis.fetch = async () => {
      networkCallCount += 1;
      throw new Error("Network access is not allowed in this test.");
    };
    const { writer } = createWriter();

    try {
      assert.deepEqual(await saveQuestionLog(BASE_INPUT, writer), { saved: true });
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(networkCallCount, 0);
  });

  test("does not call the writer in a browser runtime", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    let writerCallCount = 0;
    const writer: QuestionLogWriter = async () => {
      writerCallCount += 1;
      return { error: null };
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });

    try {
      assert.deepEqual(await saveQuestionLog(BASE_INPUT, writer), {
        saved: false,
        code: "QUESTION_LOG_SAVE_FAILED",
      });
    } finally {
      if (originalWindow) {
        Object.defineProperty(globalThis, "window", originalWindow);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }

    assert.equal(writerCallCount, 0);
  });
});