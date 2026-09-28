/**
 * 점주용 "보류된 직원 질문" 목록 조회.
 *
 * 권한 판정은 lib/manuals/store-manual-auth.ts의 requireStoreOwner를 그대로 재사용하고,
 * 응답에는 PoC 화면에 필요한 필드만 담는다.
 * client는 항상 호출부에서 주입한다 - 실제 Supabase 없이 가짜 client로 단위 테스트할 수 있다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";

/** 022의 에스컬레이션 대상과 같은 상태값. answered/cautious는 점주에게 보여주지 않는다. */
export const PENDING_QUESTION_STATUS = "insufficient";

export const DEFAULT_PENDING_QUESTION_LIMIT = 20;
export const MAX_PENDING_QUESTION_LIMIT = 50;

export type QuestionLogRow = {
  id: unknown;
  question: unknown;
  status: unknown;
  store_id: unknown;
  created_at: unknown;
  [key: string]: unknown;
};

/** PoC 화면에 필요한 필드만. answer/similarity_score/source_manual_id는 담지 않는다. */
export type PendingQuestion = {
  id: string;
  question: string;
  status: typeof PENDING_QUESTION_STATUS;
  createdAt: string;
};

export type PendingQuestionsResult =
  | {
      status: 200;
      body: { success: true; data: { questions: PendingQuestion[]; limit: number } };
    }
  | { status: 400 | 401 | 403 | 500; body: { success: false; error: string } };

export function unauthenticatedPendingQuestionsResult(): PendingQuestionsResult {
  return { status: 401, body: { success: false, error: "인증이 필요합니다." } };
}

export function missingStorePendingQuestionsResult(): PendingQuestionsResult {
  return { status: 400, body: { success: false, error: "매장을 선택해주세요." } };
}

export function forbiddenPendingQuestionsResult(): PendingQuestionsResult {
  return { status: 403, body: { success: false, error: "이 매장에 대한 접근 권한이 없습니다." } };
}

export function failedPendingQuestionsResult(): PendingQuestionsResult {
  return { status: 500, body: { success: false, error: "질문 목록을 불러오지 못했습니다." } };
}

export function successfulPendingQuestionsResult(
  questions: PendingQuestion[],
  limit: number,
): PendingQuestionsResult {
  return { status: 200, body: { success: true, data: { questions, limit } } };
}

/** /api/notifications의 limit 관례를 따르되, 상한을 두어 한 번에 과도하게 읽지 않게 한다. */
export function parsePendingQuestionLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return DEFAULT_PENDING_QUESTION_LIMIT;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_PENDING_QUESTION_LIMIT;
  }

  return Math.min(parsed, MAX_PENDING_QUESTION_LIMIT);
}

/**
 * 쿼리에서 이미 store_id/status로 좁히지만, 응답 직전에 한 번 더 대조한다.
 * store_id가 NULL인 022 이전 행과 다른 매장 행은 여기서도 걸러진다.
 */
export function toPendingQuestions(
  rows: readonly QuestionLogRow[],
  verifiedStoreId: string,
): PendingQuestion[] {
  if (!verifiedStoreId) {
    return [];
  }

  return rows.flatMap((row) => {
    if (
      typeof row.id !== "string"
      || typeof row.question !== "string"
      || typeof row.created_at !== "string"
      || row.status !== PENDING_QUESTION_STATUS
      || row.store_id !== verifiedStoreId
    ) {
      return [];
    }

    const question = row.question.trim();

    if (!row.id.trim() || !question || !row.created_at.trim()) {
      return [];
    }

    return [
      {
        id: row.id,
        question,
        status: PENDING_QUESTION_STATUS,
        createdAt: row.created_at,
      },
    ];
  });
}

export interface FetchPendingQuestionsInput {
  /** 로그인한 사용자 id. 세션에서만 온다. */
  userId: string;
  /** 클라이언트가 보낸 값. requireStoreOwner로 여기서 다시 검증한다. */
  storeId: string | null | undefined;
  /** 파싱 전 원본 limit 쿼리 값. */
  limit?: string | null;
}

export async function fetchPendingQuestionsForOwner(
  adminClient: SupabaseClient,
  input: FetchPendingQuestionsInput,
): Promise<PendingQuestionsResult> {
  const storeId = input.storeId?.trim();

  if (!storeId) {
    return missingStorePendingQuestionsResult();
  }

  const limit = parsePendingQuestionLimit(input.limit);

  let storeAuth;

  try {
    storeAuth = await requireStoreOwner(adminClient, input.userId, storeId);
  } catch (e) {
    logSafePendingQuestionError("OWNER_CHECK_FAILED", e);
    return failedPendingQuestionsResult();
  }

  if (!storeAuth) {
    return forbiddenPendingQuestionsResult();
  }

  try {
    // store_id = 검증된 매장으로 좁히므로 store_id가 NULL인 022 이전 행은 조회되지 않는다.
    const { data, error } = await adminClient
      .from("question_logs")
      .select("id, question, status, store_id, created_at")
      .eq("store_id", storeAuth.storeId)
      .eq("status", PENDING_QUESTION_STATUS)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      logSafePendingQuestionError("QUESTION_LOG_QUERY_FAILED", error);
      return failedPendingQuestionsResult();
    }

    return successfulPendingQuestionsResult(
      toPendingQuestions((data ?? []) as QuestionLogRow[], storeAuth.storeId),
      limit,
    );
  } catch (e) {
    logSafePendingQuestionError("QUESTION_LOG_QUERY_FAILED", e);
    return failedPendingQuestionsResult();
  }
}

// 고정 오류 코드와 안전한 error name만 남기고 질문 본문·UUID는 출력하지 않는다.
function logSafePendingQuestionError(code: string, error: unknown): void {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(`[BOSS_QUESTION_LOGS] ${code}`, { name });
}
