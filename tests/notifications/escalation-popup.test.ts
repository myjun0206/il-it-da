import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  type MinimalStorage,
  type PopupNotification,
  createInitialPopupState,
  isEscalationPopupCandidate,
  mergePopupQueue,
  popupStorageKey,
  pruneReadFromQueue,
  readSeenIds,
  reduceNotificationPoll,
  storeIdFromTargetUrl,
  writeSeenIds,
} from "../../lib/notifications/escalation-popup.ts";
import { ESCALATION_NOTIFICATION_TYPE } from "../../lib/notifications/notification-href.ts";

const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_A = "user-a";
const USER_B = "user-b";

function escalation(id: string, overrides: Partial<PopupNotification> = {}): PopupNotification {
  return {
    id,
    type: ESCALATION_NOTIFICATION_TYPE,
    isRead: false,
    targetUrl: `/boss/questions?storeId=${STORE_A}`,
    relatedId: `log-${id}`,
    createdAt: "2026-09-30T01:00:00.000Z",
    ...overrides,
  };
}

function fakeStorage(initial: Record<string, string> = {}, options: { throwOnWrite?: boolean; throwOnRead?: boolean } = {}) {
  const map = new Map(Object.entries(initial));
  const storage: MinimalStorage = {
    getItem(key) {
      if (options.throwOnRead) throw new Error("storage blocked");
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      if (options.throwOnWrite) throw new Error("storage blocked");
      map.set(key, value);
    },
  };
  return { storage, map };
}

describe("기준 목록(baseline)", () => {
  test("최초 조회의 과거 미확인 알림은 팝업으로 띄우지 않는다", () => {
    const result = reduceNotificationPoll(createInitialPopupState(), [escalation("n1"), escalation("n2")]);

    assert.deepEqual(result.newNotifications, []);
    assert.equal(result.state.baselineReady, true);
    assert.deepEqual(result.state.seenIds.sort(), ["n1", "n2"]);
  });

  test("다음 조회에서 새로 확인된 알림만 팝업 대상이 된다", () => {
    const first = reduceNotificationPoll(createInitialPopupState(), [escalation("n1")]);
    const second = reduceNotificationPoll(first.state, [
      escalation("n2", { createdAt: "2026-09-30T02:00:00.000Z" }),
      escalation("n1"),
    ]);

    assert.deepEqual(second.newNotifications.map((item) => item.id), ["n2"]);
  });

  test("조회 실패로 호출을 건너뛰어도 기준과 이력은 그대로다", () => {
    const first = reduceNotificationPoll(createInitialPopupState(), [escalation("n1")]);
    // 실패한 조회에서는 reduceNotificationPoll을 부르지 않는다.
    const afterRecovery = reduceNotificationPoll(first.state, [escalation("n1")]);

    assert.deepEqual(afterRecovery.newNotifications, []);
    assert.deepEqual(afterRecovery.state.seenIds, ["n1"]);
  });

  test("빈 목록이 와도 기준 목록을 초기화하지 않는다", () => {
    const first = reduceNotificationPoll(createInitialPopupState(), [escalation("n1")]);
    const empty = reduceNotificationPoll(first.state, []);

    assert.deepEqual(empty.state.seenIds, ["n1"]);
    assert.deepEqual(empty.newNotifications, []);
  });
});

describe("중복 표시 방지", () => {
  test("같은 id를 반복 조회해도 한 번만 띄운다", () => {
    const base = reduceNotificationPoll(createInitialPopupState(), []).state;
    const first = reduceNotificationPoll(base, [escalation("n9", { createdAt: "2026-09-30T03:00:00.000Z" })]);
    const second = reduceNotificationPoll(first.state, [escalation("n9", { createdAt: "2026-09-30T03:00:00.000Z" })]);

    assert.deepEqual(first.newNotifications.map((item) => item.id), ["n9"]);
    assert.deepEqual(second.newNotifications, []);
  });

  test("저장된 이력을 복원하면 경로 이동·새로고침 후에도 다시 뜨지 않는다", () => {
    const restored = createInitialPopupState(["n9"]);
    const afterBaseline = reduceNotificationPoll(restored, []);
    const next = reduceNotificationPoll(afterBaseline.state, [
      escalation("n9", { createdAt: "2026-09-30T03:00:00.000Z" }),
    ]);

    assert.deepEqual(next.newNotifications, []);
  });

  test("페이지 경계로 늦게 올라온 과거 알림은 새 알림으로 보지 않는다", () => {
    const first = reduceNotificationPoll(createInitialPopupState(), [
      escalation("recent", { createdAt: "2026-09-30T05:00:00.000Z" }),
    ]);
    const older = reduceNotificationPoll(first.state, [
      escalation("older", { createdAt: "2026-09-29T00:00:00.000Z" }),
    ]);

    assert.deepEqual(older.newNotifications, []);
    assert.ok(older.state.seenIds.includes("older"));
  });
});

