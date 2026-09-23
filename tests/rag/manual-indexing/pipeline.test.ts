import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { runManualIndexingPipeline } from "../../../lib/rag/manual-indexing/pipeline.ts";
import type {
  ManualIndexingDeps,
  PersistManualArgs,
  PersistedManual,
} from "../../../lib/rag/manual-indexing/pipeline.ts";
import { validateManualBatch } from "../../../lib/rag/manual-indexing/validate.ts";
import type { NormalizedManualInput } from "../../../lib/rag/manual-indexing/types.ts";

function baseInput(overrides: Partial<NormalizedManualInput> = {}): NormalizedManualInput {
  return {
    externalId: "ext-1",
    title: "오픈 체크리스트",
    category: "오픈/마감",
    content: "매장 오픈 전 점검 항목을 확인합니다.",
    scopeType: "hq",
    status: "approved",
    ...overrides,
  };
}

type FakeDepsOptions = {
  persistManualImpl?: (args: PersistManualArgs) => Promise<PersistedManual>;
  chunkTextImpl?: (text: string) => string[];
  createEmbeddingsImpl?: (inputs: string[]) => Promise<number[][]>;
  persistChunksImpl?: (manualId: string, chunks: unknown[]) => Promise<{ chunkCount: number }>;
};

function makeFakeDeps(options: FakeDepsOptions = {}) {
  const calls = {
    persistManual: [] as PersistManualArgs[],
    chunkText: [] as string[],
    createEmbeddings: [] as string[][],
    persistChunks: [] as Array<{ manualId: string; chunks: unknown[] }>,
    logError: [] as Array<{ code: string; error: unknown }>,
  };

  let manualCounter = 0;
  const persistManual = options.persistManualImpl ?? (async (args: PersistManualArgs) => {
    manualCounter += 1;
    return { id: `manual-${manualCounter}` };
  });

  const deps: ManualIndexingDeps = {
    validate: validateManualBatch,
    persistManual: async (args) => {
      calls.persistManual.push(args);
      return persistManual(args);
    },
    chunkText: (text) => {
      calls.chunkText.push(text);
      return (options.chunkTextImpl ?? ((t: string) => [t]))(text);
    },
    createEmbeddings: async (inputs) => {
      calls.createEmbeddings.push(inputs);
      return (options.createEmbeddingsImpl ?? (async (i: string[]) => i.map(() => [0, 0, 0])))(inputs);
    },
    persistChunks: async (manualId, chunks) => {
      calls.persistChunks.push({ manualId, chunks });
      return (options.persistChunksImpl ?? (async (_id: string, c: unknown[]) => ({ chunkCount: c.length })))(
        manualId,
        chunks,
      );
    },
    logError: (code, error) => {
      calls.logError.push({ code, error });
    },
  };

  return { deps, calls };
}

