import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  finalizeRagQueryResponse,
  type RagQueryFinalizationSaver,
} from "../../lib/rag/finalize-rag-query-response.ts";
import type { SaveQuestionLogInput } from "../../lib/rag/save-question-log.ts";
import type { RagQueryResponse } from "../../lib/rag/types.ts";

const QUESTION = "test-question";
const MANUAL_ID = "57181130-4449-4299-a864-25a2098147e4";

function response(overrides: Partial<Extract<RagQueryResponse, { answer: string }>> = {}) {
  return {
    answer: "final-answer",
    similarity: 0.8,
    source: { manualId: MANUAL_ID, title: "Title", category: "Category" },
    status: "answered" as const,
    matches: [],
    ...overrides,
  };
}

function captureSaver(result: { saved: boolean; code?: "INVALID_INPUT" | "QUESTION_LOG_SAVE_FAILED" } = { saved: true }) {
  const inputs: SaveQuestionLogInput[] = [];
  const saver: RagQueryFinalizationSaver = async (input) => {
    inputs.push(input);
    return result.saved ? { saved: true } : { saved: false, code: result.code ?? "QUESTION_LOG_SAVE_FAILED" };
  };
  return { inputs, saver };
}

describe("finalizeRagQueryResponse", () => {
  test("saves a no-match 200 response exactly once with null similarity and source", async () => {
    const finalResponse = response({
      answer: "fallback-answer",
      similarity: null,
      source: null,
      status: "insufficient",
      matches: [],
    });
    const { inputs, saver } = captureSaver();

    const returned = await finalizeRagQueryResponse({ httpStatus: 200, question: QUESTION, response: finalResponse }, saver);

    assert.strictEqual(returned, finalResponse);
    assert.deepEqual(inputs, [{
      question: QUESTION,
      answer: "fallback-answer",
      similarityScore: null,
      status: "insufficient",
      sourceManualId: null,
    }]);
  });

  test("saves low-similarity insufficient with its actual similarity and null source", async () => {
    const finalResponse = response({
      answer: "fallback-answer",
      similarity: 0.25,
      source: null,
      status: "insufficient",
    });
    const { inputs, saver } = captureSaver();

    await finalizeRagQueryResponse({ httpStatus: 200, question: QUESTION, response: finalResponse }, saver);

    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].similarityScore, 0.25);
    assert.equal(inputs[0].sourceManualId, null);
    assert.equal(inputs[0].status, "insufficient");
  });

  test("saves cautious with the final answer, status, similarity, and source", async () => {
    const finalResponse = response({ answer: "cautious-final-answer", similarity: 0.5, status: "cautious" });
    const { inputs, saver } = captureSaver();

    await finalizeRagQueryResponse({ httpStatus: 200, question: QUESTION, response: finalResponse }, saver);

    assert.deepEqual(inputs[0], {
      question: QUESTION,
      answer: "cautious-final-answer",
      similarityScore: 0.5,
      status: "cautious",
      sourceManualId: MANUAL_ID,
    });
  });

  test("saves answered with the final answer, status, similarity, and source", async () => {
    const finalResponse = response({ answer: "answered-final-answer", similarity: 0.8, status: "answered" });
    const { inputs, saver } = captureSaver();

    await finalizeRagQueryResponse({ httpStatus: 200, question: QUESTION, response: finalResponse }, saver);

    assert.deepEqual(inputs[0], {
      question: QUESTION,
      answer: "answered-final-answer",
      similarityScore: 0.8,
      status: "answered",
      sourceManualId: MANUAL_ID,
    });
  });

  test("keeps the original response when the saver returns saved false", async () => {
    const finalResponse = response();
    const { saver } = captureSaver({ saved: false });

    const returned = await finalizeRagQueryResponse({ httpStatus: 200, question: QUESTION, response: finalResponse }, saver);

    assert.strictEqual(returned, finalResponse);
  });

  test("keeps the original response when the saver throws", async () => {
    const finalResponse = response();
    const saver: RagQueryFinalizationSaver = async () => {
      throw new Error("database error detail");
    };

    await assert.doesNotReject(() => finalizeRagQueryResponse({
      httpStatus: 200,
      question: QUESTION,
      response: finalResponse,
    }, saver));
  });

  test("awaits the saver before returning", async () => {
    const finalResponse = response();
    let release: (() => void) | undefined;
    let finished = false;
    const saver: RagQueryFinalizationSaver = async () => new Promise((resolve) => {
      release = () => {
        finished = true;
        resolve({ saved: true });
      };
    });

    const finalization = finalizeRagQueryResponse({ httpStatus: 200, question: QUESTION, response: finalResponse }, saver);
    await Promise.resolve();
    assert.equal(finished, false);
    assert.ok(release);
    release();
    await finalization;
    assert.equal(finished, true);
  });

  test("does not call saver for 400, 401, 403, or 500 responses", async () => {
    let calls = 0;
    const saver: RagQueryFinalizationSaver = async () => {
      calls += 1;
      return { saved: true };
    };

    for (const httpStatus of [400, 401, 403, 500]) {
      await finalizeRagQueryResponse({
        httpStatus,
        question: QUESTION,
        response: { error: "fixed-error" },
      }, saver);
    }

    assert.equal(calls, 0);
  });

  test("does not mutate the final response object", async () => {
    const finalResponse = response();
    const snapshot = structuredClone(finalResponse);
    const { saver } = captureSaver();

    await finalizeRagQueryResponse({ httpStatus: 200, question: QUESTION, response: finalResponse }, saver);

    assert.deepEqual(finalResponse, snapshot);
  });

  test("does not log question, answer, source, or saver errors", async () => {
    const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    const calls: unknown[][] = [];
    const capture = (...args: unknown[]) => calls.push(args);
    console.log = capture;
    console.info = capture;
    console.warn = capture;
    console.error = capture;

    try {
      const saver: RagQueryFinalizationSaver = async () => {
        throw new Error("private database error");
      };
      await finalizeRagQueryResponse({ httpStatus: 200, question: QUESTION, response: response() }, saver);
    } finally {
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
    }

    assert.deepEqual(calls, []);
  });
});
