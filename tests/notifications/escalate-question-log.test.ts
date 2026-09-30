import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ESCALATION_NOTIFICATION_MESSAGE,
  ESCALATION_NOTIFICATION_TITLE,
  ESCALATION_NOTIFICATION_TYPE,
  escalateQuestionLogToStoreOwners,
} from "../../lib/notifications/escalate-question-log.ts";
import {
  LEGACY_ESCALATION_NOTICE,
  resolveNotificationClick,
  resolveNotificationHref,
} from "../../lib/notifications/notification-href.ts";

const LOG_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_LOG_ID = "22222222-2222-4222-8222-222222222222";
const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER_A = "owner-a";
const OWNER_A2 = "owner-a2";
const OWNER_B = "owner-b";

type QuestionLogRow = { id: string; status: string; store_id: string | null };
type MembershipRow = { user_id: string; store_id: string; role: string; status: string };
type NotificationRow = Record<string, unknown> & {
  recipient_user_id: string;
  type: string;
  related_id: string | null;
};

type FailurePoint = "question_logs" | "store_memberships" | "notifications_select" | "notifications_insert";

/**
 * 001의 question_logs, 006의 store_memberships, 013의 notifications와 022가 더한
 * partial unique index를 함께 흉내낸다. 실제 Supabase/OpenAI는 쓰지 않는다.
 */
function fakeClient(options: {
  logs?: QuestionLogRow[];
  memberships?: MembershipRow[];
  notifications?: NotificationRow[];
  failAt?: FailurePoint;
  throwAt?: FailurePoint;
} = {}) {
  const logs = options.logs ?? [
    { id: LOG_ID, status: "insufficient", store_id: STORE_A },
  ];
  const memberships = options.memberships ?? [
    { user_id: OWNER_A, store_id: STORE_A, role: "owner", status: "approved" },
    { user_id: OWNER_B, store_id: STORE_B, role: "owner", status: "approved" },
  ];
  const notifications: NotificationRow[] = (options.notifications ?? []).map((row) => ({ ...row }));
  const dbError = { code: "500", message: 'relation "x" does not exist: select * from question_logs' };

  const client = {
    from(table: string) {
      if (table === "question_logs") {
        if (options.throwAt === "question_logs") throw new Error("fetch failed");
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            const query = {
              eq(column: string, value: unknown) {
                filters[column] = value;
                return query;
              },
              maybeSingle: () =>
                options.failAt === "question_logs"
                  ? Promise.resolve({ data: null, error: dbError })
                  : Promise.resolve({
                      data: logs.find((row) => row.id === filters.id) ?? null,
                      error: null,
                    }),
            };
            return query;
          },
        };
      }

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
              then(resolve: (value: unknown) => unknown) {
                if (options.failAt === "store_memberships") {
                  return Promise.resolve({ data: null, error: dbError }).then(resolve);
                }
                const rows = memberships.filter(
                  (row) =>
                    row.store_id === filters.store_id
                    && row.role === filters.role
                    && row.status === filters.status,
                );
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
          const filters: Record<string, unknown> = {};
          let recipients: string[] = [];
          const query = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return query;
            },
            in(_column: string, values: string[]) {
              recipients = values;
              return query;
            },
            then(resolve: (value: unknown) => unknown) {
              if (options.failAt === "notifications_select") {
                return Promise.resolve({ data: null, error: dbError }).then(resolve);
              }
              const rows = notifications.filter(
                (row) =>
                  row.type === filters.type
                  && row.related_id === filters.related_id
                  && recipients.includes(row.recipient_user_id),
              );
              return Promise.resolve({
                data: rows.map(({ recipient_user_id }) => ({ recipient_user_id })),
                error: null,
              }).then(resolve);
            },
          };
          return query;
        },
        insert(payload: NotificationRow) {
          if (options.throwAt === "notifications_insert") throw new Error("fetch failed");
          if (options.failAt === "notifications_insert") {
            return Promise.resolve({ error: dbError });
          }
          // 022의 partial unique index: (recipient_user_id, related_id) where type = 에스컬레이션
          const duplicated = notifications.some(
            (row) =>
              row.type === ESCALATION_NOTIFICATION_TYPE
              && row.type === payload.type
              && row.related_id === payload.related_id
              && row.recipient_user_id === payload.recipient_user_id,
          );
          if (duplicated) {
            return Promise.resolve({
              error: { code: "23505", message: 'duplicate key value violates unique constraint' },
            });
          }
          notifications.push({ ...payload });
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, notifications };
}

