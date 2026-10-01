/** 알림 클릭 이동 경로 계산 (서버·클라이언트 공용 순수 모듈). DB·Supabase 코드를 import하지 않는다. */
import { BOSS_QUESTIONS_PATH, HIGHLIGHT_QUESTION_PARAM } from "@/lib/owner/boss-questions-view";

export const ESCALATION_NOTIFICATION_TYPE = "manual_question_escalation";

/**
 * 에스컬레이션 알림이 점주 질문 화면을 가리키면 related_id(질문 로그 id)를 강조용 쿼리로 덧붙인다.
 * 그 외 알림이나 related_id가 없으면 target_url을 그대로 쓴다.
 */
export const LEGACY_ESCALATION_NOTICE = "이전 알림입니다. 보류 질문 메뉴에서 확인해 주세요.";

export type NotificationClickAction =
  | { kind: "navigate"; href: string }
  | { kind: "notice"; message: string }
  | { kind: "none" };

/**
 * 링크가 없던 과거 에스컬레이션 알림은 related_id로 매장을 추측하지 않고 메뉴 안내만 한다.
 * 그 외에는 resolveNotificationHref 결과를 그대로 따른다.
 */
export function resolveNotificationClick(notification: {
  type: string;
  targetUrl?: string | null;
  relatedId?: string | null;
}): NotificationClickAction {
  if (notification.type === ESCALATION_NOTIFICATION_TYPE && !notification.targetUrl?.trim()) {
    return { kind: "notice", message: LEGACY_ESCALATION_NOTICE };
  }

  const href = resolveNotificationHref(notification);
  return href ? { kind: "navigate", href } : { kind: "none" };
}

export function resolveNotificationHref(notification: {
  type: string;
  targetUrl?: string | null;
  relatedId?: string | null;
}): string | null {
  const { type, targetUrl, relatedId } = notification;

  if (!targetUrl) return null;
  if (type !== ESCALATION_NOTIFICATION_TYPE || !relatedId) return targetUrl;

  const url = new URL(targetUrl, "http://local.invalid");
  if (url.origin !== "http://local.invalid" || url.pathname !== BOSS_QUESTIONS_PATH) return targetUrl;

  url.searchParams.set(HIGHLIGHT_QUESTION_PARAM, relatedId);
  return `${url.pathname}${url.search}`;
}
