import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PENDING_QUESTION_STATUS,
  fetchPendingQuestionsForOwner,
  updateQuestionResolutionStatusForOwner,
  isMissingResolutionColumnError,
} from "../../lib/owner/pending-questions.ts";

const OWNER_A = "owner-a";
const OWNER_B = "owner-b";
const STAFF = "staff-a";
const HQ_USER = "hq-user-a";
const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FRANCHISE = "ffffffff-ffff-4fff-8fff-ffffffffffff";

type LogRow = {
  id: string;
  question: string;
  answer?: string;
  similarity_score?: number | null;
  source_manual_id?: string | null;
  status: string;
  store_id: string | null;
  created_at: string;
  resolution_status?: string | null;
  resolution_revision?: number | null;
  resolution_updated_at?: string | null;
  resolution_updated_by?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
};

type MembershipRow = { user_id: string; store_id: string; role: string; status: string };

function log(overrides: Partial<LogRow> = {}): LogRow {
  return {
    id: `log-${Math.random().toString(36).slice(2, 10)}`,
    question: "환불 규정이 어떻게 되나요?",
    answer: "해당 질문에 관한 매뉴얼 내용을 찾지 못했습니다.",
    similarity_score: 0.1,
    source_manual_id: null,
    status: PENDING_QUESTION_STATUS,
    store_id: STORE_A,
    created_at: "2026-09-20T00:00:00.000Z",
    resolution_status: "open",
    resolution_revision: 1,
    resolution_updated_at: null,
    resolution_updated_by: null,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

function fakeClient(options: {
  logs?: LogRow[];
  memberships?: MembershipRow[];
  failAt?: string;
}) {
  const memberships = options.memberships ?? [
    { user_id: OWNER_A, store_id: STORE_A, role: "owner", status: "approved" },
    { user_id: OWNER_B, store_id: STORE_B, role: "owner", status: "approved" },
    { user_id: STAFF, store_id: STORE_A, role: "staff", status: "approved" },
    { user_id: HQ_USER, store_id: STORE_A, role: "hq", status: "approved" },
  ];
  const logs = (options.logs ?? []).map((l) => ({ ...l }));
  const updates: Array<{ id: string; payload: Record<string, unknown> }> = [];

  const client = {
    from(table: string) {
      if (table === "store_memberships") {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            const query = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return query;
              },
              maybeSingle() {
                if (options.failAt === "store_memberships") {
                  return Promise.resolve({ data: null, error: { message: "db error" } });
                }
                const found = memberships.find(
                  (m) =>
                    m.user_id === filters.user_id &&
                    m.store_id === filters.store_id &&
                    m.role === filters.role &&
                    m.status === filters.status,
                );
                return Promise.resolve({ data: found ? { id: "m-1" } : null, error: null });
              },
            };
            return query;
          },
        };
      }

      if (table === "stores") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { franchise_id: FRANCHISE }, error: null }),
            }),
          }),
        };
      }

      if (table === "franchises") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: FRANCHISE, name: "브랜드" }, error: null }),
            }),
          }),
        };
      }

      if (table === "question_logs") {
        return {
          select(_columns: string) {
            const filters: Record<string, unknown> = {};
            const inFilters: Record<string, unknown[]> = {};
            const query = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return query;
              },
              in(col: string, vals: unknown[]) {
                inFilters[col] = vals;
                return query;
              },
              order() {
                return query;
              },
              then(resolve: (value: unknown) => unknown) {
                if (options.failAt === "missing_resolution_column" && _columns.includes("resolution_status")) {
                  return Promise.resolve({
                    data: null,
                    error: { code: "42703", message: 'column "resolution_status" does not exist' },
                  }).then(resolve);
                }
                if (options.failAt === "generic_db_error") {
                  return Promise.resolve({
                    data: null,
                    error: { code: "500", message: "connection timeout" },
                  }).then(resolve);
                }
                const filtered = logs.filter((l) => {
                  if (filters.store_id && l.store_id !== filters.store_id) return false;
                  if (filters.status && l.status !== filters.status) return false;
                  if (filters.resolution_status && (l.resolution_status ?? "open") !== filters.resolution_status) return false;
                  if (inFilters.resolution_status && !inFilters.resolution_status.includes(l.resolution_status ?? "open")) return false;
                  return true;
                });
                return Promise.resolve({ data: filtered, error: null }).then(resolve);
              },
              limit(count: number) {
                if (options.failAt === "missing_resolution_column" && _columns.includes("resolution_status")) {
                  return Promise.resolve({
                    data: null,
                    error: { code: "42703", message: 'column "resolution_status" does not exist' },
                  });
                }
                if (options.failAt === "generic_db_error") {
                  return Promise.resolve({
                    data: null,
                    error: { code: "500", message: "connection timeout" },
                  });
                }
                const filtered = logs.filter((l) => {
                  if (filters.store_id && l.store_id !== filters.store_id) return false;
                  if (filters.status && l.status !== filters.status) return false;
                  if (filters.resolution_status && (l.resolution_status ?? "open") !== filters.resolution_status) return false;
                  if (inFilters.resolution_status && !inFilters.resolution_status.includes(l.resolution_status ?? "open")) return false;
                  return true;
                });
                return Promise.resolve({ data: filtered.slice(0, count), error: null });
              },
              maybeSingle() {
                if (options.failAt === "missing_resolution_column" && _columns.includes("resolution_status")) {
                  return Promise.resolve({
                    data: null,
                    error: { code: "42703", message: 'column "resolution_status" does not exist' },
                  });
                }
                if (options.failAt === "generic_db_error") {
                  return Promise.resolve({
                    data: null,
                    error: { code: "500", message: "connection timeout" },
                  });
                }
                const found = logs.find((l) => {
                  if (filters.id && l.id !== filters.id) return false;
                  if (filters.store_id && l.store_id !== filters.store_id) return false;
                  if (filters.status && l.status !== filters.status) return false;
                  return true;
                });
                return Promise.resolve({ data: found ? { ...found } : null, error: null });
              },
            };
            return query;
          },
          update(payload: Record<string, unknown>) {
            const filters: Record<string, unknown> = {};
            const query = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return query;
              },
              select: () => ({
                maybeSingle() {
                  if (options.failAt === "missing_resolution_column") {
                    return Promise.resolve({
                      data: null,
                      error: { code: "42703", message: 'column "resolution_status" does not exist' },
                    });
                  }
                  if (options.failAt === "generic_db_error") {
                    return Promise.resolve({
                      data: null,
                      error: { code: "500", message: "update failed" },
                    });
                  }
                  const index = logs.findIndex((l) => l.id === filters.id);
                  if (index < 0) {
                    return Promise.resolve({ data: null, error: null });
                  }
                  const target = logs[index];

                  // revision 기준 낙관적 동시성 제어
                  if (filters.resolution_revision !== undefined) {
                    const currentRev = target.resolution_revision ?? 1;
                    if (currentRev !== filters.resolution_revision) {
                      return Promise.resolve({ data: null, error: null }); // 충돌
                    }
                  }

                  const updated = { ...target, ...payload };
                  logs[index] = updated;
                  updates.push({ id: target.id, payload });
                  return Promise.resolve({ data: updated, error: null });
                },
              }),
            };
            return query;
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { client, logs, updates };
}