describe("escalateQuestionLogToStoreOwners (실제 함수 실행)", () => {
  test("보류된 질문을 그 매장의 승인된 점주에게만 알린다", async () => {
    const { client, notifications } = fakeClient();
    const result = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    assert.equal(result.status, "notified");
    assert.deepEqual(result.status === "notified" ? result.notifiedOwnerIds : [], [OWNER_A]);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].recipient_user_id, OWNER_A);
  });

  test("같은 매장에 점주가 여러 명이면 모두에게 알린다", async () => {
    const { client, notifications } = fakeClient({
      memberships: [
        { user_id: OWNER_A, store_id: STORE_A, role: "owner", status: "approved" },
        { user_id: OWNER_A2, store_id: STORE_A, role: "owner", status: "approved" },
        { user_id: OWNER_B, store_id: STORE_B, role: "owner", status: "approved" },
      ],
    });
    const result = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    assert.deepEqual(result.status === "notified" ? result.notifiedOwnerIds.sort() : [], [OWNER_A, OWNER_A2]);
    assert.equal(notifications.every((row) => row.recipient_user_id !== OWNER_B), true);
  });

  test("다른 매장 점주에게는 알림이 가지 않는다", async () => {
    const { client, notifications } = fakeClient();
    await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    assert.equal(notifications.some((row) => row.recipient_user_id === OWNER_B), false);
  });

  test("승인되지 않은 점주(pending/rejected)는 제외한다", async () => {
    const { client } = fakeClient({
      memberships: [
        { user_id: OWNER_A, store_id: STORE_A, role: "owner", status: "pending" },
        { user_id: OWNER_A2, store_id: STORE_A, role: "owner", status: "rejected" },
      ],
    });
    const result = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    assert.equal(result.status, "no_recipient");
  });

  test("같은 매장의 직원(staff)에게는 알리지 않는다", async () => {
    const { client } = fakeClient({
      memberships: [{ user_id: "staff-a", store_id: STORE_A, role: "staff", status: "approved" }],
    });
    const result = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    assert.equal(result.status, "no_recipient");
  });

  test("점주가 없는 매장이면 알림을 만들지 않는다", async () => {
    const { client, notifications } = fakeClient({ memberships: [] });
    const result = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    assert.equal(result.status, "no_recipient");
    assert.equal(notifications.length, 0);
  });

  test("질문 로그의 매장과 검증된 매장이 다르면 알리지 않는다", async () => {
    const { client, notifications } = fakeClient();
    const result = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_B });

    assert.equal(result.status, "not_escalatable");
    assert.equal(result.status === "not_escalatable" ? result.reason : "", "store_mismatch");
    assert.equal(notifications.length, 0);
  });

  test("022 이전 행처럼 store_id가 NULL이면 알리지 않는다", async () => {
    const { client, notifications } = fakeClient({
      logs: [{ id: LOG_ID, status: "insufficient", store_id: null }],
    });
    const result = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    assert.equal(result.status === "not_escalatable" ? result.reason : "", "store_mismatch");
    assert.equal(notifications.length, 0);
  });

  test("보류가 아닌(answered/cautious) 질문은 에스컬레이션하지 않는다", async () => {
    for (const status of ["answered", "cautious"]) {
      const { client, notifications } = fakeClient({ logs: [{ id: LOG_ID, status, store_id: STORE_A }] });
      const result = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

      assert.equal(result.status === "not_escalatable" ? result.reason : "", "not_pending");
      assert.equal(notifications.length, 0);
    }
  });

  test("없는 질문 로그 id면 알리지 않는다", async () => {
    const { client, notifications } = fakeClient();
    const result = await escalateQuestionLogToStoreOwners(client, { questionLogId: OTHER_LOG_ID, storeId: STORE_A });

    assert.equal(result.status === "not_escalatable" ? result.reason : "", "log_not_found");
    assert.equal(notifications.length, 0);
  });
});

