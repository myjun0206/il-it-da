/**
 * 점주 화면의 "새 보류 질문" 팝업 판정 로직 (순수 함수).
 *
 * 브라우저 API를 직접 쓰지 않고 저장소를 주입받으므로 가짜 알림·가짜 저장소로 단위 테스트할 수 있다.
 * 새 알림 판단은 알림 id를 기준으로 하고, created_at은 페이지 경계로 뒤늦게 들어온
 * 과거 알림을 걸러 내는 보조 조건으로만 쓴다.
 */
import { ESCALATION_NOTIFICATION_TYPE } from "@/lib/notifications/notification-href";

export const ESCALATION_POPUP_STORAGE_PREFIX = "ilitda.escalationPopupSeen";

/** 팝업에서 읽음 처리했을 때 종 알림 배지를 갱신하도록 알리는 이벤트(OwnerHeader의 avatar 이벤트와 같은 방식). */
export const NOTIFICATIONS_CHANGED_EVENT = "ilitdaNotificationsChanged";

export type PopupNotification = {
  id: string;
  type: string;
  title?: string;
  message?: string;
  targetUrl?: string | null;
  relatedId?: string | null;
  isRead: boolean;
  createdAt: string;
};

export type EscalationPopupState = {
  /** 첫 조회로 기준 목록을 잡았는지. false면 이번 조회 결과는 전부 "이미 있던 것"으로 본다. */
  baselineReady: boolean;
  /** 이미 기준에 포함됐거나 한 번 팝업으로 보여 준 알림 id. */
  seenIds: string[];
  /** 기준 시점에 본 가장 최근 알림 시각. 페이지 경계로 늦게 올라온 과거 알림을 막는다. */
  highWaterCreatedAt: string | null;
};

export function createInitialPopupState(restoredSeenIds: readonly string[] = []): EscalationPopupState {
  return { baselineReady: false, seenIds: [...new Set(restoredSeenIds)], highWaterCreatedAt: null };
}

export function isEscalationPopupCandidate(notification: PopupNotification): boolean {
  return notification.type === ESCALATION_NOTIFICATION_TYPE
    && notification.isRead === false
    && typeof notification.id === "string"
    && notification.id.trim().length > 0;
}

function latestCreatedAt(notifications: readonly PopupNotification[]): string | null {
  return notifications.reduce<string | null>((latest, notification) => {
    const value = notification.createdAt;
    if (typeof value !== "string" || !value) return latest;
    return latest === null || value > latest ? value : latest;
  }, null);
}

export type PopupPollResult = {
  state: EscalationPopupState;
  /** 이번 조회에서 처음 확인된, 팝업으로 보여 줄 알림. */
  newNotifications: PopupNotification[];
};

/**
 * 조회 결과 한 번을 반영한다. 조회 실패 시에는 이 함수를 호출하지 않아야 기준 목록이 유지된다.
 * 첫 호출은 기준만 잡고 아무것도 띄우지 않는다.
 */
export function reduceNotificationPoll(
  state: EscalationPopupState,
  notifications: readonly PopupNotification[],
): PopupPollResult {
  const candidates = notifications.filter(isEscalationPopupCandidate);
  const seen = new Set(state.seenIds);

  if (!state.baselineReady) {
    for (const candidate of candidates) {
      seen.add(candidate.id);
    }
    return {
      state: {
        baselineReady: true,
        seenIds: [...seen],
        highWaterCreatedAt: latestCreatedAt(notifications),
      },
      newNotifications: [],
    };
  }

  const newNotifications = candidates.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    // 페이지 창이 밀려 올라온 과거 알림은 새 알림이 아니다.
    if (state.highWaterCreatedAt !== null && candidate.createdAt <= state.highWaterCreatedAt) {
      seen.add(candidate.id);
      return false;
    }
    return true;
  });

  for (const candidate of newNotifications) {
    seen.add(candidate.id);
  }

  const nextHighWater = latestCreatedAt(notifications);

  return {
    state: {
      baselineReady: true,
      seenIds: [...seen],
      highWaterCreatedAt:
        nextHighWater !== null && (state.highWaterCreatedAt === null || nextHighWater > state.highWaterCreatedAt)
          ? nextHighWater
          : state.highWaterCreatedAt,
    },
    newNotifications,
  };
}

/** 열려 있는 팝업 목록에 새 알림을 id 기준 중복 없이 합친다. */
export function mergePopupQueue(
  current: readonly PopupNotification[],
  incoming: readonly PopupNotification[],
): PopupNotification[] {
  const byId = new Map(current.map((notification) => [notification.id, notification]));
  for (const notification of incoming) {
    if (!byId.has(notification.id)) {
      byId.set(notification.id, notification);
    }
  }
  return [...byId.values()];
}
/**
 * 다른 탭·종 알림에서 읽음 처리된 항목을 열린 팝업에서 내린다.
 * 이번 조회 창(limit)에 없는 항목은 읽혔다고 단정할 수 없으므로 그대로 둔다.
 */
export function pruneReadFromQueue(
  queue: readonly PopupNotification[],
  notifications: readonly PopupNotification[],
): PopupNotification[] {
  const readIds = new Set(
    notifications
      .filter((notification) => notification.isRead === true)
      .map((notification) => notification.id),
  );
  return queue.filter((notification) => !readIds.has(notification.id));
}
/** 서버가 만든 target_url에서만 매장 id를 읽는다. 알림 문구로 매장을 추측하지 않는다. */
export function storeIdFromTargetUrl(targetUrl: string | null | undefined): string | null {
  if (typeof targetUrl !== "string" || !targetUrl.trim()) return null;

  try {
    const url = new URL(targetUrl, "http://local.invalid");
    if (url.origin !== "http://local.invalid") return null;
    const storeId = url.searchParams.get("storeId");
    return storeId && storeId.trim() ? storeId.trim() : null;
  } catch {
    return null;
  }
}

export type MinimalStorage = Pick<Storage, "getItem" | "setItem">;

export function popupStorageKey(userId: string): string {
  return `${ESCALATION_POPUP_STORAGE_PREFIX}:${userId}`;
}

/** 저장소를 못 쓰거나 값이 깨져 있으면 빈 목록으로 시작한다(화면은 그대로 동작한다). */
export function readSeenIds(storage: MinimalStorage | null | undefined, userId: string): string[] {
  if (!storage || !userId) return [];

  try {
    const raw = storage.getItem(popupStorageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  } catch {
    return [];
  }
}

export function writeSeenIds(
  storage: MinimalStorage | null | undefined,
  userId: string,
  seenIds: readonly string[],
): void {
  if (!storage || !userId) return;

  try {
    storage.setItem(popupStorageKey(userId), JSON.stringify([...new Set(seenIds)]));
  } catch {
    // 저장에 실패해도 이번 세션 메모리 상태로 중복 표시는 막는다.
  }
}
