import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  claimManualUploadBatch,
  completeManualUploadBatch,
  failManualUploadBatch,
  IDEMPOTENCY_KEY_PATTERN,
  type BatchScope,
  type ManualUploadBatchRow,
} from "../../lib/manuals/manual-upload-batch.ts";

const HQ_HASH_INDEX = "manual_upload_batches_hq_active_hash_idx";
const STORE_HASH_INDEX = "manual_upload_batches_store_active_hash_idx";
const KEY_INDEX = "manual_upload_batches_idempotency_key_idx";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";

function hqScope(overrides: Partial<BatchScope> = {}): BatchScope {
  return { scopeType: "hq", franchiseId: "franchise-1", storeId: null, requestedBy: "hq-user", ...overrides };
}

function storeScope(overrides: Partial<BatchScope> = {}): BatchScope {
  return { scopeType: "store", franchiseId: "franchise-1", storeId: "store-1", requestedBy: "owner-1", ...overrides };
}

/**
 * 020 마이그레이션의 제약(idempotency_key unique, HQ/store별 partial unique content_hash)을
 * 메모리에서 그대로 재현하는 fake 클라이언트. 실제 Supabase/OpenAI는 호출하지 않는다.
 */
function fakeBatchClient(seed: ManualUploadBatchRow[] = [], manualsByBatch: Record<string, number> = {}) {
  const rows: ManualUploadBatchRow[] = seed.map((row) => ({ ...row }));
  const manualCounts = { ...manualsByBatch };
  let sequence = 0;

  const isActive = (row: ManualUploadBatchRow) =>
    row.status === "processing" || row.status === "completed" || (row.status === "failed" && row.manual_count > 0);

  function uniqueViolation(index: string) {
    return { code: "23505", message: `duplicate key value violates unique constraint "${index}"`, details: "" };
  }

  function findHashConflict(candidate: ManualUploadBatchRow): string | null {
    for (const row of rows) {
      if (!isActive(row) || row.content_hash !== candidate.content_hash) continue;
      if (candidate.scope_type === "hq" && row.scope_type === "hq") {
        if ((row.franchise_id ?? NIL_UUID) === (candidate.franchise_id ?? NIL_UUID)) return HQ_HASH_INDEX;
      }
      if (candidate.scope_type === "store" && row.scope_type === "store") {
        if (row.store_id && row.store_id === candidate.store_id) return STORE_HASH_INDEX;
      }
    }
    return null;
  }

  const client = {
    from(table: string) {
      if (table === "manual_chunks") {
        throw new Error("Unexpected manual_chunks access");
      }

      if (table === "manuals") {
        return {
          select(_columns: string, options?: { count?: string; head?: boolean }) {
            let batchFilter: string | undefined;
            const query = {
              eq(_column: string, value: string) {
                batchFilter = value;
                return query;
              },
              then(resolve: (value: unknown) => unknown) {
                const count = options?.count ? (manualCounts[batchFilter ?? ""] ?? 0) : null;
                return Promise.resolve({ data: [], error: null, count }).then(resolve);
              },
            };
            return query;
          },
        };
      }

      if (table !== "manual_upload_batches") {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select(_columns: string) {
          let keyFilter: string | undefined;
          const query = {
            eq(_column: string, value: string) {
              keyFilter = value;
              return query;
            },
            maybeSingle() {
              const found = rows.find((row) => row.idempotency_key === keyFilter) ?? null;
              return Promise.resolve({ data: found ? { ...found } : null, error: null });
            },
          };
          return query;
        },
        insert(payload: Record<string, unknown>) {
          const candidate: ManualUploadBatchRow = {
            id: `batch-${++sequence}`,
            idempotency_key: payload.idempotency_key as string,
            content_hash: payload.content_hash as string,
            scope_type: payload.scope_type as string,
            franchise_id: (payload.franchise_id as string | null) ?? null,
            store_id: (payload.store_id as string | null) ?? null,
            requested_by: (payload.requested_by as string | null) ?? null,
            status: "processing",
            manual_count: 0,
          };

          const keyClash = rows.some((row) => row.idempotency_key === candidate.idempotency_key);
          const hashIndex = findHashConflict(candidate);
          const violated = keyClash ? KEY_INDEX : hashIndex;

          return {
            select: () => ({
              single: () => {
                if (violated) {
                  return Promise.resolve({ data: null, error: uniqueViolation(violated) });
                }
                rows.push(candidate);
                return Promise.resolve({ data: { id: candidate.id }, error: null });
              },
            }),
          };
        },
        update(patch: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const query = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return query;
            },
            select() {
              const matched = rows.filter(
                (row) =>
                  (!filters.id || row.id === filters.id) && (!filters.status || row.status === filters.status),
              );
              for (const row of matched) Object.assign(row, patch);
              return Promise.resolve({ data: matched.map((row) => ({ id: row.id })), error: null });
            },
            then(resolve: (value: unknown) => unknown) {
              for (const row of rows) {
                if (filters.id && row.id !== filters.id) continue;
                if (filters.status && row.status !== filters.status) continue;
                Object.assign(row, patch);
              }
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return query;
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, rows, manualCounts };
}

function batchRow(overrides: Partial<ManualUploadBatchRow> = {}): ManualUploadBatchRow {
  return {
    id: "batch-existing",
    idempotency_key: KEY_A,
    content_hash: "hash-aurora",
    scope_type: "hq",
    franchise_id: "franchise-1",
    store_id: null,
    requested_by: "hq-user",
    status: "completed",
    manual_count: 3,
    ...overrides,
  };
}

describe("claimManualUploadBatch: 같은 저장 요청 재전송 (실제 함수 실행)", () => {
  test("처음 요청은 batch를 만들고 저장을 시작한다", async () => {
    const { client, rows } = fakeBatchClient();
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_A,
      contentHash: "hash-aurora",
      scope: hqScope(),
    });

    assert.equal(result.kind, "claimed");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "processing");
  });

  test("완료된 동일 요청을 다시 보내도 새 batch를 만들지 않는다", async () => {
    const { client, rows } = fakeBatchClient([batchRow({ status: "completed" })]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_A,
      contentHash: "hash-aurora",
      scope: hqScope(),
    });

    assert.deepEqual(result, { kind: "already_completed", batchId: "batch-existing" });
    assert.equal(rows.length, 1);
  });

  test("아직 처리 중인 동일 요청은 저장을 다시 시작하지 않는다", async () => {
    const { client, rows } = fakeBatchClient([batchRow({ status: "processing", manual_count: 0 })]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_A,
      contentHash: "hash-aurora",
      scope: hqScope(),
    });

    assert.deepEqual(result, { kind: "processing" });
    assert.equal(rows.length, 1);
  });

  test("연속 클릭 2회는 한 번만 저장을 시작한다", async () => {
    const { client, rows } = fakeBatchClient();
    const input = { idempotencyKey: KEY_A, contentHash: "hash-aurora", scope: hqScope() };

    const first = await claimManualUploadBatch(client, input);
    const second = await claimManualUploadBatch(client, input);

    assert.equal(first.kind, "claimed");
    assert.equal(second.kind, "processing");
    assert.equal(rows.length, 1);
  });

  test("동시 요청 2개 중 하나만 저장을 시작한다", async () => {
    const { client, rows } = fakeBatchClient();
    const input = { idempotencyKey: KEY_A, contentHash: "hash-aurora", scope: hqScope() };

    const [a, b] = await Promise.all([
      claimManualUploadBatch(client, input),
      claimManualUploadBatch(client, input),
    ]);

    const claimed = [a, b].filter((result) => result.kind === "claimed");
    assert.equal(claimed.length, 1);
    assert.equal(rows.length, 1);
  });
});

