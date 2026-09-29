import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_PENDING_QUESTION_LIMIT,
  MAX_PENDING_QUESTION_LIMIT,
  PENDING_QUESTION_STATUS,
  fetchPendingQuestionsForOwner,
  parsePendingQuestionLimit,
  toPendingQuestions,
} from "../../lib/owner/pending-questions.ts";

const OWNER_A = "owner-a";
const OWNER_B = "owner-b";
const STAFF = "staff-a";
const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FRANCHISE = "ffffffff-ffff-4fff-8fff-ffffffffffff";

type MembershipRow = { user_id: string; store_id: string; role: string; status: string };
type LogRow = {
  id: string;
  question: string;
  answer?: string;
  similarity_score?: number | null;
  source_manual_id?: string | null;
  status: string;
  store_id: string | null;
  created_at: string;
};

type FailurePoint = "store_memberships" | "question_logs";

function log(overrides: Partial<LogRow> = {}): LogRow {
  return {
    id: `log-${Math.random().toString(36).slice(2, 10)}`,
    question: "환불 어떻게 하나요?",
    answer: "해당 질문에 관한 매뉴얼 내용을 찾지 못했습니다.",
    similarity_score: 0.12,
    source_manual_id: null,
    status: PENDING_QUESTION_STATUS,
    store_id: STORE_A,
    created_at: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * 006의 store_memberships, 004의 stores/franchises, 001+022의 question_logs를 흉내낸다.
 * requireStoreOwner도 실제 함수가 이 client로 실행된다. 실제 Supabase는 쓰지 않는다.
 */
function fakeClient(options: {
  memberships?: MembershipRow[];
  logs?: LogRow[];
  storeFranchiseId?: string | null;
  failAt?: FailurePoint;
  throwAt?: FailurePoint;
} = {}) {
  const memberships = options.memberships ?? [
    { user_id: OWNER_A, store_id: STORE_A, role: "owner", status: "approved" },
    { user_id: OWNER_B, store_id: STORE_B, role: "owner", status: "approved" },
  ];
  const logs = options.logs ?? [];
  const storeFranchiseId =
    options.storeFranchiseId === undefined ? FRANCHISE : options.storeFranchiseId;
  const dbError = { code: "42703", message: 'column "x" does not exist: select * from question_logs' };
  const selectedColumns: string[] = [];
  let appliedLimit: number | null = null;
  let appliedOrder: { column: string; ascending: boolean } | null = null;

  const client = {
    from(table: string) {
      if (table === "store_memberships") {
        if (options.throwAt === "store_memberships") throw new Error("fetch failed");
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            const query = {
              eq(column: string, value: unknown) {
                filters[column] = value;
                return query;
              },
              maybeSingle() {
                if (options.failAt === "store_memberships") {
                  return Promise.resolve({ data: null, error: dbError });
                }
                const found = memberships.find(
                  (row) =>
                    row.user_id === filters.user_id
                    && row.store_id === filters.store_id
                    && row.role === filters.role
                    && row.status === filters.status,
                );
                return Promise.resolve({ data: found ? { id: "membership-1" } : null, error: null });
              },
            };
            return query;
          },
        };
      }

      if (table === "stores") {
        return {
          select: () => {
            const query = {
              eq: () => query,
              maybeSingle: () =>
                Promise.resolve({ data: { franchise_id: storeFranchiseId }, error: null }),
            };
            return query;
          },
        };
      }

      if (table === "franchises") {
        return {
          select: () => {
            const query = {
              eq: () => query,
              maybeSingle: () =>
                Promise.resolve({ data: { id: FRANCHISE, name: "브랜드" }, error: null }),
            };
            return query;
          },
        };
      }

      if (table !== "question_logs") {
        throw new Error(`Unexpected table: ${table}`);
      }

      if (options.throwAt === "question_logs") throw new Error("fetch failed");

      return {
        select(columns: string) {
          selectedColumns.push(columns);
          const filters: Record<string, unknown> = {};
          const query = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return query;
            },
            order(column: string, opts: { ascending: boolean }) {
              appliedOrder = { column, ascending: opts.ascending };
              return query;
            },
            limit(value: number) {
              appliedLimit = value;
              if (options.failAt === "question_logs") {
                return Promise.resolve({ data: null, error: dbError });
              }
              const rows = logs
                .filter((row) => row.store_id === filters.store_id && row.status === filters.status)
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .slice(0, value);
              return Promise.resolve({ data: rows, error: null });
            },
          };
          return query;
        },
      };
    },
  } as unknown as SupabaseClient;

  return {
    client,
    inspect: () => ({ selectedColumns, appliedLimit, appliedOrder }),
  };
}