describe("중복 실행", () => {
  test("같은 질문 로그로 두 번 실행해도 알림은 한 번만 생긴다", async () => {
    const { client, notifications } = fakeClient();
    const first = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });
    const second = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    assert.deepEqual(first.status === "notified" ? first.notifiedOwnerIds : [], [OWNER_A]);
    assert.deepEqual(second.status === "notified" ? second.notifiedOwnerIds : [], []);
    assert.deepEqual(second.status === "notified" ? second.skippedOwnerIds : [], [OWNER_A]);
    assert.equal(notifications.length, 1);
  });

  test("이미 알림이 있는 점주는 건너뛰고 나머지 점주에게만 새로 보낸다", async () => {
    const { client, notifications } = fakeClient({
      memberships: [
        { user_id: OWNER_A, store_id: STORE_A, role: "owner", status: "approved" },
        { user_id: OWNER_A2, store_id: STORE_A, role: "owner", status: "approved" },
      ],
      notifications: [
        {
          recipient_user_id: OWNER_A,
          type: ESCALATION_NOTIFICATION_TYPE,
          related_id: LOG_ID,
        },
      ],
    });
    const result = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    assert.deepEqual(result.status === "notified" ? result.notifiedOwnerIds : [], [OWNER_A2]);
    assert.deepEqual(result.status === "notified" ? result.skippedOwnerIds : [], [OWNER_A]);
    assert.equal(notifications.length, 2);
  });

  test("동시 실행으로 unique index에 걸려도 실패가 아니라 '이미 보냄'으로 처리한다", async () => {
    const { client, notifications } = fakeClient({
      // 사전 조회에는 잡히지 않지만 insert 시점에는 존재하는 경쟁 상태를 흉내낸다.
      notifications: [
        { recipient_user_id: OWNER_A, type: ESCALATION_NOTIFICATION_TYPE, related_id: LOG_ID },
      ],
    });
    const result = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    assert.equal(result.status, "notified");
    assert.equal(notifications.length, 1);
  });

  test("다른 질문 로그는 같은 점주에게 따로 알림이 간다", async () => {
    const { client, notifications } = fakeClient({
      logs: [
        { id: LOG_ID, status: "insufficient", store_id: STORE_A },
        { id: OTHER_LOG_ID, status: "insufficient", store_id: STORE_A },
      ],
    });
    await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });
    await escalateQuestionLogToStoreOwners(client, { questionLogId: OTHER_LOG_ID, storeId: STORE_A });

    assert.equal(notifications.length, 2);
    assert.deepEqual(notifications.map((row) => row.related_id).sort(), [LOG_ID, OTHER_LOG_ID].sort());
  });
});

describe("실패 처리", () => {
  test("알림 저장이 실패하면 failed를 돌려주고 예외를 던지지 않는다", async () => {
    const { client } = fakeClient({ failAt: "notifications_insert" });
    const result = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    assert.equal(result.status, "failed");
  });

  for (const failAt of ["question_logs", "store_memberships", "notifications_select"] as const) {
    test(`${failAt} 조회 오류는 failed로 수렴한다`, async () => {
      const { client, notifications } = fakeClient({ failAt });
      const result = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

      assert.equal(result.status, "failed");
      assert.equal(notifications.length, 0);
    });
  }

  for (const throwAt of ["question_logs", "store_memberships", "notifications_insert"] as const) {
    test(`${throwAt}에서 예외가 나도 호출부로 던지지 않는다`, async () => {
      const { client } = fakeClient({ throwAt });
      const result = await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

      assert.equal(result.status, "failed");
    });
  }

  test("빈 인자는 조회 없이 막는다", async () => {
    const { client, notifications } = fakeClient();
    for (const input of [
      { questionLogId: "", storeId: STORE_A },
      { questionLogId: LOG_ID, storeId: "" },
    ]) {
      const result = await escalateQuestionLogToStoreOwners(client, input);
      assert.equal(result.status, "not_escalatable");
    }
    assert.equal(notifications.length, 0);
  });
});

describe("알림 내용 (질문 본문 비노출)", () => {
  test("제목·본문에 질문 내용이나 UUID를 담지 않는다", async () => {
    const { client, notifications } = fakeClient();
    await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    const serialized = `${notifications[0].title} ${notifications[0].message}`;
    for (const leak of [LOG_ID, STORE_A, OWNER_A, "환불", "similarity", "insufficient"]) {
      assert.equal(serialized.includes(leak), false, `leaks ${leak}`);
    }
    assert.equal(notifications[0].title, ESCALATION_NOTIFICATION_TITLE);
    assert.equal(notifications[0].message, ESCALATION_NOTIFICATION_MESSAGE);
    assert.equal(ESCALATION_NOTIFICATION_TITLE, "확인이 필요한 직원 질문이 있습니다");
  });

  test("target_url은 검증된 매장의 점주 질문 화면을 가리킨다", async () => {
    const { client, notifications } = fakeClient();
    await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    assert.equal(notifications[0].target_url, `/boss/questions?storeId=${STORE_A}`);
  });

  test("기존 013 notifications 컬럼만 사용한다", async () => {
    const { client, notifications } = fakeClient();
    await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    assert.deepEqual(Object.keys(notifications[0]).sort(), [
      "is_read",
      "message",
      "recipient_user_id",
      "related_id",
      "target_url",
      "title",
      "type",
    ]);
  });

  test("질문 로그는 related_id로만 잇는다", async () => {
    const { client, notifications } = fakeClient();
    await escalateQuestionLogToStoreOwners(client, { questionLogId: LOG_ID, storeId: STORE_A });

    assert.equal(notifications[0].related_id, LOG_ID);
    assert.equal(notifications[0].type, ESCALATION_NOTIFICATION_TYPE);
    assert.equal(notifications[0].is_read, false);
  });
});

