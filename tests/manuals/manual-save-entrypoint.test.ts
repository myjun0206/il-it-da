import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { saveManualGroupsWithBatchGuard } from "../../lib/manuals/save-manuals-with-batch.ts";
import type { ManualGroupInput } from "../../lib/rag/save-manual-sections.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

const HQ_AUTH = { userId: "hq-user", franchiseId: "franchise-1", brandName: "M Coffee" };
const STORE_AUTH = { userId: "owner-1", franchiseId: "franchise-1", brandName: "M Coffee" };
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const GROUPS: ManualGroupInput[] = [
  { category: "주문·결제·고객 응대", topic: "오로라 환불 처리 규칙", items: ["1. 영수증 확인", "2. 환불"] },
];

type BatchRow = {
  id: string;
  idempotency_key: string;
  content_hash: string;
  scope_type: string;
  franchise_id: string | null;
  store_id: string | null;
  requested_by: string | null;
  status: "processing" | "completed" | "failed";
  manual_count: number;
};

type ManualRow = Record<string, unknown> & { id: string; upload_batch_id: string | null };

/**
 * 020의 제약(idempotency_key unique, HQ/store별 partial unique content_hash)과 manuals insert를
 * 함께 흉내내어, 라우트가 쓰는 저장 진입점을 실제로 실행한다. 실제 Supabase/OpenAI는 쓰지 않는다.
 */