describe("fetchPendingQuestionsForOwner (가짜 DB로 실제 함수 실행)", () => {
  test("본인 매장의 보류된 질문만 돌려준다", async () => {
    const { client } = fakeClient({
      logs: [
        log({ id: "log-a1", question: "A 매장 보류 질문", created_at: "2026-09-20T00:00:00.000Z" }),
        log({ id: "log-a2", status: "answered", question: "A 매장 답변된 질문" }),
        log({ id: "log-b1", store_id: STORE_B, question: "B 매장 보류 질문" }),
      ],
    });

    const result = await fetchPendingQuestionsForOwner(client, { userId: OWNER_A, storeId: STORE_A });

    assert.equal(result.status, 200);
    const questions = result.status === 200 ? result.body.data.questions : [];
    assert.deepEqual(questions.map((q) => q.id), ["log-a1"]);
    assert.equal(questions[0].question, "A 매장 보류 질문");
    assert.equal(questions[0].status, PENDING_QUESTION_STATUS);
  });

  test("다른 매장 점주는 차단된다", async () => {
    const { client } = fakeClient({ logs: [log()] });
    const result = await fetchPendingQuestionsForOwner(client, { userId: OWNER_B, storeId: STORE_A });

    assert.equal(result.status, 403);
    assert.equal(result.status === 403 ? result.body.error : "", "이 매장에 대한 접근 권한이 없습니다.");
    assert.equal(JSON.stringify(result.body).includes("환불"), false);
  });

  test("미승인(pending/rejected) 점주는 차단된다", async () => {
    for (const status of ["pending", "rejected"]) {
      const { client } = fakeClient({
        memberships: [{ user_id: OWNER_A, store_id: STORE_A, role: "owner", status }],
        logs: [log()],
      });
      const result = await fetchPendingQuestionsForOwner(client, { userId: OWNER_A, storeId: STORE_A });

      assert.equal(result.status, 403, `status=${status}`);
    }
  });

  test("같은 매장 직원(staff)도 차단된다", async () => {
    const { client } = fakeClient({
      memberships: [{ user_id: STAFF, store_id: STORE_A, role: "staff", status: "approved" }],
      logs: [log()],
    });
    const result = await fetchPendingQuestionsForOwner(client, { userId: STAFF, storeId: STORE_A });

    assert.equal(result.status, 403);
  });

  test("매장에 franchise_id가 없으면 fail closed 한다", async () => {
    const { client } = fakeClient({ storeFranchiseId: null, logs: [log()] });
    const result = await fetchPendingQuestionsForOwner(client, { userId: OWNER_A, storeId: STORE_A });

    assert.equal(result.status, 403);
  });

  test("storeId가 없으면 400을 돌려주고 조회하지 않는다", async () => {
    const { client, inspect } = fakeClient({ logs: [log()] });
    for (const storeId of [undefined, null, "", "   "]) {
      const result = await fetchPendingQuestionsForOwner(client, { userId: OWNER_A, storeId });
      assert.equal(result.status, 400);
    }
    assert.equal(inspect().selectedColumns.length, 0);
  });

  test("보류 질문이 없으면 빈 목록으로 성공한다", async () => {
    const { client } = fakeClient({ logs: [log({ status: "answered" })] });
    const result = await fetchPendingQuestionsForOwner(client, { userId: OWNER_A, storeId: STORE_A });

    assert.equal(result.status, 200);
    assert.deepEqual(result.status === 200 ? result.body.data.questions : null, []);
    assert.equal(result.status === 200 ? result.body.success : false, true);
  });

  test("store_id가 NULL인 022 이전 행은 제외된다", async () => {
    const { client } = fakeClient({
      logs: [log({ id: "legacy", store_id: null }), log({ id: "current" })],
    });
    const result = await fetchPendingQuestionsForOwner(client, { userId: OWNER_A, storeId: STORE_A });

    assert.deepEqual(
      result.status === 200 ? result.body.data.questions.map((q) => q.id) : [],
      ["current"],
    );
  });

  test("최신 질문부터 돌려준다", async () => {
    const { client, inspect } = fakeClient({
      logs: [
        log({ id: "old", created_at: "2026-09-01T00:00:00.000Z" }),
        log({ id: "new", created_at: "2026-09-27T00:00:00.000Z" }),
        log({ id: "mid", created_at: "2026-09-15T00:00:00.000Z" }),
      ],
    });
    const result = await fetchPendingQuestionsForOwner(client, { userId: OWNER_A, storeId: STORE_A });

    assert.deepEqual(
      result.status === 200 ? result.body.data.questions.map((q) => q.id) : [],
      ["new", "mid", "old"],
    );
    assert.deepEqual(inspect().appliedOrder, { column: "created_at", ascending: false });
  });

  test("한 번에 가져오는 건수를 제한한다", async () => {
    const logs = Array.from({ length: 80 }, (_, index) =>
      log({ id: `log-${index}`, created_at: `2026-09-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z` }));

    const { client, inspect } = fakeClient({ logs });
    const result = await fetchPendingQuestionsForOwner(client, { userId: OWNER_A, storeId: STORE_A });
    assert.equal(inspect().appliedLimit, DEFAULT_PENDING_QUESTION_LIMIT);
    assert.equal(result.status === 200 ? result.body.data.questions.length : -1, DEFAULT_PENDING_QUESTION_LIMIT);
    assert.equal(result.status === 200 ? result.body.data.limit : -1, DEFAULT_PENDING_QUESTION_LIMIT);

    const capped = fakeClient({ logs });
    await fetchPendingQuestionsForOwner(capped.client, { userId: OWNER_A, storeId: STORE_A, limit: "9999" });
    assert.equal(capped.inspect().appliedLimit, MAX_PENDING_QUESTION_LIMIT);
  });

  test("응답에 answer·유사도·근거 매뉴얼 id를 담지 않는다", async () => {
    const { client, inspect } = fakeClient({
      logs: [log({ id: "log-1", answer: "내부 답변", similarity_score: 0.91, source_manual_id: "manual-1" })],
    });
    const result = await fetchPendingQuestionsForOwner(client, { userId: OWNER_A, storeId: STORE_A });

    const questions = result.status === 200 ? result.body.data.questions : [];
    assert.deepEqual(Object.keys(questions[0]).sort(), ["createdAt", "id", "question", "status"]);

    const serialized = JSON.stringify(result.body);
    for (const leak of ["내부 답변", "similarity", "source_manual_id", "manual-1", "0.91", "store_id"]) {
      assert.equal(serialized.includes(leak), false, `leaks ${leak}`);
    }
    // 애초에 필요한 컬럼만 select 한다.
    assert.deepEqual(inspect().selectedColumns, ["id, question, status, store_id, created_at"]);
  });
});

