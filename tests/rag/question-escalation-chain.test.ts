import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { SupabaseClient } from "@supabase/supabase-js";

import { escalateQuestionLogToStoreOwners } from "../../lib/notifications/escalate-question-log.ts";
import { finalizeRagQueryResponse } from "../../lib/rag/finalize-rag-query-response.ts";
import {
  createQuestionLogWriter,
  saveQuestionLog,
  type QuestionLogInsertClient,
  type SaveQuestionLogResult,
} from "../../lib/rag/save-question-log.ts";

const QUESTION = "폐기 기준이 어떻게 되나요?";
const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER_A = "owner-a";
const OWNER_B = "owner-b";
const LOG_ID = "11111111-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;

const INSUFFICIENT_RESPONSE = {
  answer: "해당 질문에 관한 매뉴얼 내용을 찾지 못했습니다. 매장 관리자에게 문의해 주세요.",
  similarity: 0.12,
  source: null,
  status: "insufficient" as const,
  matches: [],
};

/** 001+022의 question_logs, 006의 store_memberships, 013의 notifications를 흉내낸다. */
function fakeEscalationClient(options: {
  logs?: Row[];
  memberships?: Row[];
  notifications?: Row[];
} = {}) {
  const logs = options.logs ?? [{ id: LOG_ID, status: "insufficient", store_id: STORE_A }];
  const memberships = options.memberships ?? [
    { user_id: OWNER_A, store_id: STORE_A, role: "owner", status: "approved" },
    { user_id: OWNER_B, store_id: STORE_B, role: "owner", status: "approved" },
  ];
  const notifications: Row[] = (options.notifications ?? []).map((row) => ({ ...row }));

  const matches = (row: Row, filters: Row) =>
    Object.entries(filters).every(([column, value]) => row[column] === value);

  const client = {
    from(table: string) {
      if (table === "question_logs") {
        return {
          select: () => {
            const filters: Row = {};
            const query = {
              eq(column: string, value: unknown) { filters[column] = value; return query; },
              maybeSingle: () =>
                Promise.resolve({ data: logs.find((row) => matches(row, filters)) ?? null, error: null }),
            };
            return query;
          },
        };
      }

      if (table === "store_memberships") {
        return {
          select: () => {
            const filters: Row = {};
            const query = {
              eq(column: string, value: unknown) { filters[column] = value; return query; },
              then(resolve: (value: unknown) => unknown) {
                const rows = memberships.filter((row) => matches(row, filters));
                return Promise.resolve({ data: rows.map(({ user_id }) => ({ user_id })), error: null }).then(resolve);
              },
            };
            return query;
          },
        };
      }

      if (table !== "notifications") {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select: () => {
          const filters: Row = {};
          let recipients: string[] = [];
          const query = {
            eq(column: string, value: unknown) { filters[column] = value; return query; },
            in(_column: string, values: string[]) { recipients = values; return query; },
            then(resolve: (value: unknown) => unknown) {
              const rows = notifications.filter(
                (row) => matches(row, filters) && recipients.includes(row.recipient_user_id as string),
              );
              return Promise.resolve({
                data: rows.map(({ recipient_user_id }) => ({ recipient_user_id })),
                error: null,
              }).then(resolve);
            },
          };
          return query;
        },
        insert(payload: Row) {
          const duplicated = notifications.some(
            (row) =>
              row.type === payload.type
              && row.related_id === payload.related_id
              && row.recipient_user_id === payload.recipient_user_id,
          );
          if (duplicated) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
          }
          notifications.push({ ...payload });
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, notifications };
}

/**
 * /api/rag/query가 insufficient 경로에서 연결한 흐름을 실제 함수 조합으로 재현한다.
 * 라우트가 같은 가드를 쓰는지는 아래 "라우트 연결 계약" describe가 소스로 고정한다.
 */
async function runInsufficientFlow(options: {
  storeId: string;
  escalationClient: SupabaseClient;
  logWriterResult?: { error: unknown | null; id?: string | null };
}) {
  const escalations: SaveQuestionLogResult[] = [];
  const savedPayloads: Row[] = [];

  const response = await finalizeRagQueryResponse({
    httpStatus: 200,
    question: QUESTION,
    storeId: options.storeId,
    response: INSUFFICIENT_RESPONSE,
    afterQuestionLogSaved: async (logResult) => {
      escalations.push(logResult);
      if (!logResult.saved || !logResult.questionLogId) return;
      await escalateQuestionLogToStoreOwners(options.escalationClient, {
        questionLogId: logResult.questionLogId,
        storeId: options.storeId,
      });
    },
  }, (input) => saveQuestionLog(input, async (payload) => {
    savedPayloads.push(payload);
    return options.logWriterResult ?? { error: null, id: LOG_ID };
  }));

  return { response, escalations, savedPayloads };
}

describe("insufficient 질문 -> 매장 점주 알림 (실제 함수 조합)", () => {
  test("검증된 storeId가 question_logs.store_id로 기록된다", async () => {
    const { client } = fakeEscalationClient();
    const { savedPayloads } = await runInsufficientFlow({ storeId: STORE_A, escalationClient: client });

    assert.equal(savedPayloads.length, 1);
    assert.equal(savedPayloads[0].store_id, STORE_A);
    assert.equal(savedPayloads[0].status, "insufficient");
  });

  test("해당 매장의 승인 점주에게만 알림이 간다", async () => {
    const { client, notifications } = fakeEscalationClient();
    await runInsufficientFlow({ storeId: STORE_A, escalationClient: client });

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].recipient_user_id, OWNER_A);
    assert.equal(notifications[0].related_id, LOG_ID);
  });

  test("다른 매장 점주에게는 알림이 가지 않는다", async () => {
    const { client, notifications } = fakeEscalationClient();
    await runInsufficientFlow({ storeId: STORE_A, escalationClient: client });

    assert.equal(notifications.some((row) => row.recipient_user_id === OWNER_B), false);
  });

  test("점주가 없는 매장이면 알림을 만들지 않는다", async () => {
    const { client, notifications } = fakeEscalationClient({ memberships: [] });
    await runInsufficientFlow({ storeId: STORE_A, escalationClient: client });

    assert.equal(notifications.length, 0);
  });

  test("미승인 점주에게는 알림이 가지 않는다", async () => {
    const { client, notifications } = fakeEscalationClient({
      memberships: [{ user_id: OWNER_A, store_id: STORE_A, role: "owner", status: "pending" }],
    });
    await runInsufficientFlow({ storeId: STORE_A, escalationClient: client });

    assert.equal(notifications.length, 0);
  });

  test("같은 질문 로그로 두 번 실행해도 알림은 한 번만 생긴다", async () => {
    const { client, notifications } = fakeEscalationClient();
    await runInsufficientFlow({ storeId: STORE_A, escalationClient: client });
    await runInsufficientFlow({ storeId: STORE_A, escalationClient: client });

    assert.equal(notifications.length, 1);
  });

  test("로그 저장이 실패하면 알림을 시도하지 않는다", async () => {
    const { client, notifications } = fakeEscalationClient();
    const { escalations } = await runInsufficientFlow({
      storeId: STORE_A,
      escalationClient: client,
      logWriterResult: { error: { code: "42703", message: "column missing" } },
    });

    assert.deepEqual(escalations, [{ saved: false, code: "QUESTION_LOG_SAVE_FAILED" }]);
    assert.equal(notifications.length, 0);
  });

  test("로그 id를 못 받으면 알림을 시도하지 않는다", async () => {
    const { client, notifications } = fakeEscalationClient();
    await runInsufficientFlow({
      storeId: STORE_A,
      escalationClient: client,
      logWriterResult: { error: null, id: null },
    });

    assert.equal(notifications.length, 0);
  });

  test("알림 DB 오류가 나도 직원 답변과 응답 객체는 그대로다", async () => {
    const failingClient = {
      from: () => ({
        select: () => {
          const query = {
            eq: () => query,
            maybeSingle: () => Promise.resolve({ data: null, error: { code: "42703", message: "column missing" } }),
          };
          return query;
        },
      }),
    } as unknown as SupabaseClient;

    const { response } = await runInsufficientFlow({ storeId: STORE_A, escalationClient: failingClient });

    assert.strictEqual(response, INSUFFICIENT_RESPONSE);
    assert.equal("answer" in response ? response.answer : "", INSUFFICIENT_RESPONSE.answer);
  });

  test("알림에 질문 원문이나 매장·로그 식별자를 문구로 복제하지 않는다", async () => {
    const { client, notifications } = fakeEscalationClient();
    await runInsufficientFlow({ storeId: STORE_A, escalationClient: client });

    const text = `${notifications[0].title} ${notifications[0].message}`;
    for (const leak of [QUESTION, "폐기", STORE_A, LOG_ID, OWNER_A, "0.12", "insufficient"]) {
      assert.equal(text.includes(leak), false, `leaks ${leak}`);
    }
    assert.equal(notifications[0].target_url, null);
  });
});