function fakeClient(options: { seedBatches?: BatchRow[]; failChildInsert?: boolean } = {}) {
  const batches: BatchRow[] = (options.seedBatches ?? []).map((row) => ({ ...row }));
  const manuals: ManualRow[] = [];
  let sequence = 0;

  const isActive = (row: BatchRow) =>
    row.status === "processing" || row.status === "completed" || (row.status === "failed" && row.manual_count > 0);

  function hashConflict(candidate: BatchRow): string | null {
    for (const row of batches) {
      if (!isActive(row) || row.content_hash !== candidate.content_hash) continue;
      if (candidate.scope_type === "hq" && row.scope_type === "hq") {
        if ((row.franchise_id ?? NIL_UUID) === (candidate.franchise_id ?? NIL_UUID)) {
          return "manual_upload_batches_hq_active_hash_idx";
        }
      }
      if (candidate.scope_type === "store" && row.scope_type === "store" && row.store_id === candidate.store_id) {
        return "manual_upload_batches_store_active_hash_idx";
      }
    }
    return null;
  }

  const client = {
    from(table: string) {
      if (table === "manual_chunks") {
        return { insert: () => Promise.resolve({ error: null }) };
      }

      if (table === "manuals") {
        return {
          select(_columns: string, opts?: { count?: string; head?: boolean }) {
            let batchFilter: string | undefined;
            const query = {
              eq(_column: string, value: string) {
                batchFilter = value;
                return query;
              },
              order() {
                return query;
              },
              then(resolve: (value: unknown) => unknown) {
                const rows = manuals.filter((row) => row.upload_batch_id === batchFilter);
                return Promise.resolve({
                  data: rows,
                  error: null,
                  count: opts?.count ? rows.length : null,
                }).then(resolve);
              },
            };
            return query;
          },
          insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
            const isParent = !Array.isArray(payload);
            if (!isParent && options.failChildInsert) {
              return {
                select: () => ({
                  then: (resolve: (value: unknown) => unknown) =>
                    Promise.resolve({ data: null, error: { message: "child insert failed" } }).then(resolve),
                }),
              };
            }
            const rows = (isParent ? [payload] : payload).map((row) => ({
              ...row,
              id: `manual-${++sequence}`,
              upload_batch_id: (row.upload_batch_id as string | null) ?? null,
            })) as ManualRow[];
            manuals.push(...rows);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: rows[0], error: null }),
                then: (resolve: (value: unknown) => unknown) =>
                  Promise.resolve({ data: rows, error: null }).then(resolve),
              }),
            };
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
              const found = batches.find((row) => row.idempotency_key === keyFilter) ?? null;
              return Promise.resolve({ data: found ? { ...found } : null, error: null });
            },
          };
          return query;
        },
        insert(payload: Record<string, unknown>) {
          const candidate: BatchRow = {
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
          const violated = batches.some((row) => row.idempotency_key === candidate.idempotency_key)
            ? "manual_upload_batches_idempotency_key_idx"
            : hashConflict(candidate);

          return {
            select: () => ({
              single: () => {
                if (violated) {
                  return Promise.resolve({
                    data: null,
                    error: { code: "23505", message: `unique constraint "${violated}"`, details: "" },
                  });
                }
                batches.push(candidate);
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
              const updated = batches.filter(
                (row) =>
                  (!filters.id || row.id === filters.id) && (!filters.status || row.status === filters.status),
              );
              for (const row of updated) Object.assign(row, patch);
              return Promise.resolve({ data: updated.map((row) => ({ id: row.id })), error: null });
            },
            then(resolve: (value: unknown) => unknown) {
              for (const row of batches) {
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

  return { client, batches, manuals };
}

const HQ_SCOPE = { scopeType: "hq" as const, franchiseId: "franchise-1", storeId: null };
const STORE_SCOPE = { scopeType: "store" as const, franchiseId: "franchise-1", storeId: "store-1" };

describe("saveManualGroupsWithBatchGuard (실제 함수 실행)", () => {
  test("정상 저장은 부모·자식 행을 만들고 모두 batch에 연결한다", async () => {
    const { client, manuals, batches } = fakeClient();
    const result = await saveManualGroupsWithBatchGuard(client, { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE });

    assert.equal(result.kind, "saved");
    assert.equal(manuals.length, 3);
    assert.equal(manuals.every((row) => row.upload_batch_id === batches[0].id), true);
    assert.equal(batches[0].status, "completed");
    assert.equal(batches[0].manual_count, 3);
  });

  test("부모는 청크하지 않고 자식만 청크·임베딩 대상이 된다", async () => {
    const { client, manuals } = fakeClient();
    await saveManualGroupsWithBatchGuard(client, { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE });

    const parents = manuals.filter((row) => row.parent_manual_id === null);
    const children = manuals.filter((row) => row.parent_manual_id !== null);
    assert.equal(parents.length, 1);
    assert.equal(children.length, 2);
  });

  test("같은 key로 연속 2회 요청하면 한 번만 저장된다", async () => {
    const { client, manuals } = fakeClient();
    const input = { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE, idempotencyKey: "key-1" };

    const first = await saveManualGroupsWithBatchGuard(client, input);
    const second = await saveManualGroupsWithBatchGuard(client, input);

    assert.equal(first.kind, "saved");
    assert.equal(second.kind, "replayed");
    assert.equal(manuals.length, 3);
  });

  test("같은 key로 동시에 2개가 들어와도 한 번만 저장된다", async () => {
    const { client, manuals } = fakeClient();
    const input = { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE, idempotencyKey: "key-1" };

    const results = await Promise.all([
      saveManualGroupsWithBatchGuard(client, input),
      saveManualGroupsWithBatchGuard(client, input),
    ]);

    assert.equal(results.filter((r) => r.kind === "saved").length, 1);
    assert.equal(manuals.length, 3);
  });

  test("완료된 요청을 다시 보내면 그때 만든 행을 그대로 돌려준다", async () => {
    const { client } = fakeClient();
    const input = { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE, idempotencyKey: "key-1" };

    const first = await saveManualGroupsWithBatchGuard(client, input);
    const replay = await saveManualGroupsWithBatchGuard(client, input);

    assert.equal(replay.kind, "replayed");
    assert.equal(first.kind === "saved" && replay.kind === "replayed" ? replay.manuals.length : -1, 3);
  });

  test("같은 범위에 같은 내용을 새 key로 다시 올리면 409로 막는다", async () => {
    const { client, manuals } = fakeClient();
    await saveManualGroupsWithBatchGuard(client, { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE });
    const again = await saveManualGroupsWithBatchGuard(client, { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE });

    assert.equal(again.kind, "blocked");
    assert.equal(again.kind === "blocked" ? again.status : 0, 409);
    assert.equal(manuals.length, 3);
  });

  test("같은 제목이라도 내용이 다르면 저장된다", async () => {
    const { client, manuals } = fakeClient();
    await saveManualGroupsWithBatchGuard(client, { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE });

    const revised: ManualGroupInput[] = [{ ...GROUPS[0], items: ["1. 영수증 확인", "2. 7일 이내 환불"] }];
    const result = await saveManualGroupsWithBatchGuard(client, { auth: HQ_AUTH, groups: revised, scope: HQ_SCOPE });

    assert.equal(result.kind, "saved");
    assert.equal(manuals.length, 6);
  });

  test("같은 내용이라도 다른 지점이면 저장된다", async () => {
    const { client, manuals } = fakeClient();
    await saveManualGroupsWithBatchGuard(client, {
      auth: STORE_AUTH,
      groups: GROUPS,
      storeId: "store-1",
      scope: STORE_SCOPE,
    });
    const other = await saveManualGroupsWithBatchGuard(client, {
      auth: STORE_AUTH,
      groups: GROUPS,
      storeId: "store-2",
      scope: { ...STORE_SCOPE, storeId: "store-2" },
    });

    assert.equal(other.kind, "saved");
    assert.equal(manuals.length, 6);
  });

  test("같은 내용이라도 HQ와 지점은 서로 다른 범위로 저장된다", async () => {
    const { client, manuals } = fakeClient();
    await saveManualGroupsWithBatchGuard(client, { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE });
    const store = await saveManualGroupsWithBatchGuard(client, {
      auth: STORE_AUTH,
      groups: GROUPS,
      storeId: "store-1",
      scope: STORE_SCOPE,
    });

    assert.equal(store.kind, "saved");
    assert.equal(manuals.length, 6);
  });

  test("같은 내용이라도 다른 franchise면 저장된다", async () => {
    const { client, manuals } = fakeClient();
    await saveManualGroupsWithBatchGuard(client, { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE });
    const other = await saveManualGroupsWithBatchGuard(client, {
      auth: { ...HQ_AUTH, franchiseId: "franchise-2" },
      groups: GROUPS,
      scope: { ...HQ_SCOPE, franchiseId: "franchise-2" },
    });

    assert.equal(other.kind, "saved");
    assert.equal(manuals.length, 6);
  });

  test("저장이 실패하면 batch가 실제로 만든 행 수와 함께 failed로 기록된다", async () => {
    const { client, batches, manuals } = fakeClient({ failChildInsert: true });
    const result = await saveManualGroupsWithBatchGuard(client, { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE });

    assert.equal(result.kind, "save_failed");
    assert.equal(batches[0].status, "failed");
    assert.equal(batches[0].manual_count, manuals.length);
    assert.ok(batches[0].manual_count > 0, "부모 행이 남아 있어야 부분 저장 정책이 의미가 있다");
  });

  test("부분 저장이 남은 실패 뒤에는 같은 내용을 새 key로 다시 올려도 막힌다", async () => {
    const { client, batches } = fakeClient({ failChildInsert: true });
    await saveManualGroupsWithBatchGuard(client, { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE });

    const retry = await saveManualGroupsWithBatchGuard(client, { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE });
    assert.equal(retry.kind, "blocked");
    assert.equal(batches.length, 1);
  });

  test("아무것도 저장되지 않고 실패한 경우에는 같은 내용을 다시 시도할 수 있다", async () => {
    const seed: BatchRow[] = [
      {
        id: "batch-failed",
        idempotency_key: "key-1",
        content_hash: "unrelated-hash",
        scope_type: "hq",
        franchise_id: "franchise-1",
        store_id: null,
        requested_by: "hq-user",
        status: "failed",
        manual_count: 0,
      },
    ];
    const { client, manuals } = fakeClient({ seedBatches: seed });

    const result = await saveManualGroupsWithBatchGuard(client, { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE });
    assert.equal(result.kind, "saved");
    assert.equal(manuals.length, 3);
  });

  test("실패 응답에 원본 DB 오류·hash·key·UUID를 담지 않는다", async () => {
    const { client } = fakeClient({ failChildInsert: true });
    const result = await saveManualGroupsWithBatchGuard(client, { auth: HQ_AUTH, groups: GROUPS, scope: HQ_SCOPE });

    assert.equal(result.kind, "save_failed");
    const message = result.kind === "save_failed" ? result.error : "";
    for (const leak of ["child insert failed", "hash", "batch-", "manual-", "23505"]) {
      assert.equal(message.includes(leak), false, `leaks ${leak}`);
    }
    assert.match(message, /[가-힣]/);
  });
});

describe("모든 실제 저장 경로가 같은 진입점을 거친다", () => {
  const SAVING_ROUTES = [
    "app/api/manuals/preview/confirm/route.ts",
    "app/api/store-manuals/preview/confirm/route.ts",
    "app/api/manuals/upload/route.ts",
    "app/api/manuals/route.ts",
    "app/api/store-manuals/route.ts",
    "app/api/store-manuals/batch-create/route.ts",
  ];

  test("manuals 그룹을 저장하는 모든 라우트가 saveManualGroupsWithBatchGuard를 쓴다", () => {
    for (const relative of SAVING_ROUTES) {
      const source = readSource(relative);
      assert.match(source, /saveManualGroupsWithBatchGuard\(/, `${relative} bypasses the guard`);
    }
  });

  test("어떤 라우트도 saveManualGroupsWithChunks를 직접 호출하지 않는다", () => {
    for (const relative of SAVING_ROUTES) {
      const source = readSource(relative);
      assert.equal(/await saveManualGroupsWithChunks\(/.test(source), false, `${relative} calls save directly`);
    }
  });

  test("모든 저장 라우트가 차단/실패 응답 계약을 재사용한다", () => {
    for (const relative of SAVING_ROUTES) {
      const source = readSource(relative);
      assert.match(source, /result\.kind === "blocked"/);
      assert.match(source, /status: result\.status/);
      assert.match(source, /result\.kind === "save_failed"/);
    }
  });

  test("분석·미리보기 라우트는 DB에 쓰지 않는다", () => {
    for (const relative of [
      "app/api/store-manuals/analyze/route.ts",
      "app/api/manuals/preview/route.ts",
      "app/api/store-manuals/preview/route.ts",
    ]) {
      const source = readSource(relative);
      for (const write of [".insert(", ".update(", ".delete(", ".upsert(", "saveManualGroupsWithChunks", "indexManualById"]) {
        assert.equal(source.includes(write), false, `${relative} writes via ${write}`);
      }
    }
  });

  test("HQ 라우트는 body.storeId로 범위를 바꿀 수 없다", () => {
    const source = readSource("app/api/manuals/route.ts");
    assert.match(source, /if \(getString\(body\.storeId\)\) \{/);
    assert.equal(/scopeType: "store"/.test(source), false);
  });

  test("점주 저장 라우트는 검증된 storeAuth.storeId로만 범위를 잡는다", () => {
    for (const relative of [
      "app/api/store-manuals/route.ts",
      "app/api/store-manuals/batch-create/route.ts",
      "app/api/store-manuals/preview/confirm/route.ts",
    ]) {
      const source = readSource(relative);
      assert.match(source, /storeId: storeAuth\.storeId,/);
      assert.match(source, /scope: \{ scopeType: "store", franchiseId: storeAuth\.franchiseId, storeId: storeAuth\.storeId \}/);
    }
  });

  test("어떤 저장 라우트도 body의 hash/franchise/brand/scope를 읽지 않는다", () => {
    for (const relative of SAVING_ROUTES) {
      const code = readSource(relative)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      for (const forbidden of ["body.contentHash", "body.hash", "body.franchiseId", "body.brandName", "body.scopeType"]) {
        assert.equal(code.includes(forbidden), false, `${relative} reads ${forbidden}`);
      }
    }
  });
});

describe("020 마이그레이션 재검토 결과", () => {
  const sql = readSource("supabase/migrations/020_manual_upload_batches.sql");

  test("manual_count 음수와 상태별 completed_at 불일치를 막는 CHECK가 있다", () => {
    assert.match(sql, /check \(manual_count >= 0\)/);
    assert.match(sql, /status = 'processing' and completed_at is null/);
  });

  test("scope별 CHECK로 store 범위의 store_id null을 금지한다", () => {
    assert.match(sql, /scope_type = 'store' and store_id is not null/);
    assert.match(sql, /scope_type = 'hq' and store_id is null/);
  });

  test("idempotency_key unique와 content hash unique는 책임이 분리되어 있다", () => {
    assert.match(sql, /manual_upload_batches_idempotency_key_idx\n\s*on public\.manual_upload_batches \(idempotency_key\)/);
    assert.match(sql, /manual_upload_batches_hq_active_hash_idx/);
    assert.match(sql, /manual_upload_batches_store_active_hash_idx/);
  });

  test("021 이후 번호를 선점하지 않아 공지사항 작업과 충돌하지 않는다", () => {
    assert.equal(sql.includes("021_"), false);
  });
});