describe("DB 오류 처리", () => {
  for (const failAt of ["store_memberships", "question_logs"] as const) {
    test(`${failAt} 조회 오류는 원본 오류 없이 안전하게 응답한다`, async () => {
      const { client } = fakeClient({ failAt, logs: [log()] });
      const result = await fetchPendingQuestionsForOwner(client, { userId: OWNER_A, storeId: STORE_A });

      // 권한 조회 실패는 requireStoreOwner가 fail closed(null) 하므로 403, 질문 조회 실패는 500이다.
      assert.ok(result.status === 403 || result.status === 500, String(result.status));
      const serialized = JSON.stringify(result.body);
      for (const leak of ["42703", "does not exist", "select * from", "column"]) {
        assert.equal(serialized.includes(leak), false, `leaks ${leak}`);
      }
      assert.match(serialized, /[가-힣]/);
    });
  }

  test("질문 조회 오류는 고정 문구로 500을 돌려준다", async () => {
    const { client } = fakeClient({ failAt: "question_logs", logs: [log()] });
    const result = await fetchPendingQuestionsForOwner(client, { userId: OWNER_A, storeId: STORE_A });

    assert.equal(result.status, 500);
    assert.equal(result.status === 500 ? result.body.error : "", "질문 목록을 불러오지 못했습니다.");
  });

  for (const throwAt of ["store_memberships", "question_logs"] as const) {
    test(`${throwAt}에서 예외가 나도 호출부로 던지지 않는다`, async () => {
      const { client } = fakeClient({ throwAt, logs: [log()] });
      const result = await fetchPendingQuestionsForOwner(client, { userId: OWNER_A, storeId: STORE_A });

      assert.equal(result.status, 500);
    });
  }
});