describe("resolveNotificationHref (related_id 강조 링크)", () => {
  test("에스컬레이션 알림은 매장 링크를 유지하고 질문 로그 id를 덧붙인다", () => {
    const href = resolveNotificationHref({
      type: ESCALATION_NOTIFICATION_TYPE,
      targetUrl: `/boss/questions?storeId=${STORE_A}`,
      relatedId: LOG_ID,
    });

    assert.equal(href, `/boss/questions?storeId=${STORE_A}&questionId=${LOG_ID}`);
  });

  test("과거 target_url=null 알림은 이동하지 않는다", () => {
    assert.equal(
      resolveNotificationHref({ type: ESCALATION_NOTIFICATION_TYPE, targetUrl: null, relatedId: LOG_ID }),
      null,
    );
  });

  test("다른 알림 유형이나 다른 경로·외부 주소는 그대로 둔다", () => {
    assert.equal(
      resolveNotificationHref({ type: "notice", targetUrl: "/boss/notices", relatedId: LOG_ID }),
      "/boss/notices",
    );
    assert.equal(
      resolveNotificationHref({ type: ESCALATION_NOTIFICATION_TYPE, targetUrl: "/boss/notices", relatedId: LOG_ID }),
      "/boss/notices",
    );
    assert.equal(
      resolveNotificationHref({
        type: ESCALATION_NOTIFICATION_TYPE,
        targetUrl: "https://example.com/boss/questions",
        relatedId: LOG_ID,
      }),
      "https://example.com/boss/questions",
    );
  });
});

describe("resolveNotificationClick (알림 클릭 동작)", () => {
  test("링크가 없거나 빈 과거 에스컬레이션 알림은 이동하지 않고 메뉴 안내를 보여 준다", () => {
    for (const targetUrl of [null, undefined, "", "   "]) {
      assert.deepEqual(
        resolveNotificationClick({ type: ESCALATION_NOTIFICATION_TYPE, targetUrl, relatedId: LOG_ID }),
        { kind: "notice", message: LEGACY_ESCALATION_NOTICE },
        String(targetUrl),
      );
    }
    assert.equal(LEGACY_ESCALATION_NOTICE, "이전 알림입니다. 보류 질문 메뉴에서 확인해 주세요.");
  });

  test("안내에 related_id나 추측한 매장 링크를 담지 않는다", () => {
    const action = resolveNotificationClick({ type: ESCALATION_NOTIFICATION_TYPE, targetUrl: null, relatedId: LOG_ID });
    assert.equal(JSON.stringify(action).includes(LOG_ID), false);
    assert.equal("href" in action, false);
  });

  test("새 에스컬레이션 알림은 질문 강조 링크로 이동한다", () => {
    assert.deepEqual(
      resolveNotificationClick({
        type: ESCALATION_NOTIFICATION_TYPE,
        targetUrl: `/boss/questions?storeId=${STORE_A}`,
        relatedId: LOG_ID,
      }),
      { kind: "navigate", href: `/boss/questions?storeId=${STORE_A}&questionId=${LOG_ID}` },
    );
  });

  test("다른 유형의 알림은 기존처럼 링크가 있으면 이동, 없으면 아무것도 하지 않는다", () => {
    assert.deepEqual(
      resolveNotificationClick({ type: "owner_pending_approval", targetUrl: "/hq/approvals", relatedId: LOG_ID }),
      { kind: "navigate", href: "/hq/approvals" },
    );
    for (const targetUrl of [null, undefined, ""]) {
      assert.deepEqual(
        resolveNotificationClick({ type: "approval_decision", targetUrl, relatedId: null }),
        { kind: "none" },
      );
    }
  });

  test("NotificationCenter는 읽음 처리 뒤 같은 판정 함수를 쓴다", () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../components/common/NotificationCenter.tsx"),
      "utf8",
    );
    const markRead = source.indexOf("/mark-read");
    const resolve = source.indexOf("resolveNotificationClick(notification)");
    assert.ok(markRead > 0 && resolve > markRead);
    assert.match(source, /action\.kind === "notice"[\s\S]*setToastMessage\(action\.message\)/);
    assert.match(source, /role="status"/);
  });
});

