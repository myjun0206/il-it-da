import type { SupabaseClient } from "@supabase/supabase-js";

import { ESCALATION_NOTIFICATION_TYPE } from "@/lib/notifications/notification-href";
import { buildBossQuestionsUrl } from "@/lib/owner/boss-questions-view";

export { ESCALATION_NOTIFICATION_TYPE };

/**
 * 근거 부족으로 보류된(status='insufficient') 직원 질문을 그 매장의 승인된 점주에게만 알린다.
 *
 * 범위 계약: storeId는 호출부가 이미 서버에서 검증한 값이어야 하고, 이 함수는 그 storeId로
 * question_logs 행을 한 번 더 대조한다(다른 매장 로그를 넘겨도 알림이 나가지 않는다).
 * 수신자는 store_memberships의 role='owner' + status='approved'로만 정해지므로 다른 매장이나
 * 다른 franchise의 점주는 조회 자체에 포함되지 않는다.
 *
 * client는 항상 호출부에서 주입한다 - 실제 Supabase 없이 가짜 client로 단위 테스트할 수 있다.
 */

// 질문 본문·유사도·매장/사용자 UUID를 문구에 담지 않는다. 어떤 질문인지는 related_id로만 잇는다.
export const ESCALATION_NOTIFICATION_TITLE = "확인이 필요한 직원 질문이 있습니다";
export const ESCALATION_NOTIFICATION_MESSAGE =
  "매뉴얼에서 답을 찾지 못한 직원 질문이 접수됐습니다. 매장 매뉴얼을 확인해 주세요.";

/** 022가 만든 partial unique index 위반. 이미 같은 점주에게 보낸 알림이라는 뜻이다. */
const UNIQUE_VIOLATION = "23505";

export type EscalationSkipReason = "log_not_found" | "not_pending" | "store_mismatch";

export type EscalateQuestionLogResult =
  /** notifiedOwnerIds가 비어 있고 skipped만 있으면 재시도로 중복 없이 끝난 경우다. */
  | { status: "notified"; notifiedOwnerIds: string[]; skippedOwnerIds: string[] }
  | { status: "no_recipient" }
  | { status: "not_escalatable"; reason: EscalationSkipReason }
  | { status: "failed" };

type QuestionLogRow = { id: string; status: string; store_id: string | null };

export interface EscalateQuestionLogInput {
  questionLogId: string;
  /** 호출부가 이미 검증한 매장 id. */
  storeId: string;
}

function logSafeEscalationError(code: string, error: unknown): void {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(`[ESCALATION] ${code}`, { name });
}

export async function escalateQuestionLogToStoreOwners(
  client: SupabaseClient,
  input: EscalateQuestionLogInput,
): Promise<EscalateQuestionLogResult> {
  const { questionLogId, storeId } = input;

  if (!questionLogId || !storeId) {
    return { status: "not_escalatable", reason: "log_not_found" };
  }

  let log: QuestionLogRow | null;

  try {
    const { data, error } = await client
      .from("question_logs")
      .select("id, status, store_id")
      .eq("id", questionLogId)
      .maybeSingle<QuestionLogRow>();

    if (error) {
      logSafeEscalationError("QUESTION_LOG_LOOKUP_FAILED", error);
      return { status: "failed" };
    }
    log = data;
  } catch (e) {
    logSafeEscalationError("QUESTION_LOG_LOOKUP_FAILED", e);
    return { status: "failed" };
  }

  if (!log) {
    return { status: "not_escalatable", reason: "log_not_found" };
  }
  if (log.status !== "insufficient") {
    return { status: "not_escalatable", reason: "not_pending" };
  }
  // store_id가 NULL인 022 이전 행도 여기서 걸러진다.
  if (log.store_id !== storeId) {
    return { status: "not_escalatable", reason: "store_mismatch" };
  }

  let ownerIds: string[];

  try {
    const { data, error } = await client
      .from("store_memberships")
      .select("user_id")
      .eq("store_id", storeId)
      .eq("role", "owner")
      .eq("status", "approved");

    if (error) {
      logSafeEscalationError("OWNER_LOOKUP_FAILED", error);
      return { status: "failed" };
    }

    ownerIds = [
      ...new Set(
        ((data ?? []) as { user_id: unknown }[])
          .map((row) => row.user_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
  } catch (e) {
    logSafeEscalationError("OWNER_LOOKUP_FAILED", e);
    return { status: "failed" };
  }

  if (ownerIds.length === 0) {
    return { status: "no_recipient" };
  }

  let alreadyNotified: Set<string>;

  try {
    const { data, error } = await client
      .from("notifications")
      .select("recipient_user_id")
      .eq("type", ESCALATION_NOTIFICATION_TYPE)
      .eq("related_id", questionLogId)
      .in("recipient_user_id", ownerIds);

    if (error) {
      logSafeEscalationError("EXISTING_NOTIFICATION_LOOKUP_FAILED", error);
      return { status: "failed" };
    }

    alreadyNotified = new Set(
      ((data ?? []) as { recipient_user_id: unknown }[])
        .map((row) => row.recipient_user_id)
        .filter((id): id is string => typeof id === "string"),
    );
  } catch (e) {
    logSafeEscalationError("EXISTING_NOTIFICATION_LOOKUP_FAILED", e);
    return { status: "failed" };
  }

  const notifiedOwnerIds: string[] = [];
  const skippedOwnerIds: string[] = [...alreadyNotified];

  for (const ownerId of ownerIds) {
    if (alreadyNotified.has(ownerId)) {
      continue;
    }

    try {
      const { error } = await client.from("notifications").insert({
        recipient_user_id: ownerId,
        type: ESCALATION_NOTIFICATION_TYPE,
        title: ESCALATION_NOTIFICATION_TITLE,
        message: ESCALATION_NOTIFICATION_MESSAGE,
        // log.store_id와 대조를 마친 storeId만 링크에 담는다. 화면에서도 승인 매장 목록과 다시 대조한다.
        target_url: buildBossQuestionsUrl(storeId),
        related_id: questionLogId,
        is_read: false,
      });

      if (!error) {
        notifiedOwnerIds.push(ownerId);
        continue;
      }

      // 같은 요청이 동시에 들어와 unique index에 걸린 경우는 실패가 아니라 "이미 보냄"이다.
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        skippedOwnerIds.push(ownerId);
        continue;
      }

      logSafeEscalationError("NOTIFICATION_INSERT_FAILED", error);
      return { status: "failed" };
    } catch (e) {
      logSafeEscalationError("NOTIFICATION_INSERT_FAILED", e);
      return { status: "failed" };
    }
  }

  return { status: "notified", notifiedOwnerIds, skippedOwnerIds };
}
