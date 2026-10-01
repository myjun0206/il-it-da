import type { SupabaseClient } from "@supabase/supabase-js";

import { escalateQuestionLogToStoreOwners } from "@/lib/notifications/escalate-question-log";
import { REPEATED_QUESTION_NOTIFICATION_TYPE } from "@/lib/notifications/notification-href";
import type { SaveQuestionLogResult } from "@/lib/rag/save-question-log";
import { buildBossRepeatedQuestionsUrl } from "@/lib/owner/boss-questions-view";
import {
  REPEATED_QUESTION_MIN_COUNT,
  REPEATED_QUESTION_WINDOW_DAYS,
  fetchRepeatedQuestionsForStore,
  normalizeRepeatedQuestionKey,
} from "@/lib/owner/repeated-questions";

export { REPEATED_QUESTION_NOTIFICATION_TYPE };

/**
 * 같은 매장에서 정규화 키가 같은 질문이 최근 7일 3건 이상이면 그 매장의 승인 점주에게 "반복 질문" 알림을 보낸다.
 *
 * - RAG status와 무관하게(answered/cautious/insufficient 모두) 판정하며, status를 바꾸지 않는다.
 * - 근거 부족 단건 알림(escalate-question-log.ts)과 type·문구·이동 경로가 다르다.
 * - 같은 매장·그룹에는 claim_repeated_question_alert(032)가 7일에 한 번만 알림 회차를 연다.
 *   동시 요청은 DB advisory lock으로, 수신자별 중복은 notifications partial unique index로 막는다.
 * - 회차 claim 뒤 알림 저장이 일부/전부 실패해도 회차는 남고, 같은 그룹의 다음 질문이 들어오면
 *   기존 회차(claimed=false)를 재사용해 아직 받지 못한 점주에게만 다시 보낸다. 백그라운드 재시도는 없다.
 * - 의미만 비슷한 질문(동의어·어순)은 합치지 않는다. normalizeRepeatedQuestionKey 계약을 그대로 따른다.
 */

// 질문 본문·매장/사용자 UUID를 문구에 담지 않는다.
export const REPEATED_QUESTION_NOTIFICATION_TITLE = "반복 질문이 감지되었습니다";
export const REPEATED_QUESTION_NOTIFICATION_MESSAGE =
  `최근 ${REPEATED_QUESTION_WINDOW_DAYS}일 동안 같은 직원 질문이 ${REPEATED_QUESTION_MIN_COUNT}회 이상 반복됐습니다. 반복 질문을 확인해 주세요.`;

export const CLAIM_REPEATED_QUESTION_ALERT_RPC = "claim_repeated_question_alert";

const UNIQUE_VIOLATION = "23505";

export type NotifyRepeatedQuestionResult =
  | { status: "below_threshold" }
  | { status: "not_applicable"; reason: "log_not_found" | "store_mismatch" | "empty_key" }
  | { status: "no_recipient" }
  | {
      status: "notified";
      alertId: string;
      /** 이번 호출이 새 알림 회차를 열었는지. false면 7일 안의 기존 회차를 재사용했다. */
      claimed: boolean;
      repeatCount: number;
      notifiedOwnerIds: string[];
      skippedOwnerIds: string[];
    }
  | {
      status: "failed";
      code: string;
      /** NOTIFICATION_INSERT_FAILED일 때만: 이번 호출에서 성공/실패한 수신자. 실패분은 다음 탐지에서 다시 시도된다. */
      notifiedOwnerIds?: string[];
      failedOwnerIds?: string[];
    };

export interface NotifyRepeatedQuestionInput {
  questionLogId: string;
  /** 호출부가 이미 검증한 매장 id. */
  storeId: string;
  now?: Date;
}

type CurrentLogRow = { id: string; question: unknown; store_id: string | null; created_at: unknown };