describe("022_question_log_store_escalation.sql (DB 계약)", () => {
  const migration = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../supabase/migrations/022_question_log_store_escalation.sql",
    ),
    "utf8",
  ).replace(/\r\n/g, "\n");

  test("question_logs.store_id를 nullable로 추가하고 백필하지 않는다", () => {
    assert.match(migration, /alter table public\.question_logs\s*\n\s*add column if not exists store_id uuid;/);
    assert.equal(/add column if not exists store_id uuid not null/.test(migration), false);
    assert.equal(/alter column store_id set not null/.test(migration), false);
    assert.equal(/\bupdate public\.question_logs\b/i.test(migration), false);
  });

  test("기존 데이터를 지우지 않는다", () => {
    assert.equal(/\bdelete\s+from\b|\bdrop\s+table\b|\btruncate\b/i.test(migration), false);
  });

  test("매장을 지워도 질문 이력이 사라지지 않도록 on delete set null을 쓴다", () => {
    assert.match(
      migration,
      /foreign key \(store_id\) references public\.stores\(id\) on delete set null/,
    );
  });

  test("중복 알림은 이 type에 한정된 partial unique index로 막는다", () => {
    assert.match(
      migration,
      /create unique index notifications_manual_question_escalation_idx\s*\n\s*on public\.notifications \(recipient_user_id, related_id\)\s*\n\s*where type = 'manual_question_escalation' and related_id is not null;/,
    );
  });

  test("선행 테이블이 없으면 조용히 건너뛰지 않고 raise한다", () => {
    for (const table of ["question_logs", "stores", "notifications"]) {
      assert.match(
        migration,
        new RegExp(`if to_regclass\\('public\\.${table}'\\) is null then\\s*\\n\\s*raise exception`),
        `${table} 누락이 조용히 통과된다`,
      );
    }
  });

  test("stores 존재 여부로 FK를 건너뛰는 경로가 남아 있지 않다", () => {
    assert.equal(/to_regclass\('public\.stores'\) is not null\s*\n?\s*and/.test(migration), false);
  });

  test("이미 있는 구조가 기대와 다르면 raise한다", () => {
    // 컬럼 타입 / FK 삭제 동작 / 인덱스 unique 여부를 각각 확인한다.
    assert.match(migration, /store_id must be uuid but found/);
    assert.match(migration, /confdeltype = 'n'/);
    assert.match(migration, /position\('UNIQUE INDEX' in index_definition\) = 0/);
  });

  test("인덱스 생성 전 중복 행은 자동 삭제하지 않고 안내와 함께 실패한다", () => {
    assert.match(migration, /having count\(\*\) > 1/);
    assert.match(migration, /never deletes notification rows/);
    assert.equal(/\bdelete\s+from\s+public\.notifications\b/i.test(migration), false);
  });

  test("기존 notifications/question_logs 컬럼과 다른 알림 유형을 건드리지 않는다", () => {
    assert.equal(/alter table public\.notifications\s+(drop|alter)/i.test(migration), false);
    for (const existingType of [
      "staff_pending_approval",
      "owner_pending_approval",
      "approval_decision",
      "new_notice",
      "manual_update",
    ]) {
      assert.equal(
        new RegExp(`where type = '${existingType}'`).test(migration),
        false,
        `touches ${existingType}`,
      );
    }
  });

  test("020의 manual_upload_batches를 참조하거나 수정하지 않는다", () => {
    const statements = migration.replace(/--[^\n]*/g, "");
    assert.equal(/manual_upload_batches/.test(statements), false);
  });

  test("재실행해도 안전하도록 if not exists / pg_constraint 확인으로 감싼다", () => {
    assert.match(migration, /add column if not exists/);
    assert.match(migration, /create index if not exists/);
    assert.match(migration, /select 1 from pg_constraint/);
  });

  test("코드와 같은 알림 type 문자열을 쓴다", () => {
    assert.equal(ESCALATION_NOTIFICATION_TYPE, "manual_question_escalation");
    assert.match(migration, new RegExp(`'${ESCALATION_NOTIFICATION_TYPE}'`));
  });
});