describe("parsePendingQuestionLimit", () => {
  test("값이 없으면 기본값을 쓴다", () => {
    for (const raw of [null, undefined, "", "   "]) {
      assert.equal(parsePendingQuestionLimit(raw), DEFAULT_PENDING_QUESTION_LIMIT);
    }
  });

  test("잘못된 값은 기본값으로 떨어진다", () => {
    for (const raw of ["abc", "0", "-5", "1.5", "NaN", "Infinity"]) {
      assert.equal(parsePendingQuestionLimit(raw), DEFAULT_PENDING_QUESTION_LIMIT, raw);
    }
  });

  test("상한을 넘기면 상한으로 자른다", () => {
    assert.equal(parsePendingQuestionLimit("9999"), MAX_PENDING_QUESTION_LIMIT);
    assert.equal(parsePendingQuestionLimit(String(MAX_PENDING_QUESTION_LIMIT + 1)), MAX_PENDING_QUESTION_LIMIT);
  });

  test("정상 범위 값은 그대로 쓴다", () => {
    assert.equal(parsePendingQuestionLimit("1"), 1);
    assert.equal(parsePendingQuestionLimit("35"), 35);
  });
});

describe("toPendingQuestions", () => {
  test("검증된 매장의 보류 행만 남긴다", () => {
    const questions = toPendingQuestions(
      [
        log({ id: "keep" }),
        log({ id: "other-store", store_id: STORE_B }),
        log({ id: "null-store", store_id: null }),
        log({ id: "answered", status: "answered" }),
      ],
      STORE_A,
    );

    assert.deepEqual(questions.map((q) => q.id), ["keep"]);
  });

  test("형식이 깨진 행은 조용히 제외한다", () => {
    const questions = toPendingQuestions(
      [
        { id: 1, question: "q", status: PENDING_QUESTION_STATUS, store_id: STORE_A, created_at: "t" },
        { id: "a", question: "", status: PENDING_QUESTION_STATUS, store_id: STORE_A, created_at: "t" },
        { id: "b", question: "q", status: PENDING_QUESTION_STATUS, store_id: STORE_A, created_at: null },
      ],
      STORE_A,
    );

    assert.deepEqual(questions, []);
  });

  test("검증된 storeId가 비어 있으면 아무것도 돌려주지 않는다", () => {
    assert.deepEqual(toPendingQuestions([log()], ""), []);
  });

  test("질문 앞뒤 공백을 정리한다", () => {
    const questions = toPendingQuestions([log({ id: "a", question: "  환불 규정  " })], STORE_A);
    assert.equal(questions[0].question, "환불 규정");
  });
});

describe("app/api/boss/question-logs/route.ts (계약)", () => {
  const source = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../app/api/boss/question-logs/route.ts",
    ),
    "utf8",
  ).replace(/\r\n/g, "\n");

  test("비로그인 사용자는 조회 전에 401로 막는다", () => {
    assert.match(source, /if \(userError \|\| !userData\.user\) \{[\s\S]*?unauthenticatedPendingQuestionsResult\(\)/);
  });

  test("userId는 세션에서만 오고 쿼리에서 오지 않는다", () => {
    assert.match(source, /userId: userData\.user\.id/);
    assert.equal(/userId: searchParams\.get/.test(source), false);
  });

  test("storeId와 limit만 쿼리에서 읽는다", () => {
    assert.match(source, /storeId: searchParams\.get\("storeId"\)/);
    assert.match(source, /limit: searchParams\.get\("limit"\)/);
  });

  test("쓰기 동작을 하지 않는 읽기 전용 라우트다", () => {
    for (const write of [".insert(", ".update(", ".delete(", ".upsert(", "export async function POST"]) {
      assert.equal(source.includes(write), false, `${write} found`);
    }
  });

  test("응답 상태 코드를 result에서 그대로 쓴다", () => {
    assert.match(source, /NextResponse\.json\(result\.body, \{ status: result\.status \}\)/);
  });

  test("catch에서 원본 오류 message를 응답에 넣지 않는다", () => {
    assert.equal(/\{ error: \w+ instanceof Error \? \w+\.message/.test(source), false);
  });
});