describe("createQuestionLogWriter - 022 미적용 대비", () => {
  function fakeInsertClient(options: { failFirstWithMissingStoreId?: boolean } = {}) {
    const inserts: Row[] = [];
    let call = 0;
    const client: QuestionLogInsertClient = {
      from: () => ({
        insert: (payload: Row) => ({
          select: () => ({
            single: () => {
              call += 1;
              inserts.push(payload);
              if (options.failFirstWithMissingStoreId && call === 1) {
                return Promise.resolve({
                  data: null,
                  error: { code: "42703", message: `column "store_id" of relation "question_logs" does not exist` },
                });
              }
              return Promise.resolve({ data: { id: LOG_ID }, error: null });
            },
          }),
        }),
      }),
    };
    return { client, inserts };
  }

  test("정상 환경에서는 store_id를 담아 한 번에 저장하고 id를 돌려준다", async () => {
    const { client, inserts } = fakeInsertClient();
    const result = await createQuestionLogWriter(client)({
      question: QUESTION,
      answer: "a",
      similarity_score: 0.1,
      status: "insufficient",
      source_manual_id: null,
      store_id: STORE_A,
    });

    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].store_id, STORE_A);
    assert.deepEqual(result, { error: null, id: LOG_ID });
  });

  test("store_id 컬럼이 없으면 그 컬럼만 빼고 다시 저장한다(기존 로그 유실 방지)", async () => {
    const { client, inserts } = fakeInsertClient({ failFirstWithMissingStoreId: true });
    const result = await createQuestionLogWriter(client)({
      question: QUESTION,
      answer: "a",
      similarity_score: 0.9,
      status: "answered",
      source_manual_id: null,
      store_id: STORE_A,
    });

    assert.equal(inserts.length, 2);
    assert.equal(Object.hasOwn(inserts[1], "store_id"), false);
    assert.equal(inserts[1].status, "answered");
    assert.deepEqual(result, { error: null, id: LOG_ID });
  });

  test("store_id와 무관한 오류는 재시도하지 않는다", async () => {
    const inserts: Row[] = [];
    const client: QuestionLogInsertClient = {
      from: () => ({
        insert: (payload: Row) => ({
          select: () => ({
            single: () => {
              inserts.push(payload);
              return Promise.resolve({ data: null, error: { code: "23502", message: "null value in column answer" } });
            },
          }),
        }),
      }),
    };

    const result = await createQuestionLogWriter(client)({
      question: QUESTION,
      answer: "a",
      similarity_score: null,
      status: "insufficient",
      source_manual_id: null,
      store_id: STORE_A,
    });

    assert.equal(inserts.length, 1);
    assert.equal(result.id, null);
    assert.ok(result.error);
  });
});

