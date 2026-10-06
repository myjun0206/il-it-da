/**
 * 점주의 "반복 질문" 알림 조회 (GET /api/boss/repeated-questions).
 *
 * 보류 질문 목록(pending-questions.ts)과 별개다. 답변 가능한 반복 질문을 보류 목록에 섞지 않고,
 * 보류 질문 처리 상태(resolution_status)도 쓰지 않는다.
 * 권한은 requireStoreOwner(승인 owner 멤버십 + 매장 franchise 확인)를 그대로 재사용한다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
import {
  MAX_ANALYZED_QUESTION_LOGS,
  REPEATED_QUESTION_CATEGORY_LABELS,
  type RepeatedQuestionCategory,
  type StatusCounts,
} from "@/lib/owner/repeated-questions";

/** 횟수·기간·분류는 모두 알림 발송 시점 스냅샷이다. 이후 들어온 같은 질문은 반영되지 않는다. */
export type RepeatedQuestionAlertView = {
  id: string;
  storeId: string;
  representativeQuestion: string;
  repeatCount: number;
  statusCounts: StatusCounts;
  category: RepeatedQuestionCategory;
  categoryLabel: string;
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  alertedAt: string;
  /**
   * 집계 기간의 매장 로그가 분석 상한(MAX_ANALYZED_QUESTION_LOGS)을 넘어 최신 상한분만 집계했는지.
   * 확인하지 못하면 null.
   */
  analysisLimited: boolean | null;
};

export type RepeatedQuestionAlertResult =
  | { status: 200; body: { success: true; data: { alert: RepeatedQuestionAlertView } } }
  | { status: 400 | 401 | 403 | 404 | 500; body: { success: false; error: string } };

type AlertRow = {
  id: string;
  store_id: string;
  representative_question: string;
  repeat_count: number;
  answered_count: number;
  cautious_count: number;
  insufficient_count: number;
  category: string;
  window_days: number;
  window_start: string;
  window_end: string;
  alerted_at: string;
};

const ALERT_COLUMNS =
  "id, store_id, representative_question, repeat_count, answered_count, cautious_count, insufficient_count, category, window_days, window_start, window_end, alerted_at";

function isCategory(value: unknown): value is RepeatedQuestionCategory {
  return typeof value === "string" && value in REPEATED_QUESTION_CATEGORY_LABELS;
}

export function unauthenticatedRepeatedQuestionAlertResult(): RepeatedQuestionAlertResult {
  return { status: 401, body: { success: false, error: "로그인이 필요합니다." } };
}

export interface FetchRepeatedQuestionAlertInput {
  /** 세션에서 온 사용자 id. */
  userId: string;
  /** 알림 링크의 값. requireStoreOwner로 다시 검증한다. */
  storeId: string | null | undefined;
  alertId: string | null | undefined;
}

export async function fetchRepeatedQuestionAlertForOwner(
  adminClient: SupabaseClient,
  input: FetchRepeatedQuestionAlertInput,
): Promise<RepeatedQuestionAlertResult> {
  const storeId = input.storeId?.trim();
  const alertId = input.alertId?.trim();

  if (!storeId || !alertId) {
    return { status: 400, body: { success: false, error: "매장과 알림 정보가 필요합니다." } };
  }

  try {
    const storeAuth = await requireStoreOwner(adminClient, input.userId, storeId);
    if (!storeAuth) {
      return { status: 403, body: { success: false, error: "이 매장의 반복 질문을 볼 권한이 없습니다." } };
    }

    const { data, error } = await adminClient
      .from("repeated_question_alerts")
      .select(ALERT_COLUMNS)
      .eq("id", alertId)
      .eq("store_id", storeAuth.storeId)
      .maybeSingle<AlertRow>();

    if (error) {
      console.error("[REPEATED_QUESTION_ALERT] ALERT_QUERY_FAILED", { name: "QueryError" });
      return { status: 500, body: { success: false, error: "반복 질문 정보를 불러오지 못했습니다." } };
    }
    if (!data || !isCategory(data.category)) {
      return { status: 404, body: { success: false, error: "반복 질문 알림을 찾을 수 없습니다." } };
    }

    // 스냅샷에 상한 도달 여부를 저장하지 않으므로, 같은 기간의 로그 수로 다시 판단한다.
    let analysisLimited: boolean | null = null;
    const { count, error: countError } = await adminClient
      .from("question_logs")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeAuth.storeId)
      .gte("created_at", data.window_start)
      .lte("created_at", data.window_end);
    if (!countError && typeof count === "number") {
      analysisLimited = count > MAX_ANALYZED_QUESTION_LOGS;
    }

    return {
      status: 200,
      body: {
        success: true,
        data: {
          alert: {
            id: data.id,
            storeId: data.store_id,
            representativeQuestion: data.representative_question,
            repeatCount: data.repeat_count,
            statusCounts: {
              answered: data.answered_count,
              cautious: data.cautious_count,
              insufficient: data.insufficient_count,
            },
            category: data.category,
            categoryLabel: REPEATED_QUESTION_CATEGORY_LABELS[data.category],
            windowDays: data.window_days,
            windowStart: data.window_start,
            windowEnd: data.window_end,
            alertedAt: data.alerted_at,
            analysisLimited,
          },
        },
      },
    };
  } catch (e) {
    console.error("[REPEATED_QUESTION_ALERT] OWNER_ALERT_LOOKUP_FAILED", {
      name: e instanceof Error ? e.name : "UnknownError",
    });
    return { status: 500, body: { success: false, error: "반복 질문 정보를 불러오지 못했습니다." } };
  }
}