describe("대상 알림 선별", () => {
  test("에스컬레이션이 아닌 알림은 팝업 대상이 아니다", () => {
    for (const type of ["owner_pending_approval", "staff_pending_approval", "approval_decision"]) {
      assert.equal(isEscalationPopupCandidate(escalation("x", { type })), false, type);
    }
  });

  test("이미 읽은 알림은 팝업 대상이 아니다", () => {
    assert.equal(isEscalationPopupCandidate(escalation("x", { isRead: true })), false);
  });

  test("다른 탭에서 읽음 처리된 알림은 다음 갱신에서 제외된다", () => {
    const base = reduceNotificationPoll(createInitialPopupState(), []).state;
    const next = reduceNotificationPoll(base, [
      escalation("read-elsewhere", { isRead: true, createdAt: "2026-09-30T06:00:00.000Z" }),
    ]);

    assert.deepEqual(next.newNotifications, []);
  });

  test("다른 종류 알림만 오면 팝업이 없다", () => {
    const base = reduceNotificationPoll(createInitialPopupState(), []).state;
    const next = reduceNotificationPoll(base, [
      escalation("approval", { type: "owner_pending_approval", createdAt: "2026-09-30T06:00:00.000Z" }),
    ]);

    assert.deepEqual(next.newNotifications, []);
  });
});

describe("여러 알림 묶기", () => {
  test("한 번의 갱신에 여러 알림이 오면 하나의 묶음으로 돌려준다", () => {
    const base = reduceNotificationPoll(createInitialPopupState(), []).state;
    const next = reduceNotificationPoll(base, [
      escalation("a", { createdAt: "2026-09-30T07:00:00.000Z", targetUrl: `/boss/questions?storeId=${STORE_A}` }),
      escalation("b", { createdAt: "2026-09-30T07:00:01.000Z", targetUrl: `/boss/questions?storeId=${STORE_B}` }),
    ]);

    assert.deepEqual(next.newNotifications.map((item) => item.id), ["a", "b"]);
    assert.deepEqual(
      next.newNotifications.map((item) => storeIdFromTargetUrl(item.targetUrl)),
      [STORE_A, STORE_B],
    );
  });

  test("열린 팝업에 새 알림을 중복 없이 합친다", () => {
    const merged = mergePopupQueue([escalation("a")], [escalation("a"), escalation("c")]);
    assert.deepEqual(merged.map((item) => item.id), ["a", "c"]);
  });

  test("합칠 때 기존 항목의 이동 대상은 유지된다", () => {
    const merged = mergePopupQueue(
      [escalation("a", { relatedId: "log-original" })],
      [escalation("a", { relatedId: "log-changed" })],
    );
    assert.equal(merged[0].relatedId, "log-original");
  });

  test("다른 곳에서 읽음 처리된 알림은 열린 팝업에서 내려간다", () => {
    const queue = [escalation("a"), escalation("b")];
    const pruned = pruneReadFromQueue(queue, [escalation("a", { isRead: true }), escalation("b")]);

    assert.deepEqual(pruned.map((item) => item.id), ["b"]);
  });

  test("이번 조회 창에 없는 항목은 읽혔다고 단정하지 않는다", () => {
    const queue = [escalation("a"), escalation("out-of-window")];
    const pruned = pruneReadFromQueue(queue, [escalation("a")]);

    assert.deepEqual(pruned.map((item) => item.id), ["a", "out-of-window"]);
  });
});

describe("매장 식별", () => {
  test("서버가 만든 target_url에서만 매장 id를 읽는다", () => {
    assert.equal(storeIdFromTargetUrl(`/boss/questions?storeId=${STORE_A}`), STORE_A);
    assert.equal(storeIdFromTargetUrl(`/boss/questions?storeId=${STORE_A}&questionId=q1`), STORE_A);
  });

  test("매장 id가 없거나 외부 주소면 null이다", () => {
    for (const value of [null, undefined, "", "   ", "/boss/questions", "https://example.com/boss/questions?storeId=x"]) {
      assert.equal(storeIdFromTargetUrl(value), null, String(value));
    }
  });
});

