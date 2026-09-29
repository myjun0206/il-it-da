/** 알림 클릭 이동 경로 계산 (서버·클라이언트 공용 순수 모듈). DB·Supabase 코드를 import하지 않는다. */
import { BOSS_QUESTIONS_PATH, HIGHLIGHT_QUESTION_PARAM } from "@/lib/owner/boss-questions-view";

export const ESCALATION_NOTIFICATION_TYPE = "manual_question_escalation";

/**
 * 에스컬레이션 알림이 점주 질문 화면을 가리키면 related_id(질문 로그 id)를 강조용 쿼리로 덧붙인다.
 * 그 외 알림이나 related_id가 없으면 target_url을 그대로 쓴다.
 */
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
