import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ESCALATION_NOTIFICATION_TYPE } from "../../lib/notifications/escalate-question-log.ts";
import { isEscalationPopupCandidate } from "../../lib/notifications/escalation-popup.ts";
import { resolveNotificationClick } from "../../lib/notifications/notification-href.ts";
import {
  REPEATED_QUESTION_NOTIFICATION_TITLE,
  REPEATED_QUESTION_NOTIFICATION_TYPE,
  createQuestionLogFollowUp,
  notifyRepeatedQuestion,
} from "../../lib/notifications/notify-repeated-question.ts";
import { fetchRepeatedQuestionAlertForOwner } from "../../lib/owner/repeated-question-alerts.ts";
import { normalizeRepeatedQuestionKey } from "../../lib/owner/repeated-questions.ts";
import { finalizeRagQueryResponse } from "../../lib/rag/finalize-rag-query-response.ts";
import type { RagStatus } from "../../lib/rag/types.ts";

const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BRAND_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BRAND_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_A2 = "12121212-1212-4121-8121-121212121212";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const STAFF_A = "33333333-3333-4333-8333-333333333333";
const HQ_B = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-09-28T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

type Row = Record<string, unknown>;

type FakeOptions = {
  memberships?: Row[];
  now?: () => Date;
  failNotificationInsert?: boolean;
  /** 여기에 든 수신자에 대한 notifications insert만 실패한다(테스트 중 비워 복구를 흉낸다). */
  failInsertFor?: Set<string>;
  missingClaimRpc?: boolean;
};