describe("claimManualUploadBatch: 같은 내용 재업로드 (실제 함수 실행)", () => {
  test("같은 HQ franchise에 같은 내용을 새 key로 다시 올리면 차단된다", async () => {
    const { client, rows } = fakeBatchClient([batchRow({ status: "completed" })]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_B,
      contentHash: "hash-aurora",
      scope: hqScope(),
    });

    assert.deepEqual(result, { kind: "duplicate_content" });
    assert.equal(rows.length, 1);
  });

  test("같은 내용이어도 다른 franchise면 허용된다", async () => {
    const { client, rows } = fakeBatchClient([batchRow({ status: "completed" })]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_B,
      contentHash: "hash-aurora",
      scope: hqScope({ franchiseId: "franchise-2" }),
    });

    assert.equal(result.kind, "claimed");
    assert.equal(rows.length, 2);
  });

  test("같은 내용이어도 HQ와 store는 서로 다른 범위로 허용된다", async () => {
    const { client, rows } = fakeBatchClient([batchRow({ status: "completed" })]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_B,
      contentHash: "hash-aurora",
      scope: storeScope(),
    });

    assert.equal(result.kind, "claimed");
    assert.equal(rows.length, 2);
  });

  test("같은 내용이어도 다른 store면 허용된다", async () => {
    const seeded = batchRow({ scope_type: "store", store_id: "store-1", status: "completed" });
    const { client, rows } = fakeBatchClient([seeded]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_B,
      contentHash: "hash-aurora",
      scope: storeScope({ storeId: "store-2", requestedBy: "owner-2" }),
    });

    assert.equal(result.kind, "claimed");
    assert.equal(rows.length, 2);
  });

  test("같은 store에 같은 내용을 새 key로 다시 올리면 차단된다", async () => {
    const seeded = batchRow({ scope_type: "store", store_id: "store-1", status: "completed" });
    const { client } = fakeBatchClient([seeded]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_B,
      contentHash: "hash-aurora",
      scope: storeScope(),
    });

    assert.deepEqual(result, { kind: "duplicate_content" });
  });

  test("내용이 바뀐 개정판(다른 hash)은 같은 범위여도 허용된다", async () => {
    const { client, rows } = fakeBatchClient([batchRow({ status: "completed" })]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_B,
      contentHash: "hash-aurora-v2",
      scope: hqScope(),
    });

    assert.equal(result.kind, "claimed");
    assert.equal(rows.length, 2);
  });

  test("franchiseId가 없는 레거시 HQ 계정끼리도 같은 내용은 차단된다", async () => {
    const { client } = fakeBatchClient([batchRow({ franchise_id: null, status: "completed" })]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_B,
      contentHash: "hash-aurora",
      scope: hqScope({ franchiseId: null }),
    });

    assert.deepEqual(result, { kind: "duplicate_content" });
  });
});