describe("031 미적용 호환 및 에러 판별", () => {
  test("isMissingResolutionColumnError는 031 컬럼 누락 에러만 감지한다", () => {
    assert.equal(
      isMissingResolutionColumnError({ code: "42703", message: 'column "resolution_status" does not exist' }),
      true,
    );
    assert.equal(
      isMissingResolutionColumnError({ code: "PGRST204", message: "columns not found in schema cache: resolution_revision" }),
      true,
    );
    // 다른 컬럼의 42703은 false
    assert.equal(
      isMissingResolutionColumnError({ code: "42703", message: 'column "other_column" does not exist' }),
      false,
    );
    // 일반 DB 에러(권한, 연결 등)는 false
    assert.equal(isMissingResolutionColumnError({ code: "42501", message: "permission denied" }), false);
    assert.equal(isMissingResolutionColumnError({ code: "500", message: "timeout" }), false);
    assert.equal(isMissingResolutionColumnError(null), false);
  });

  test("031 미적용 DB 조회 시 legacy 쿼리로 fallback하고 resolutionFeatureAvailable:false를 반환한다", async () => {
    const logs = [log({ id: "l-1", question: "질문 1" })];
    const { client } = fakeClient({ logs, failAt: "missing_resolution_column" });

    const result = await fetchPendingQuestionsForOwner(client, {
      userId: OWNER_A,
      storeId: STORE_A,
      resolutionStatus: "active",
    });

    assert.equal(result.status, 200);
    if (result.status === 200) {
      assert.equal(result.body.data.resolutionFeatureAvailable, false);
      assert.equal(result.body.data.questions.length, 1);
      assert.equal(result.body.data.questions[0].resolutionStatus, "open");
    }
  });

  test("031 미적용 DB에서 in_progress/resolved 필터 선택 시 기존 open 질문을 반환하지 않는다", async () => {
    const logs = [log({ id: "l-1", question: "질문 1" })];
    const { client } = fakeClient({ logs, failAt: "missing_resolution_column" });

    // in_progress 요청 -> 빈 배열
    const resProg = await fetchPendingQuestionsForOwner(client, {
      userId: OWNER_A,
      storeId: STORE_A,
      resolutionStatus: "in_progress",
    });
    assert.equal(resProg.status, 200);
    if (resProg.status === 200) {
      assert.equal(resProg.body.data.resolutionFeatureAvailable, false);
      assert.equal(resProg.body.data.questions.length, 0);
    }

    // resolved 요청 -> 빈 배열
    const resResolved = await fetchPendingQuestionsForOwner(client, {
      userId: OWNER_A,
      storeId: STORE_A,
      resolutionStatus: "resolved",
    });
    assert.equal(resResolved.status, 200);
    if (resResolved.status === 200) {
      assert.equal(resResolved.body.data.resolutionFeatureAvailable, false);
      assert.equal(resResolved.body.data.questions.length, 0);
    }
  });

  test("컬럼 누락이 아닌 일반 DB 오류는 fallback하지 않고 500을 반환한다", async () => {
    const { client } = fakeClient({ failAt: "generic_db_error" });

    const result = await fetchPendingQuestionsForOwner(client, {
      userId: OWNER_A,
      storeId: STORE_A,
      resolutionStatus: "active",
    });

    assert.equal(result.status, 500);
    assert.equal(result.body.error, "질문 목록을 불러오지 못했습니다.");
  });

  test("031 미적용 DB에서 상태 변경 요청 시 400 RESOLUTION_FEATURE_UNAVAILABLE을 반환한다", async () => {
    const { client } = fakeClient({ logs: [log({ id: "log-1" })], failAt: "missing_resolution_column" });

    const result = await updateQuestionResolutionStatusForOwner(client, {
      userId: OWNER_A,
      questionLogId: "log-1",
      nextStatus: "in_progress",
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.code, "RESOLUTION_FEATURE_UNAVAILABLE");
  });
});

describe("알림 링크와 하이라이트 질문 조회", () => {
  test("resolved 질문도 알림의 questionId로 전달되면 active 필터에서도 목록에 포함된다", async () => {
    const resolvedLog = log({ id: "log-resolved", resolution_status: "resolved" });
    const openLog = log({ id: "log-open", resolution_status: "open" });
    const { client } = fakeClient({ logs: [resolvedLog, openLog] });

    const result = await fetchPendingQuestionsForOwner(client, {
      userId: OWNER_A,
      storeId: STORE_A,
      resolutionStatus: "active",
      highlightQuestionId: "log-resolved",
    });

    assert.equal(result.status, 200);
    if (result.status === 200) {
      const ids = result.body.data.questions.map((q) => q.id);
      assert.ok(ids.includes("log-resolved"), "resolved 질문이 목록에 포함되어야 한다");
      const resolvedItem = result.body.data.questions.find((q) => q.id === "log-resolved");
      assert.equal(resolvedItem?.resolutionStatus, "resolved");
    }
  });

  test("최신 목록(limit 1) 밖의 질문도 highlightQuestionId로 지정되면 목록에 포함된다", async () => {
    const log1 = log({ id: "log-1", created_at: "2026-09-30T02:00:00Z" });
    const log2 = log({ id: "log-2", created_at: "2026-09-30T01:00:00Z" }); // 오래된 질문
    const { client } = fakeClient({ logs: [log1, log2] });

    const result = await fetchPendingQuestionsForOwner(client, {
      userId: OWNER_A,
      storeId: STORE_A,
      limit: "1",
      highlightQuestionId: "log-2",
    });

    assert.equal(result.status, 200);
    if (result.status === 200) {
      const ids = result.body.data.questions.map((q) => q.id);
      assert.ok(ids.includes("log-2"), "범위 밖 질문이 포함되어야 한다");
    }
  });

  test("타 매장의 questionId를 지정해도 조회되지 않는다 (타 매장 차단)", async () => {
    const foreignLog = log({ id: "log-foreign", store_id: STORE_B });
    const myLog = log({ id: "log-mine", store_id: STORE_A });
    const { client } = fakeClient({ logs: [foreignLog, myLog] });

    const result = await fetchPendingQuestionsForOwner(client, {
      userId: OWNER_A,
      storeId: STORE_A,
      highlightQuestionId: "log-foreign",
    });

    assert.equal(result.status, 200);
    if (result.status === 200) {
      const ids = result.body.data.questions.map((q) => q.id);
      assert.equal(ids.includes("log-foreign"), false, "타 매장 질문은 노출되지 않아야 한다");
    }
  });

  test("하이라이트 조회로 인해 질문의 처리 상태나 원본 필드가 변경되지 않는다", async () => {
    const resolvedLog = log({ id: "log-resolved", resolution_status: "resolved", status: "insufficient" });
    const { client, logs } = fakeClient({ logs: [resolvedLog] });

    await fetchPendingQuestionsForOwner(client, {
      userId: OWNER_A,
      storeId: STORE_A,
      highlightQuestionId: "log-resolved",
    });

    assert.equal(logs[0].resolution_status, "resolved");
    assert.equal(logs[0].status, "insufficient");
  });
});

describe("변경 기록(Timestamp, Changer) 및 재열기", () => {
  test("open -> in_progress: resolutionUpdatedAt/By가 설정되고 resolvedAt/By는 null이다", async () => {
    const target = log({ id: "log-1", resolution_status: "open", resolution_revision: 1 });
    const { client, logs } = fakeClient({ logs: [target] });

    const result = await updateQuestionResolutionStatusForOwner(client, {
      userId: OWNER_A,
      questionLogId: "log-1",
      nextStatus: "in_progress",
      currentRevision: 1,
    });

    assert.equal(result.status, 200);
    const updated = logs[0];
    assert.equal(updated.resolution_status, "in_progress");
    assert.equal(updated.resolution_revision, 2);
    assert.equal(typeof updated.resolution_updated_at, "string");
    assert.equal(updated.resolution_updated_by, OWNER_A);
    assert.equal(updated.resolved_at, null);
    assert.equal(updated.resolved_by, null);
  });

  test("in_progress -> resolved: resolvedAt/By와 resolutionUpdatedAt/By가 모두 설정된다", async () => {
    const target = log({ id: "log-1", resolution_status: "in_progress", resolution_revision: 2 });
    const { client, logs } = fakeClient({ logs: [target] });

    const result = await updateQuestionResolutionStatusForOwner(client, {
      userId: OWNER_A,
      questionLogId: "log-1",
      nextStatus: "resolved",
      currentRevision: 2,
    });

    assert.equal(result.status, 200);
    const updated = logs[0];
    assert.equal(updated.resolution_status, "resolved");
    assert.equal(updated.resolution_revision, 3);
    assert.equal(typeof updated.resolved_at, "string");
    assert.equal(updated.resolved_by, OWNER_A);
    assert.equal(typeof updated.resolution_updated_at, "string");
    assert.equal(updated.resolution_updated_by, OWNER_A);
  });

  test("resolved -> in_progress (재열기): resolvedAt/By는 null로 리셋되고 resolutionUpdatedAt/By가 갱신된다", async () => {
    const target = log({
      id: "log-1",
      resolution_status: "resolved",
      resolution_revision: 3,
      resolved_at: "2026-09-30T00:00:00Z",
      resolved_by: OWNER_B,
    });
    const { client, logs } = fakeClient({ logs: [target] });

    const result = await updateQuestionResolutionStatusForOwner(client, {
      userId: OWNER_A,
      questionLogId: "log-1",
      nextStatus: "in_progress",
      currentRevision: 3,
    });

    assert.equal(result.status, 200);
    const updated = logs[0];
    assert.equal(updated.resolution_status, "in_progress");
    assert.equal(updated.resolution_revision, 4);
    assert.equal(updated.resolved_at, null, "재열기 시 resolved_at은 null이어야 한다");
    assert.equal(updated.resolved_by, null, "재열기 시 resolved_by는 null이어야 한다");
    assert.equal(typeof updated.resolution_updated_at, "string");
    assert.equal(updated.resolution_updated_by, OWNER_A);
  });
});

describe("동시성 제어 (Revision 기반 및 ABA 방지)", () => {
  test("클라이언트 revision이 현재 DB revision과 다르면 409 CONFLICT를 반환한다", async () => {
    const target = log({ id: "log-1", resolution_status: "open", resolution_revision: 2 });
    const { client } = fakeClient({ logs: [target] });

    const result = await updateQuestionResolutionStatusForOwner(client, {
      userId: OWNER_A,
      questionLogId: "log-1",
      nextStatus: "in_progress",
      currentRevision: 1, // 오래된 revision
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.code, "RESOLUTION_STATUS_CONFLICT");
  });

  test("ABA 시나리오: open -> in_progress -> open으로 돌아왔어도 오래된 요청(rev 1)은 409로 차단된다", async () => {
    // rev 1 (open) -> rev 2 (in_progress) -> rev 3 (open으로 다시 변경됨)
    const target = log({ id: "log-1", resolution_status: "open", resolution_revision: 3 });
    const { client } = fakeClient({ logs: [target] });

    // 사용자는 rev 1의 open 상태를 보고 in_progress로 변경 시도
    const result = await updateQuestionResolutionStatusForOwner(client, {
      userId: OWNER_A,
      questionLogId: "log-1",
      nextStatus: "in_progress",
      currentStatus: "open",
      currentRevision: 1, // stale revision!
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.code, "RESOLUTION_STATUS_CONFLICT");
  });

  test("같은 상태 재요청도 revision이 다르면 409 CONFLICT를 반환한다", async () => {
    const target = log({ id: "log-1", resolution_status: "open", resolution_revision: 3 });
    const { client } = fakeClient({ logs: [target] });

    const result = await updateQuestionResolutionStatusForOwner(client, {
      userId: OWNER_A,
      questionLogId: "log-1",
      nextStatus: "open",
      currentRevision: 1, // stale!
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.code, "RESOLUTION_STATUS_CONFLICT");
  });

  test("같은 상태 재요청에서 revision이 일치하면 200 멱등 처리된다", async () => {
    const target = log({ id: "log-1", resolution_status: "open", resolution_revision: 2 });
    const { client, updates } = fakeClient({ logs: [target] });

    const result = await updateQuestionResolutionStatusForOwner(client, {
      userId: OWNER_A,
      questionLogId: "log-1",
      nextStatus: "open",
      currentRevision: 2,
    });

    assert.equal(result.status, 200);
    assert.equal(updates.length, 0, "DB write가 실행되지 않아야 한다");
  });
});

describe("권한 및 기본 제약 검증", () => {
  test("answered/cautious 질문에 대해 상태 변경을 요청하면 거절된다", async () => {
    const target = log({ id: "log-answered", status: "answered" });
    const { client } = fakeClient({ logs: [target] });

    const result = await updateQuestionResolutionStatusForOwner(client, {
      userId: OWNER_A,
      questionLogId: "log-answered",
      nextStatus: "in_progress",
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error, "보류된 질문만 처리 상태를 변경할 수 있습니다.");
  });

  test("다른 매장 점주는 상태를 변경할 수 없다 (403)", async () => {
    const target = log({ id: "log-1", store_id: STORE_A });
    const { client } = fakeClient({ logs: [target] });

    const result = await updateQuestionResolutionStatusForOwner(client, {
      userId: OWNER_B,
      questionLogId: "log-1",
      nextStatus: "resolved",
    });
    assert.equal(result.status, 403);
  });

  test("직원(staff) 또는 본사(hq) 사용자는 상태를 변경할 수 없다 (403)", async () => {
    const target = log({ id: "log-1", store_id: STORE_A });
    const { client } = fakeClient({ logs: [target] });

    const staffRes = await updateQuestionResolutionStatusForOwner(client, {
      userId: STAFF,
      questionLogId: "log-1",
      nextStatus: "resolved",
    });
    assert.equal(staffRes.status, 403);

    const hqRes = await updateQuestionResolutionStatusForOwner(client, {
      userId: HQ_USER,
      questionLogId: "log-1",
      nextStatus: "resolved",
    });
    assert.equal(hqRes.status, 403);
  });

  test("존재하지 않는 질문 ID 요청 시 404를 반환한다", async () => {
    const { client } = fakeClient({ logs: [] });
    const result = await updateQuestionResolutionStatusForOwner(client, {
      userId: OWNER_A,
      questionLogId: "non-existent-id",
      nextStatus: "resolved",
    });
    assert.equal(result.status, 404);
  });
});