function logSafeRepeatedAlertError(code: string, error: unknown): void {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(`[REPEATED_QUESTION_ALERT] ${code}`, { name });
}

export async function notifyRepeatedQuestion(
  client: SupabaseClient,
  input: NotifyRepeatedQuestionInput,
): Promise<NotifyRepeatedQuestionResult> {
  const { questionLogId, storeId } = input;
  if (!questionLogId || !storeId) {
    return { status: "not_applicable", reason: "log_not_found" };
  }

  try {
    const { data: log, error: logError } = await client
      .from("question_logs")
      .select("id, question, store_id, created_at")
      .eq("id", questionLogId)
      .maybeSingle<CurrentLogRow>();

    if (logError) {
      logSafeRepeatedAlertError("QUESTION_LOG_LOOKUP_FAILED", logError);
      return { status: "failed", code: "QUESTION_LOG_LOOKUP_FAILED" };
    }
    if (!log) return { status: "not_applicable", reason: "log_not_found" };
    if (log.store_id !== storeId) return { status: "not_applicable", reason: "store_mismatch" };

    const groupKey = typeof log.question === "string" ? normalizeRepeatedQuestionKey(log.question) : "";
    if (!groupKey) return { status: "not_applicable", reason: "empty_key" };

    // 서버 시계가 DB보다 약간 늦어도 방금 저장한 현재 질문이 창 밖으로 밀리지 않게 한다.
    const now = input.now ?? new Date();
    const loggedAt = typeof log.created_at === "string" ? new Date(log.created_at).getTime() : Number.NaN;
    const windowEnd = Number.isFinite(loggedAt) && loggedAt > now.getTime() ? new Date(loggedAt) : now;

    const aggregated = await fetchRepeatedQuestionsForStore(client, { storeId, now: windowEnd });
    if (aggregated.status !== "ok") {
      return { status: "failed", code: "AGGREGATION_FAILED" };
    }

    const group = aggregated.report.groups.find((item) => item.groupKey === groupKey);
    if (!group) return { status: "below_threshold" };

    const { data: owners, error: ownerError } = await client
      .from("store_memberships")
      .select("user_id")
      .eq("store_id", storeId)
      .eq("role", "owner")
      .eq("status", "approved");

    if (ownerError) {
      logSafeRepeatedAlertError("OWNER_LOOKUP_FAILED", ownerError);
      return { status: "failed", code: "OWNER_LOOKUP_FAILED" };
    }

    const ownerIds = [
      ...new Set(
        ((owners ?? []) as { user_id: unknown }[])
          .map((row) => row.user_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    if (ownerIds.length === 0) return { status: "no_recipient" };

    const { data: claimRows, error: claimError } = await client.rpc(CLAIM_REPEATED_QUESTION_ALERT_RPC, {
      p_store_id: storeId,
      p_group_key: groupKey,
      p_representative_question: group.representativeQuestion,
      p_repeat_count: group.repeatCount,
      p_answered_count: group.statusCounts.answered,
      p_cautious_count: group.statusCounts.cautious,
      p_insufficient_count: group.statusCounts.insufficient,
      p_category: group.category,
      p_window_days: aggregated.report.windowDays,
      p_window_start: aggregated.report.windowStart,
      p_window_end: aggregated.report.windowEnd,
    });

    const claim = (Array.isArray(claimRows) ? claimRows[0] : claimRows) as
      | { alert_id?: unknown; claimed?: unknown }
      | null
      | undefined;

    if (claimError || !claim || typeof claim.alert_id !== "string") {
      logSafeRepeatedAlertError("ALERT_CLAIM_FAILED", claimError);
      return { status: "failed", code: "ALERT_CLAIM_FAILED" };
    }

    const alertId = claim.alert_id;

    const { data: existing, error: existingError } = await client
      .from("notifications")
      .select("recipient_user_id")
      .eq("type", REPEATED_QUESTION_NOTIFICATION_TYPE)
      .eq("related_id", alertId)
      .in("recipient_user_id", ownerIds);

    if (existingError) {
      logSafeRepeatedAlertError("EXISTING_NOTIFICATION_LOOKUP_FAILED", existingError);
      return { status: "failed", code: "EXISTING_NOTIFICATION_LOOKUP_FAILED" };
    }

    const alreadyNotified = new Set(
      ((existing ?? []) as { recipient_user_id: unknown }[])
        .map((row) => row.recipient_user_id)
        .filter((id): id is string => typeof id === "string"),
    );

    const notifiedOwnerIds: string[] = [];
    const skippedOwnerIds: string[] = [...alreadyNotified];
    const failedOwnerIds: string[] = [];

    for (const ownerId of ownerIds) {
      if (alreadyNotified.has(ownerId)) continue;

      const { error } = await client.from("notifications").insert({
        recipient_user_id: ownerId,
        type: REPEATED_QUESTION_NOTIFICATION_TYPE,
        title: REPEATED_QUESTION_NOTIFICATION_TITLE,
        message: REPEATED_QUESTION_NOTIFICATION_MESSAGE,
        target_url: buildBossRepeatedQuestionsUrl(storeId, alertId),
        related_id: alertId,
        is_read: false,
      });

      if (!error) {
        notifiedOwnerIds.push(ownerId);
      } else if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        skippedOwnerIds.push(ownerId);
      } else {
        logSafeRepeatedAlertError("NOTIFICATION_INSERT_FAILED", error);
        failedOwnerIds.push(ownerId);
      }
    }

    if (failedOwnerIds.length > 0) {
      return { status: "failed", code: "NOTIFICATION_INSERT_FAILED", notifiedOwnerIds, failedOwnerIds };
    }

    return {
      status: "notified",
      alertId,
      claimed: claim.claimed === true,
      repeatCount: group.repeatCount,
      notifiedOwnerIds,
      skippedOwnerIds,
    };
  } catch (e) {
    logSafeRepeatedAlertError("UNEXPECTED_ERROR", e);
    return { status: "failed", code: "UNEXPECTED_ERROR" };
  }
}

export interface QuestionLogFollowUpOptions {
  /** authorizeRagStoreAccessForRequest를 통과한 매장 id. */
  storeId: string;
  /** RAG 판정이 근거 부족(insufficient)이라 단건 보류 알림도 보내야 하는지. */
  escalate: boolean;
  getClient: () => SupabaseClient;
}

/**
 * 질문 로그 저장 뒤 후속 작업: 단건 보류 알림(insufficient일 때만)과 반복 질문 알림(모든 status)을
 * 서로 독립적으로 실행한다. 어느 쪽이 실패해도 다른 쪽과 직원 답변에는 영향이 없다.
 */
export function createQuestionLogFollowUp(options: QuestionLogFollowUpOptions) {
  return async (logResult: SaveQuestionLogResult): Promise<void> => {
    if (!logResult.saved || !logResult.questionLogId) {
      return;
    }
    const questionLogId = logResult.questionLogId;

    let client: SupabaseClient;
    try {
      client = options.getClient();
    } catch (e) {
      logSafeRepeatedAlertError("CLIENT_UNAVAILABLE", e);
      return;
    }

    if (options.escalate) {
      try {
        const result = await escalateQuestionLogToStoreOwners(client, { questionLogId, storeId: options.storeId });
        if (result.status === "failed") {
          console.error("[RAG] QUESTION_ESCALATION_FAILED", { status: result.status });
        }
      } catch (e) {
        logSafeRepeatedAlertError("ESCALATION_THREW", e);
      }
    }

    const repeated = await notifyRepeatedQuestion(client, { questionLogId, storeId: options.storeId });
    if (repeated.status === "failed") {
      console.error("[RAG] REPEATED_QUESTION_ALERT_FAILED", { code: repeated.code });
    }
  };
}