/** 001/022/031의 question_logs, 013 notifications(+022/032 unique), 032 repeated_question_alerts·claim RPC 흉내. */
function createFake(options: FakeOptions = {}) {
  const now = options.now ?? (() => NOW);
  const tables: Record<string, Row[]> = {
    question_logs: [],
    notifications: [],
    repeated_question_alerts: [],
    store_memberships: options.memberships ?? [
      { user_id: OWNER_A, store_id: STORE_A, role: "owner", status: "approved" },
      { user_id: OWNER_B, store_id: STORE_B, role: "owner", status: "approved" },
      { user_id: STAFF_A, store_id: STORE_A, role: "staff", status: "approved" },
      { user_id: HQ_B, store_id: STORE_B, role: "hq", status: "approved" },
    ],
    stores: [
      { id: STORE_A, franchise_id: BRAND_A },
      { id: STORE_B, franchise_id: BRAND_B },
    ],
    franchises: [
      { id: BRAND_A, name: "브랜드A" },
      { id: BRAND_B, name: "브랜드B" },
    ],
  };
  let sequence = 0;
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  const uniqueTypes = new Set([ESCALATION_NOTIFICATION_TYPE, REPEATED_QUESTION_NOTIFICATION_TYPE]);

  const client = {
    from(table: string) {
      if (!tables[table]) throw new Error(`Unexpected table: ${table}`);
      return {
        select(_columns?: string, selectOptions?: { count?: string; head?: boolean }) {
          const eqs: Row = {};
          const ins: Record<string, unknown[]> = {};
          let gte: string | null = null;
          let lte: string | null = null;
          const rows = () =>
            tables[table].filter((row) =>
              Object.entries(eqs).every(([k, v]) => row[k] === v)
              && Object.entries(ins).every(([k, vals]) => vals.includes(row[k]))
              && (gte === null || String(row.created_at) >= gte)
              && (lte === null || String(row.created_at) <= lte));
          const query = {
            eq(column: string, value: unknown) { eqs[column] = value; return query; },
            in(column: string, values: unknown[]) { ins[column] = values; return query; },
            gte(_column: string, value: string) { gte = value; return query; },
            lte(_column: string, value: string) { lte = value; return query; },
            order() { return query; },
            async range(from: number, to: number) {
              await tick();
              const sorted = [...rows()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
              return { data: sorted.slice(from, to + 1).map((r) => ({ ...r })), error: null };
            },
            async maybeSingle() {
              await tick();
              const found = rows()[0];
              return { data: found ? { ...found } : null, error: null };
            },
            then(resolve: (value: unknown) => unknown) {
              if (selectOptions?.count) {
                return tick().then(() => resolve({ data: null, count: rows().length, error: null }));
              }
              return tick().then(() => resolve({ data: rows().map((r) => ({ ...r })), error: null }));
            },
          };
          return query;
        },
        insert(payload: Row) {
          return {
            then(resolve: (value: unknown) => unknown) {
              return tick().then(() => {
                if (table === "notifications" && options.failNotificationInsert) {
                  return resolve({ error: { code: "XX000", message: "insert failed" } });
                }
                if (table === "notifications" && options.failInsertFor?.has(String(payload.recipient_user_id))) {
                  return resolve({ error: { code: "XX000", message: "insert failed" } });
                }
                if (table === "notifications" && uniqueTypes.has(String(payload.type))) {
                  const duplicate = tables.notifications.some((row) =>
                    row.type === payload.type
                    && row.recipient_user_id === payload.recipient_user_id
                    && row.related_id === payload.related_id);
                  if (duplicate) return resolve({ error: { code: "23505", message: "duplicate key" } });
                }
                tables[table].push({ id: `${table}-${++sequence}`, created_at: now().toISOString(), ...payload });
                return resolve({ error: null });
              });
            },
          };
        },
      };
    },
    async rpc(name: string, params: Row) {
      await tick();
      if (options.missingClaimRpc || name !== "claim_repeated_question_alert") {
        return { data: null, error: { code: "PGRST202", message: "function not found" } };
      }
      // advisory lock 구간: 확인과 생성 사이에 await가 없어 동시 호출도 회차를 하나만 만든다.
      const cutoff = now().getTime() - Number(params.p_window_days) * DAY;
      const existing = tables.repeated_question_alerts
        .filter((row) =>
          row.store_id === params.p_store_id
          && row.group_key === params.p_group_key
          && new Date(String(row.alerted_at)).getTime() > cutoff)
        .sort((a, b) => String(b.alerted_at).localeCompare(String(a.alerted_at)))[0];
      if (existing) return { data: [{ alert_id: existing.id, claimed: false }], error: null };

      const id = `alert-${++sequence}`;
      tables.repeated_question_alerts.push({
        id,
        store_id: params.p_store_id,
        group_key: params.p_group_key,
        representative_question: params.p_representative_question,
        repeat_count: params.p_repeat_count,
        answered_count: params.p_answered_count,
        cautious_count: params.p_cautious_count,
        insufficient_count: params.p_insufficient_count,
        category: params.p_category,
        window_days: params.p_window_days,
        window_start: params.p_window_start,
        window_end: params.p_window_end,
        alerted_at: now().toISOString(),
      });
      return { data: [{ alert_id: id, claimed: true }], error: null };
    },
  } as unknown as SupabaseClient;

  function addLog(question: string, overrides: { storeId?: string; status?: RagStatus; daysAgo?: number } = {}): string {
    const id = `log-${++sequence}`;
    tables.question_logs.push({
      id,
      question,
      answer: "answer",
      status: overrides.status ?? "answered",
      store_id: overrides.storeId ?? STORE_A,
      source_manual_id: null,
      resolution_status: "open",
      created_at: new Date(now().getTime() - (overrides.daysAgo ?? 0.01) * DAY).toISOString(),
    });
    return id;
  }

  const repeatedNotifications = () =>
    tables.notifications.filter((row) => row.type === REPEATED_QUESTION_NOTIFICATION_TYPE);
  const escalationNotifications = () =>
    tables.notifications.filter((row) => row.type === ESCALATION_NOTIFICATION_TYPE);

  return { client, tables, addLog, repeatedNotifications, escalationNotifications };
}

const ask = (fake: ReturnType<typeof createFake>, logId: string, storeId = STORE_A) =>
  notifyRepeatedQuestion(fake.client, { questionLogId: logId, storeId, now: NOW });

describe("반복 질문 알림 (가짜 저장소·알림 client, 고정 시각으로 실제 함수 실행)", () => {
  test("A. 같은 질문 1·2건이면 반복 알림이 없다", async () => {
    const fake = createFake();
    assert.equal((await ask(fake, fake.addLog("환불 규정 알려주세요"))).status, "below_threshold");
    assert.equal((await ask(fake, fake.addLog("환불 규정 알려주세요"))).status, "below_threshold");
    assert.equal(fake.repeatedNotifications().length, 0);
    assert.equal(fake.tables.repeated_question_alerts.length, 0);
  });

  test("B. 같은 매장 3건이면 그 매장 승인 점주에게만 반복 알림 1건을 만든다", async () => {
    const fake = createFake();
    fake.addLog("환불 규정 알려주세요");
    fake.addLog("환불 규정 알려주세요");
    const result = await ask(fake, fake.addLog("환불 규정 알려주세요"));

    assert.equal(result.status, "notified");
    assert.equal(result.status === "notified" && result.claimed, true);
    assert.equal(result.status === "notified" && result.repeatCount, 3);
    const sent = fake.repeatedNotifications();
    assert.deepEqual(sent.map((row) => row.recipient_user_id), [OWNER_A]);
    assert.equal(sent[0].title, REPEATED_QUESTION_NOTIFICATION_TITLE);
    assert.equal(String(sent[0].message).includes("환불"), false, "질문 원문을 알림 문구에 담지 않는다");
    for (const forbidden of [OWNER_B, STAFF_A, HQ_B]) {
      assert.equal(fake.tables.notifications.some((row) => row.recipient_user_id === forbidden), false);
    }
  });

  test("C. 공백·문장부호·대소문자·끝 어미 차이는 기존 정규화 계약대로 같은 질문으로 집계한다", async () => {
    const fake = createFake();
    fake.addLog("POS 환불 규정 알려주세요");
    fake.addLog("  pos 환불규정?? ");
    const result = await ask(fake, fake.addLog("Pos  환불 규정 알려줘."));

    assert.equal(result.status === "notified" && result.repeatCount, 3);
  });

  test("D. 의미만 비슷한 질문(동의어·어순 변경)은 지원 범위 밖이며 합치지 않는다", async () => {
    const fake = createFake();
    fake.addLog("환불 규정 알려주세요");
    fake.addLog("환불 규정 알려주세요");
    const synonym = fake.addLog("반품 규정 알려주세요");
    const reordered = fake.addLog("규정 환불 알려주세요");

    assert.notEqual(normalizeRepeatedQuestionKey("환불 규정"), normalizeRepeatedQuestionKey("반품 규정"));
    assert.notEqual(normalizeRepeatedQuestionKey("환불 규정"), normalizeRepeatedQuestionKey("규정 환불"));
    assert.equal((await ask(fake, synonym)).status, "below_threshold");
    assert.equal((await ask(fake, reordered)).status, "below_threshold");
    assert.equal(fake.repeatedNotifications().length, 0);
  });

  test("E. 다른 매장의 같은 질문 각 2건은 합산하지 않는다", async () => {
    const fake = createFake();
    fake.addLog("마감 순서", { storeId: STORE_A });
    fake.addLog("마감 순서", { storeId: STORE_B });
    const lastA = fake.addLog("마감 순서", { storeId: STORE_A });
    const lastB = fake.addLog("마감 순서", { storeId: STORE_B });

    assert.equal((await ask(fake, lastA, STORE_A)).status, "below_threshold");
    assert.equal((await ask(fake, lastB, STORE_B)).status, "below_threshold");
    // 검증된 매장과 로그 매장이 다르면 집계 자체를 하지 않는다.
    assert.deepEqual(await ask(fake, lastB, STORE_A), { status: "not_applicable", reason: "store_mismatch" });
    assert.equal(fake.repeatedNotifications().length, 0);
  });

  test("F. 7일보다 오래된 질문은 집계에서 제외한다", async () => {
    const fake = createFake();
    fake.addLog("마감 순서", { daysAgo: 8 });
    fake.addLog("마감 순서", { daysAgo: 7.5 });
    fake.addLog("마감 순서", { daysAgo: 3 });

    assert.equal((await ask(fake, fake.addLog("마감 순서"))).status, "below_threshold");
  });

  test("G. answered/cautious 반복도 반복 알림 대상이고, RAG status를 보류로 바꾸지 않는다", async () => {
    // createQuestionLogFollowUp은 실제 시각을 쓰므로 가짜 저장소도 같은 시계를 쓴다.
    const fake = createFake({ now: () => new Date() });
    const followUp = createQuestionLogFollowUp({ storeId: STORE_A, escalate: false, getClient: () => fake.client });
    const ids = [
      fake.addLog("마감 순서", { status: "answered" }),
      fake.addLog("마감 순서", { status: "cautious" }),
      fake.addLog("마감 순서", { status: "answered" }),
    ];
    for (const id of ids) await followUp({ saved: true, questionLogId: id });

    assert.equal(fake.repeatedNotifications().length, 1);
    assert.equal(fake.escalationNotifications().length, 0, "답변 가능한 질문은 보류 알림 대상이 아니다");
    assert.deepEqual(fake.tables.question_logs.map((row) => row.status), ["answered", "cautious", "answered"]);
    assert.equal(fake.tables.repeated_question_alerts[0].category, "guidance_gap_candidate");
  });

  test("H. insufficient 반복은 단건 보류 알림과 반복 알림을 각각 유지한다", async () => {
    const fake = createFake({ now: () => new Date() });
    const followUp = createQuestionLogFollowUp({ storeId: STORE_A, escalate: true, getClient: () => fake.client });
    for (let i = 0; i < 3; i += 1) {
      await followUp({ saved: true, questionLogId: fake.addLog("포스 오류 대처", { status: "insufficient" }) });
    }

    assert.equal(fake.escalationNotifications().length, 3, "질문 로그마다 단건 보류 알림");
    assert.equal(fake.repeatedNotifications().length, 1, "그룹 단위 반복 알림 1건");
    assert.equal(fake.tables.repeated_question_alerts[0].category, "manual_gap_candidate");
    assert.ok(fake.tables.question_logs.every((row) => row.status === "insufficient" && row.resolution_status === "open"));
  });

  test("I. 4·5번째 질문과 탐지 재시도는 반복 알림을 추가하지 않는다", async () => {
    const fake = createFake();
    fake.addLog("마감 순서");
    fake.addLog("마감 순서");
    const third = fake.addLog("마감 순서");
    await ask(fake, third);

    const fourth = await ask(fake, fake.addLog("마감 순서"));
    const fifth = await ask(fake, fake.addLog("마감 순서"));
    const retry = await ask(fake, third);

    for (const result of [fourth, fifth, retry]) {
      assert.equal(result.status, "notified");
      assert.equal(result.status === "notified" && result.claimed, false);
      assert.deepEqual(result.status === "notified" && result.notifiedOwnerIds, []);
    }
    assert.equal(fake.repeatedNotifications().length, 1);
    assert.equal(fake.tables.repeated_question_alerts.length, 1);
  });

  test("I-2. 7일 재발송 억제가 끝난 뒤 다시 3건이 쌓이면 새 회차로 한 번 더 알린다", async () => {
    let clock = NOW;
    const fake = createFake({ now: () => clock });
    for (let i = 0; i < 3; i += 1) fake.addLog("마감 순서");
    await notifyRepeatedQuestion(fake.client, { questionLogId: fake.tables.question_logs[2].id as string, storeId: STORE_A, now: clock });

    clock = new Date(NOW.getTime() + 8 * DAY);
    for (let i = 0; i < 2; i += 1) fake.addLog("마감 순서");
    const last = fake.addLog("마감 순서");
    const result = await notifyRepeatedQuestion(fake.client, { questionLogId: last, storeId: STORE_A, now: clock });

    assert.equal(result.status === "notified" && result.claimed, true);
    assert.equal(fake.repeatedNotifications().length, 2);
  });

  test("J. 동시에 임계점에 도달해도 회차 1개, 수신자별 알림 1건만 생긴다", async () => {
    const fake = createFake({
      memberships: [
        { user_id: OWNER_A, store_id: STORE_A, role: "owner", status: "approved" },
        { user_id: OWNER_A2, store_id: STORE_A, role: "owner", status: "approved" },
      ],
    });
    fake.addLog("마감 순서");
    fake.addLog("마감 순서");
    const third = fake.addLog("마감 순서");
    const fourth = fake.addLog("마감 순서");

    const results = await Promise.all([ask(fake, third), ask(fake, fourth), ask(fake, third)]);

    assert.ok(results.every((result) => result.status === "notified"));
    assert.equal(fake.tables.repeated_question_alerts.length, 1);
    const recipients = fake.repeatedNotifications().map((row) => row.recipient_user_id).sort();
    assert.deepEqual(recipients, [OWNER_A, OWNER_A2].sort());
  });

  test("K. 승인 점주 없음·알림 실패·032 미적용이어도 직원 답변은 그대로다", async () => {
    const scenarios: Array<{ name: string; fake: ReturnType<typeof createFake>; expected: string }> = [
      { name: "no owner", fake: createFake({ memberships: [], now: () => new Date() }), expected: "no_recipient" },
      { name: "insert fail", fake: createFake({ failNotificationInsert: true, now: () => new Date() }), expected: "failed" },
      { name: "rpc missing", fake: createFake({ missingClaimRpc: true, now: () => new Date() }), expected: "failed" },
    ];

    for (const { name, fake, expected } of scenarios) {
      fake.addLog("마감 순서");
      fake.addLog("마감 순서");
      const ragResponse = { answer: "매뉴얼 답변", similarity: 0.8, source: null, status: "answered" as const, matches: [] };
      let savedId = "";

      const returned = await finalizeRagQueryResponse(
        {
          httpStatus: 200,
          question: "마감 순서",
          storeId: STORE_A,
          response: ragResponse,
          afterQuestionLogSaved: createQuestionLogFollowUp({ storeId: STORE_A, escalate: false, getClient: () => fake.client }),
        },
        async () => {
          savedId = fake.addLog("마감 순서");
          return { saved: true, questionLogId: savedId };
        },
      );

      assert.strictEqual(returned, ragResponse, name);
      assert.equal((await notifyRepeatedQuestion(fake.client, { questionLogId: savedId, storeId: STORE_A })).status, expected, name);
      assert.equal(fake.repeatedNotifications().length, 0, name);
    }

    const throwing = await finalizeRagQueryResponse(
      {
        httpStatus: 200,
        question: "q",
        storeId: STORE_A,
        response: { answer: "a", similarity: 0.8, source: null, status: "answered", matches: [] },
        afterQuestionLogSaved: createQuestionLogFollowUp({
          storeId: STORE_A,
          escalate: true,
          getClient: () => { throw new Error("Missing Supabase admin environment variables"); },
        }),
      },
      async () => ({ saved: true, questionLogId: "log-x" }),
    );
    assert.equal("answer" in throwing && throwing.answer, "a");
  });
});

describe("반복 질문 알림 조회 권한과 이동 경로", () => {
  async function seedAlert() {
    const fake = createFake();
    for (let i = 0; i < 2; i += 1) fake.addLog("마감 순서", { status: "answered" });
    const result = await ask(fake, fake.addLog("마감 순서", { status: "insufficient" }));
    assert.equal(result.status, "notified");
    return { fake, alertId: result.status === "notified" ? result.alertId : "" };
  }

  test("L. 타 매장 점주·직원·HQ는 반복 질문 정보를 조회할 수 없다", async () => {
    const { fake, alertId } = await seedAlert();

    const otherOwner = await fetchRepeatedQuestionAlertForOwner(fake.client, { userId: OWNER_B, storeId: STORE_A, alertId });
    assert.equal(otherOwner.status, 403);

    const ownStoreOtherAlert = await fetchRepeatedQuestionAlertForOwner(fake.client, { userId: OWNER_B, storeId: STORE_B, alertId });
    assert.equal(ownStoreOtherAlert.status, 404);

    for (const userId of [STAFF_A, HQ_B]) {
      const denied = await fetchRepeatedQuestionAlertForOwner(fake.client, { userId, storeId: STORE_A, alertId });
      assert.equal(denied.status, 403);
    }
    for (const denied of [otherOwner, ownStoreOtherAlert]) {
      assert.equal(JSON.stringify(denied).includes("마감"), false);
    }
  });

  test("M. 알림 클릭 경로로 올바른 매장의 반복 횟수·기간·대표 질문·분류를 확인한다", async () => {
    const { fake, alertId } = await seedAlert();
    const notification = fake.repeatedNotifications()[0];

    const action = resolveNotificationClick({
      type: String(notification.type),
      targetUrl: String(notification.target_url),
      relatedId: String(notification.related_id),
    });
    assert.equal(action.kind, "navigate");
    const href = action.kind === "navigate" ? action.href : "";
    const url = new URL(href, "http://local.invalid");
    assert.equal(url.pathname, "/boss/questions/repeated");
    assert.equal(url.searchParams.get("storeId"), STORE_A);
    assert.equal(url.searchParams.get("alertId"), alertId);

    const result = await fetchRepeatedQuestionAlertForOwner(fake.client, {
      userId: OWNER_A,
      storeId: url.searchParams.get("storeId"),
      alertId: url.searchParams.get("alertId"),
    });
    assert.equal(result.status, 200);
    const alert = result.status === 200 ? result.body.data.alert : null;
    assert.equal(alert?.storeId, STORE_A);
    assert.equal(alert?.repeatCount, 3);
    assert.equal(alert?.windowDays, 7);
    assert.equal(alert?.representativeQuestion, "마감 순서");
    assert.equal(alert?.category, "mixed_candidate");
    assert.deepEqual(alert?.statusCounts, { answered: 2, cautious: 0, insufficient: 1 });

    // 반복 알림은 보류 질문 중앙 팝업 대상이 아니다(기존 팝업 동작 유지).
    assert.equal(
      isEscalationPopupCandidate({ id: "n1", type: String(notification.type), isRead: false, createdAt: NOW.toISOString() }),
      false,
    );
    assert.equal(alert?.analysisLimited, false);
  });

  test("4·5번째 질문 뒤에도 화면 값은 발송 당시 스냅샷(3회)이다", async () => {
    const { fake, alertId } = await seedAlert();
    await ask(fake, fake.addLog("마감 순서", { status: "answered" }));
    await ask(fake, fake.addLog("마감 순서", { status: "answered" }));

    const result = await fetchRepeatedQuestionAlertForOwner(fake.client, { userId: OWNER_A, storeId: STORE_A, alertId });
    const alert = result.status === 200 ? result.body.data.alert : null;
    assert.equal(alert?.repeatCount, 3);
    assert.deepEqual(alert?.statusCounts, { answered: 2, cautious: 0, insufficient: 1 });
    assert.equal(fake.repeatedNotifications().length, 1);
  });

  test("집계 기간 로그가 분석 상한(10,000건)을 넘으면 전체 집계가 아니라고 표시한다", async () => {
    const { fake, alertId } = await seedAlert();
    const alertRow = fake.tables.repeated_question_alerts[0];
    for (let i = 0; i < 10_001; i += 1) {
      fake.tables.question_logs.push({ id: `bulk-${i}`, store_id: STORE_A, status: "answered", question: `q${i}`, created_at: String(alertRow.window_end) });
    }

    const result = await fetchRepeatedQuestionAlertForOwner(fake.client, { userId: OWNER_A, storeId: STORE_A, alertId });
    assert.equal(result.status === 200 && result.body.data.alert.analysisLimited, true);
  });
});

describe("반복 알림 실패 복구와 재시도 계약 (가짜 client — 실제 PostgreSQL 잠금 검증 아님)", () => {
  const twoOwners = [
    { user_id: OWNER_A, store_id: STORE_A, role: "owner", status: "approved" },
    { user_id: OWNER_A2, store_id: STORE_A, role: "owner", status: "approved" },
  ];

  test("claim 후 알림 저장이 모두 실패해도 회차가 발송을 막지 않고, 다음 같은 질문에서 복구된다", async () => {
    const failInsertFor = new Set([OWNER_A]);
    const fake = createFake({ failInsertFor });
    fake.addLog("마감 순서");
    fake.addLog("마감 순서");

    const first = await ask(fake, fake.addLog("마감 순서"));
    assert.equal(first.status, "failed");
    assert.equal(fake.tables.repeated_question_alerts.length, 1, "회차는 이미 열렸다");
    assert.equal(fake.repeatedNotifications().length, 0);

    failInsertFor.clear();
    const recovered = await ask(fake, fake.addLog("마감 순서"));
    assert.equal(recovered.status, "notified");
    assert.equal(recovered.status === "notified" && recovered.claimed, false);
    assert.deepEqual(recovered.status === "notified" && recovered.notifiedOwnerIds, [OWNER_A]);
    assert.equal(fake.tables.repeated_question_alerts.length, 1);
  });

  test("일부 점주만 성공하면 실패한 점주에게만 재시도하고 성공한 점주에게는 중복 발송하지 않는다", async () => {
    const failInsertFor = new Set([OWNER_A]);
    const fake = createFake({ memberships: twoOwners, failInsertFor });
    fake.addLog("마감 순서");
    fake.addLog("마감 순서");

    const first = await ask(fake, fake.addLog("마감 순서"));
    assert.equal(first.status, "failed");
    assert.deepEqual(first.status === "failed" && first.notifiedOwnerIds, [OWNER_A2], "앞 수신자 실패가 뒤 수신자 발송을 막지 않는다");
    assert.deepEqual(first.status === "failed" && first.failedOwnerIds, [OWNER_A]);

    failInsertFor.clear();
    const retry = await ask(fake, fake.addLog("마감 순서"));
    assert.deepEqual(retry.status === "notified" && retry.notifiedOwnerIds, [OWNER_A]);
    assert.deepEqual(retry.status === "notified" && retry.skippedOwnerIds, [OWNER_A2]);

    const perOwner = fake.repeatedNotifications().map((row) => row.recipient_user_id).sort();
    assert.deepEqual(perOwner, [OWNER_A, OWNER_A2].sort());
  });

  test("실패 뒤 동시 재시도도 수신자별 1건만 남긴다", async () => {
    const failInsertFor = new Set([OWNER_A, OWNER_A2]);
    const fake = createFake({ memberships: twoOwners, failInsertFor });
    fake.addLog("마감 순서");
    fake.addLog("마감 순서");
    await ask(fake, fake.addLog("마감 순서"));

    failInsertFor.clear();
    const fourth = fake.addLog("마감 순서");
    const fifth = fake.addLog("마감 순서");
    await Promise.all([ask(fake, fourth), ask(fake, fifth), ask(fake, fourth)]);

    const perOwner = fake.repeatedNotifications().map((row) => row.recipient_user_id).sort();
    assert.deepEqual(perOwner, [OWNER_A, OWNER_A2].sort());
    assert.equal(fake.tables.repeated_question_alerts.length, 1);
  });

  test("승인 점주가 없으면 회차를 열지 않아, 점주 승인 뒤 다음 같은 질문에서 정상 발송된다", async () => {
    const fake = createFake({ memberships: [] });
    fake.addLog("마감 순서");
    fake.addLog("마감 순서");
    assert.equal((await ask(fake, fake.addLog("마감 순서"))).status, "no_recipient");
    assert.equal(fake.tables.repeated_question_alerts.length, 0);

    fake.tables.store_memberships.push({ user_id: OWNER_A, store_id: STORE_A, role: "owner", status: "approved" });
    const result = await ask(fake, fake.addLog("마감 순서"));
    assert.equal(result.status === "notified" && result.claimed, true);
    assert.equal(fake.repeatedNotifications().length, 1);
  });

  test("한계: 실패 뒤 같은 그룹 질문이 다시 오지 않으면 자동 재시도는 없다", async () => {
    const failInsertFor = new Set([OWNER_A]);
    const fake = createFake({ failInsertFor });
    fake.addLog("마감 순서");
    fake.addLog("마감 순서");
    await ask(fake, fake.addLog("마감 순서"));

    failInsertFor.clear();
    await ask(fake, fake.addLog("다른 질문"));
    assert.equal(fake.repeatedNotifications().length, 0);
  });
});

describe("기간·임계값·재발송 경계 (가짜 client의 claim은 032 SQL과 같은 비교식을 흉내낸다)", () => {
  test("정확히 7일 전 질문은 포함하고, 7일+1ms 전 질문은 제외한다", async () => {
    const included = createFake();
    included.addLog("마감 순서", { daysAgo: 7 });
    included.addLog("마감 순서");
    assert.equal((await ask(included, included.addLog("마감 순서"))).status, "notified");

    const excluded = createFake();
    excluded.addLog("마감 순서", { daysAgo: 7 + 1 / DAY });
    excluded.addLog("마감 순서");
    assert.equal((await ask(excluded, excluded.addLog("마감 순서"))).status, "below_threshold");
  });

  test("재발송 제한: 직전 발송 후 7일-1ms면 기존 회차, 정확히 7일이면 새 회차", async () => {
    for (const [offsetMs, expectedClaimed] of [[7 * DAY - 1, false], [7 * DAY, true]] as const) {
      let clock = NOW;
      const fake = createFake({ now: () => clock });
      for (let i = 0; i < 2; i += 1) fake.addLog("마감 순서");
      await notifyRepeatedQuestion(fake.client, { questionLogId: fake.addLog("마감 순서"), storeId: STORE_A, now: clock });

      clock = new Date(NOW.getTime() + offsetMs);
      for (let i = 0; i < 2; i += 1) fake.addLog("마감 순서");
      const result = await notifyRepeatedQuestion(fake.client, { questionLogId: fake.addLog("마감 순서"), storeId: STORE_A, now: clock });

      assert.equal(result.status === "notified" && result.claimed, expectedClaimed, `offset ${offsetMs}`);
    }
  });
});