describe("runManualIndexingPipeline", () => {
  test("indexes a normal HQ manual end-to-end", async () => {
    const { deps, calls } = makeFakeDeps();
    const result = await runManualIndexingPipeline([baseInput()], deps);

    assert.equal(result.success, true);
    assert.equal(result.manualCount, 1);
    assert.equal(result.indexedCount, 1);
    assert.equal(result.chunkCount, 1);
    assert.equal(calls.persistManual[0].scopeType, "hq");
    assert.equal(calls.persistManual[0].storeId, null);
  });

  test("indexes a normal store manual end-to-end, passing storeId through", async () => {
    const { deps, calls } = makeFakeDeps();
    const result = await runManualIndexingPipeline(
      [baseInput({ scopeType: "store", storeId: "store-42" })],
      deps,
    );

    assert.equal(result.success, true);
    assert.equal(calls.persistManual[0].storeId, "store-42");
  });

  test("rejects a store manual with no storeId before persisting anything", async () => {
    const { deps, calls } = makeFakeDeps();
    const result = await runManualIndexingPipeline(
      [baseInput({ scopeType: "store", storeId: undefined })],
      deps,
    );

    assert.equal(result.failedCount, 1);
    assert.equal(result.items[0].stage, "validate");
    assert.equal(result.items[0].code, "STORE_ID_REQUIRED_FOR_STORE_SCOPE");
    assert.equal(calls.persistManual.length, 0);
  });

  test("preserves the category value exactly as received", async () => {
    const { deps, calls } = makeFakeDeps();
    await runManualIndexingPipeline([baseInput({ category: "본사 공지 > 긴급" })], deps);
    assert.equal(calls.persistManual[0].category, "본사 공지 > 긴급");
  });

  test("preserves parent/child relationships: parent persisted before child, real parent id passed through", async () => {
    const { deps, calls } = makeFakeDeps();
    const result = await runManualIndexingPipeline(
      [
        baseInput({ externalId: "topic-1", content: "그룹 설명" }),
        baseInput({ externalId: "detail-1", parentExternalId: "topic-1", content: "세부 내용" }),
      ],
      deps,
    );

    assert.equal(calls.persistManual.length, 2);
    assert.equal(calls.persistManual[0].parentManualId, null);
    assert.equal(calls.persistManual[1].parentManualId, "manual-1");

    const parentResult = result.items.find((item) => item.externalId === "topic-1");
    const childResult = result.items.find((item) => item.externalId === "detail-1");
    // The parent acts only as a topic container (mirrors save-manual-sections.ts) and is not chunked.
    assert.equal(parentResult?.status, "skipped");
    assert.equal(parentResult?.chunkCount, 0);
    assert.equal(childResult?.status, "indexed");
  });

  test("persists a draft manual but skips chunking/embedding for it (existing approved/draft policy)", async () => {
    const { deps, calls } = makeFakeDeps();
    const result = await runManualIndexingPipeline([baseInput({ status: "draft" })], deps);

    assert.equal(result.items[0].status, "skipped");
    assert.equal(result.items[0].manualId, "manual-1");
    assert.equal(calls.chunkText.length, 0);
    assert.equal(calls.createEmbeddings.length, 0);
    assert.equal(calls.persistChunks.length, 0);
  });

  test("preserves chunk order end to end: embeddings and persisted rows line up with chunkText's output order", async () => {
    const { deps, calls } = makeFakeDeps({
      chunkTextImpl: () => ["첫 번째", "두 번째", "세 번째"],
      createEmbeddingsImpl: async (inputs) => inputs.map((_, index) => [index]),
    });

    await runManualIndexingPipeline([baseInput()], deps);

    assert.deepEqual(
      calls.createEmbeddings[0].map((input) => input.includes("첫 번째") || input.includes("두 번째") || input.includes("세 번째")),
      [true, true, true],
    );
    assert.ok(calls.createEmbeddings[0][0].includes("첫 번째"));
    assert.ok(calls.createEmbeddings[0][1].includes("두 번째"));
    assert.ok(calls.createEmbeddings[0][2].includes("세 번째"));

    const persistedChunks = calls.persistChunks[0].chunks as Array<{ content: string; embedding: number[] }>;
    assert.deepEqual(persistedChunks.map((c) => c.content), ["첫 번째", "두 번째", "세 번째"]);
    assert.deepEqual(persistedChunks.map((c) => c.embedding), [[0], [1], [2]]);
  });

  test("fails closed with EMBEDDING_COUNT_MISMATCH when embedding count does not match chunk count", async () => {
    const { deps, calls } = makeFakeDeps({
      chunkTextImpl: () => ["a", "b"],
      createEmbeddingsImpl: async () => [[0, 0, 0]],
    });

    const result = await runManualIndexingPipeline([baseInput()], deps);

    assert.equal(result.items[0].status, "failed");
    assert.equal(result.items[0].stage, "embedding");
    assert.equal(result.items[0].code, "EMBEDDING_COUNT_MISMATCH");
    assert.equal(calls.persistChunks.length, 0);
  });

  test("manual persist failure stops the item before chunking/embedding/persisting chunks", async () => {
    const { deps, calls } = makeFakeDeps({
      persistManualImpl: async () => {
        throw new Error("connection reset by peer");
      },
    });

    const result = await runManualIndexingPipeline([baseInput()], deps);

    assert.equal(result.items[0].status, "failed");
    assert.equal(result.items[0].stage, "persist_manual");
    assert.equal(result.items[0].code, "MANUAL_PERSIST_FAILED");
    assert.equal(calls.chunkText.length, 0);
    assert.equal(calls.createEmbeddings.length, 0);
    assert.equal(calls.persistChunks.length, 0);
  });

  test("chunk generation failure stops the item before embedding/persisting chunks", async () => {
    const { deps, calls } = makeFakeDeps({
      chunkTextImpl: () => {
        throw new Error("Manual text exceeds maximum allowed length");
      },
    });

    const result = await runManualIndexingPipeline([baseInput()], deps);

    assert.equal(result.items[0].status, "failed");
    assert.equal(result.items[0].stage, "chunk");
    assert.equal(result.items[0].code, "CHUNKING_FAILED");
    assert.equal(calls.createEmbeddings.length, 0);
    assert.equal(calls.persistChunks.length, 0);
  });

  test("embedding failure stops the item before persisting chunks", async () => {
    const { deps, calls } = makeFakeDeps({
      createEmbeddingsImpl: async () => {
        throw new Error("OpenAI request timed out");
      },
    });

    const result = await runManualIndexingPipeline([baseInput()], deps);

    assert.equal(result.items[0].status, "failed");
    assert.equal(result.items[0].stage, "embedding");
    assert.equal(result.items[0].code, "EMBEDDING_FAILED");
    assert.equal(calls.persistChunks.length, 0);
  });

  test("chunk persist failure is reported without a partial success", async () => {
    const { deps } = makeFakeDeps({
      persistChunksImpl: async () => {
        throw new Error("CHUNK_PERSIST_FAILED");
      },
    });

    const result = await runManualIndexingPipeline([baseInput()], deps);

    assert.equal(result.items[0].status, "failed");
    assert.equal(result.items[0].stage, "persist_chunks");
    assert.equal(result.items[0].code, "CHUNK_PERSIST_FAILED");
  });

  test("re-running with an existingManualId updates the same manual instead of inserting a new one", async () => {
    const updatedIds: Array<string | null> = [];
    const { deps } = makeFakeDeps({
      persistManualImpl: async (args) => {
        updatedIds.push(args.existingManualId);
        return { id: args.existingManualId ?? "new-manual" };
      },
    });

    const input = baseInput({ existingManualId: "11111111-1111-1111-8111-111111111111" });
    const first = await runManualIndexingPipeline([input], deps);
    const second = await runManualIndexingPipeline([input], deps);

    assert.equal(first.items[0].manualId, "11111111-1111-1111-8111-111111111111");
    assert.equal(second.items[0].manualId, "11111111-1111-1111-8111-111111111111");
    assert.deepEqual(updatedIds, [
      "11111111-1111-1111-8111-111111111111",
      "11111111-1111-1111-8111-111111111111",
    ]);
  });

  test("does not leak raw errors, manual content, or UUIDs through the default safe logger", async () => {
    const secretContent = "민감한 매장 운영 정보와 UUID 11111111-1111-1111-8111-111111111111";
    const originalConsoleError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    try {
      const { deps } = makeFakeDeps({
        persistManualImpl: async () => {
          throw new Error(secretContent);
        },
      });
      delete (deps as { logError?: unknown }).logError;

      await runManualIndexingPipeline([baseInput({ content: secretContent })], deps);
    } finally {
      console.error = originalConsoleError;
    }

    const serialized = JSON.stringify(logged);
    assert.equal(serialized.includes(secretContent), false);
    assert.equal(serialized.includes("11111111-1111-1111-8111-111111111111"), false);
    assert.ok(serialized.includes("MANUAL_PERSIST_FAILED"));
  });

  test("aggregates a mixed batch's success counts accurately", async () => {
    const { deps } = makeFakeDeps({
      createEmbeddingsImpl: async (inputs) => {
        if (inputs[0].includes("실패용")) {
          throw new Error("boom");
        }
        return inputs.map(() => [0]);
      },
    });

    const result = await runManualIndexingPipeline(
      [
        baseInput({ externalId: "ok-1" }),
        baseInput({ externalId: "draft-1", status: "draft" }),
        baseInput({ externalId: "fail-1", content: "실패용 콘텐츠" }),
        baseInput({ externalId: "", title: "" }),
      ],
      deps,
    );

    assert.equal(result.manualCount, 3);
    assert.equal(result.indexedCount, 1);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.failedCount, 2);
    assert.equal(result.chunkCount, 1);
    assert.ok(result.errorCodes.includes("EMBEDDING_FAILED"));
    assert.ok(result.errorCodes.includes("EXTERNAL_ID_REQUIRED"));
    assert.equal(result.success, false);
  });
});