describe("claimManualUploadBatch: 실패·부분 저장 정책 (실제 함수 실행)", () => {
  test("아무것도 저장되지 않고 실패한 요청은 같은 batch로 재시도된다", async () => {
    const { client, rows } = fakeBatchClient([batchRow({ status: "failed", manual_count: 0 })]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_A,
      contentHash: "hash-aurora",
      scope: hqScope(),
    });

    assert.deepEqual(result, { kind: "claimed", batchId: "batch-existing" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "processing");
  });

  test("일부만 저장되고 실패한 요청은 임의로 재삽입하지 않고 복구 안내로 막는다", async () => {
    const { client, rows } = fakeBatchClient([batchRow({ status: "failed", manual_count: 2 })]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_A,
      contentHash: "hash-aurora",
      scope: hqScope(),
    });

    assert.deepEqual(result, { kind: "needs_recovery" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "failed");
  });

  test("부분 저장이 남은 실패 batch가 있으면 새 key로 같은 내용을 다시 올려도 중복 행이 생기지 않는다", async () => {
    const { client, rows } = fakeBatchClient([batchRow({ status: "failed", manual_count: 2 })]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_B,
      contentHash: "hash-aurora",
      scope: hqScope(),
    });

    assert.deepEqual(result, { kind: "duplicate_content" });
    assert.equal(rows.length, 1);
  });

  test("저장된 행이 0건인 실패 batch는 hash를 놓아줘 새 key 재시도를 허용한다", async () => {
    const { client } = fakeBatchClient([batchRow({ status: "failed", manual_count: 0 })]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_B,
      contentHash: "hash-aurora",
      scope: hqScope(),
    });

    assert.equal(result.kind, "claimed");
  });

  test("failManualUploadBatch는 실제로 만들어진 행 수를 함께 기록한다", async () => {
    const { client, rows } = fakeBatchClient(
      [batchRow({ status: "processing", manual_count: 0, id: "batch-1" })],
      { "batch-1": 2 },
    );

    await failManualUploadBatch(client, "batch-1");

    assert.equal(rows[0].status, "failed");
    assert.equal(rows[0].manual_count, 2);
  });

  test("completeManualUploadBatch는 완료 상태와 저장 수를 기록한다", async () => {
    const { client, rows } = fakeBatchClient([batchRow({ status: "processing", manual_count: 0, id: "batch-1" })]);

    await completeManualUploadBatch(client, "batch-1", 3);

    assert.equal(rows[0].status, "completed");
    assert.equal(rows[0].manual_count, 3);
  });
});