describe("app/api/rag/query/route.ts 연결 계약", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/api/rag/query/route.ts"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  test("모든 로그 저장 경로에 검증된 storeId를 넘긴다", () => {
    const finalizeCalls = source.match(/finalizeRagQueryResponse\(\{/g) ?? [];
    // finalize 입력의 question 바로 뒤에 오는 storeId만 센다(에스컬레이션 인자와 구분).
    const storeIdArgs = source.match(/question,\s*\n\s*storeId,/g) ?? [];
    assert.equal(finalizeCalls.length, 3);
    assert.equal(storeIdArgs.length, 3);
  });

  test("insufficient 두 경로에서만 에스컬레이션을 건다", () => {
    assert.equal((source.match(/afterQuestionLogSaved: escalateInsufficientQuestion\(storeId\)/g) ?? []).length, 2);
  });

  test("저장 성공과 로그 id를 확인한 뒤에만 알림을 보낸다", () => {
    assert.match(source, /if \(!logResult\.saved \|\| !logResult\.questionLogId\) \{\s*\n\s*return;/);
  });

  test("클라이언트가 보낸 franchise id를 알림에 쓰지 않는다", () => {
    assert.match(source, /escalateQuestionLogToStoreOwners\(createAdminClient\(\), \{\s*\n\s*questionLogId: logResult\.questionLogId,\s*\n\s*storeId,/);
    assert.equal(/franchiseId: (body|validation)/.test(source), false);
  });

  test("fire-and-forget이 아니라 응답 전에 await 한다", () => {
    assert.equal(/void escalateQuestionLogToStoreOwners/.test(source), false);
    assert.match(source, /const result = await escalateQuestionLogToStoreOwners\(/);
  });

  test("에스컬레이션 실패를 응답에 섞지 않는다", () => {
    assert.match(source, /console\.error\("\[RAG\] QUESTION_ESCALATION_FAILED", \{ status: result\.status \}\)/);
  });
});