describe("표시 이력 저장", () => {
  test("사용자별로 키를 분리한다", () => {
    assert.notEqual(popupStorageKey(USER_A), popupStorageKey(USER_B));
  });

  test("이전 사용자의 이력이 섞이지 않는다", () => {
    const { storage } = fakeStorage();
    writeSeenIds(storage, USER_A, ["n1", "n2"]);

    assert.deepEqual(readSeenIds(storage, USER_B), []);
    assert.deepEqual(readSeenIds(storage, USER_A).sort(), ["n1", "n2"]);
  });

  test("알림 id만 저장하고 질문 원문·이메일은 저장하지 않는다", () => {
    const { storage, map } = fakeStorage();
    writeSeenIds(storage, USER_A, ["n1"]);

    const stored = map.get(popupStorageKey(USER_A)) ?? "";
    assert.equal(stored.includes("n1"), true);
    for (const leak of ["환불", "@", "question", "message"]) {
      assert.equal(stored.includes(leak), false, leak);
    }
  });

  test("저장소를 쓸 수 없어도 예외를 던지지 않는다", () => {
    const blockedWrite = fakeStorage({}, { throwOnWrite: true });
    const blockedRead = fakeStorage({}, { throwOnRead: true });

    assert.doesNotThrow(() => writeSeenIds(blockedWrite.storage, USER_A, ["n1"]));
    assert.deepEqual(readSeenIds(blockedRead.storage, USER_A), []);
    assert.deepEqual(readSeenIds(null, USER_A), []);
    assert.doesNotThrow(() => writeSeenIds(null, USER_A, ["n1"]));
  });

  test("저장값이 깨져 있으면 빈 목록으로 시작한다", () => {
    const { storage } = fakeStorage({ [popupStorageKey(USER_A)]: "{not json" });
    assert.deepEqual(readSeenIds(storage, USER_A), []);

    const notArray = fakeStorage({ [popupStorageKey(USER_A)]: '{"a":1}' });
    assert.deepEqual(readSeenIds(notArray.storage, USER_A), []);
  });
});

describe("팝업 컴포넌트 연결 계약", () => {
  const source = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../components/owner/EscalationNotificationPopup.tsx",
    ),
    "utf8",
  );
  const layout = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/boss/layout.tsx"),
    "utf8",
  );

  test("점주 레이아웃에만 붙는다", () => {
    assert.match(layout, /<EscalationNotificationPopup \/>/);
  });

  test("표시만으로 읽음 처리하지 않고, 확인 버튼에서만 mark-read를 부른다", () => {
    assert.equal((source.match(/mark-read/g) ?? []).length, 1);
    assert.match(source, /handleOpenQuestion[\s\S]{0,400}mark-read/);
    assert.match(source, /const dismiss = useCallback\(\(\) => \{[\s\S]{0,200}setQueue\(\[\]\)/);
    assert.equal(/dismiss[\s\S]{0,200}mark-read/.test(source), false);
  });

  test("이동은 기존 resolveNotificationClick을 재사용한다", () => {
    assert.match(source, /resolveNotificationClick\(notification\)/);
    assert.match(source, /action\.kind === "navigate"/);
    assert.match(source, /action\.kind === "notice"/);
  });

  test("읽음 처리 실패를 성공으로 표시하지 않는다", () => {
    assert.match(source, /if \(!response\.ok\) \{\s*\n\s*setActionError/);
  });

  test("dialog 의미와 제목·본문 연결을 갖춘다", () => {
    assert.match(source, /role="dialog"/);
    assert.match(source, /aria-modal="true"/);
    assert.match(source, /aria-labelledby=\{headingId\}/);
    assert.match(source, /aria-describedby=\{bodyId\}/);
    assert.match(source, /직원이 확인을 요청했어요/);
  });

  test("질문 원문을 팝업에 복제하지 않는다", () => {
    assert.equal(/notification\.message/.test(source), false);
    assert.equal(/notification\.title/.test(source), false);
  });

  test("매장명은 권한 검증된 매장 목록에서만 가져오고 없으면 일반 안내를 쓴다", () => {
    assert.match(source, /resolveOwnerCurrentStore\(\)/);
    assert.match(source, /storeNames\.get\(storeId\)\) \|\| GENERIC_STORE_LABEL/);
  });

  test("타이머는 하나만 만들고 정리한다", () => {
    assert.equal((source.match(/setInterval\(/g) ?? []).length, 1);
    assert.match(source, /clearInterval\(timer\)/);
  });

  test("포커스는 열릴 때만 옮긴다", () => {
    assert.match(source, /\}, \[isOpen\]\);/);
    assert.match(source, /previouslyFocusedRef\.current\?\.focus\?\.\(\)/);
  });
  test("읽음 처리 뒤 종 알림 배지를 갱신하도록 알린다", () => {
    const center = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../components/common/NotificationCenter.tsx"),
      "utf8",
    );
    assert.match(source, /window\.dispatchEvent\(new CustomEvent\(NOTIFICATIONS_CHANGED_EVENT\)\)/);
    assert.match(center, /addEventListener\(NOTIFICATIONS_CHANGED_EVENT, loadUnreadCount\)/);
    assert.match(center, /removeEventListener\(NOTIFICATIONS_CHANGED_EVENT, loadUnreadCount\)/);
  });

  test("조회마다 읽힌 항목을 팝업에서 내린다", () => {
    assert.match(source, /pruneReadFromQueue\(current, notifications\)/);
  });});