describe("claimManualUploadBatch: 클라이언트 값 불신 (실제 함수 실행)", () => {
  test("다른 사용자의 key를 가져다 써도 재사용되지 않는다", async () => {
    const { client } = fakeBatchClient([batchRow({ requested_by: "other-user" })]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_A,
      contentHash: "hash-aurora",
      scope: hqScope(),
    });

    assert.deepEqual(result, { kind: "rejected" });
  });

  test("다른 범위의 key를 가져다 써도 재사용되지 않는다", async () => {
    const { client } = fakeBatchClient([batchRow({ franchise_id: "franchise-9" })]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_A,
      contentHash: "hash-aurora",
      scope: hqScope(),
    });

    assert.deepEqual(result, { kind: "rejected" });
  });

  test("같은 key로 다른 내용을 보내면 거부한다(기존 결과를 덮어쓰지 않는다)", async () => {
    const { client, rows } = fakeBatchClient([batchRow({ status: "completed" })]);
    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY_A,
      contentHash: "hash-something-else",
      scope: hqScope(),
    });

    assert.deepEqual(result, { kind: "rejected" });
    assert.equal(rows[0].content_hash, "hash-aurora");
    assert.equal(rows[0].manual_count, 3);
  });

  test("store 범위 batch는 scope_type과 store_id를 서버 값으로 기록한다", async () => {
    const { client, rows } = fakeBatchClient();
    await claimManualUploadBatch(client, {
      idempotencyKey: KEY_A,
      contentHash: "hash-aurora",
      scope: storeScope(),
    });

    assert.equal(rows[0].scope_type, "store");
    assert.equal(rows[0].store_id, "store-1");
  });

  test("hq 범위 batch는 store_id를 저장하지 않는다", async () => {
    const { client, rows } = fakeBatchClient();
    await claimManualUploadBatch(client, {
      idempotencyKey: KEY_A,
      contentHash: "hash-aurora",
      scope: hqScope({ storeId: "store-1" }),
    });

    assert.equal(rows[0].store_id, null);
  });

  test("idempotency key 형식 검사는 UUID만 통과시킨다", () => {
    assert.equal(IDEMPOTENCY_KEY_PATTERN.test(KEY_A), true);
    assert.equal(IDEMPOTENCY_KEY_PATTERN.test("not-a-uuid"), false);
    assert.equal(IDEMPOTENCY_KEY_PATTERN.test("' or 1=1 --"), false);
  });

  test("알 수 없는 unique 충돌을 '이미 등록된 내용'으로 오판하지 않는다", async () => {
    const client = {
      from() {
        return {
          select() {
            const query = {
              eq: () => query,
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            };
            return query;
          },
          insert() {
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: null,
                    // 우리가 아는 세 인덱스가 아닌 제약 위반.
                    error: { code: "23505", message: 'unique constraint "some_other_unrelated_idx"', details: "" },
                  }),
              }),
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    await assert.rejects(
      claimManualUploadBatch(client, { idempotencyKey: KEY_A, contentHash: "hash-aurora", scope: hqScope() }),
      /MANUAL_UPLOAD_BATCH_CLAIM_FAILED/,
    );
  });
});
