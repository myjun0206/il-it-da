/**
 * 점주용 "보류된 직원 질문" 목록 조회.
 *
 * 권한 판정은 lib/manuals/store-manual-auth.ts의 requireStoreOwner를 그대로 재사용하고,
 * 응답에는 PoC 화면에 필요한 필드만 담는다.
 * client는 항상 호출부에서 주입한다 - 실제 Supabase 없이 가짜 client로 단위 테스트할 수 있다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
import { normalizeRepeatedQuestionKey, REPEATED_QUESTION_MIN_COUNT, REPEATED_QUESTION_WINDOW_DAYS } from "@/lib/owner/repeated-questions";

/** 022의 에스컬레이션 대상과 같은 상태값. answered/cautious는 점주에게 보여주지 않는다. */
export const PENDING_QUESTION_STATUS = "insufficient";

/** 점주의 질문 처리 상태 */
export type QuestionResolutionStatus = "open" | "in_progress" | "resolved";

export const RESOLUTION_STATUSES: readonly QuestionResolutionStatus[] = ["open", "in_progress", "resolved"] as const;

export function isQuestionResolutionStatus(value: unknown): value is QuestionResolutionStatus {
  return typeof value === "string" && (value === "open" || value === "in_progress" || value === "resolved");
}

export type QuestionResolutionFilter = QuestionResolutionStatus | "active" | "all";

export function parseQuestionResolutionFilter(raw: string | null | undefined): QuestionResolutionFilter {
  if (!raw || typeof raw !== "string") return "active";
  const trimmed = raw.trim();
  if (trimmed === "all" || trimmed === "active" || isQuestionResolutionStatus(trimmed)) {
    return trimmed as QuestionResolutionFilter;
  }
  return "active";
}

export const DEFAULT_PENDING_QUESTION_LIMIT = 20;
export const MAX_PENDING_QUESTION_LIMIT = 50;

export type QuestionLogRow = {
  id: unknown;
  question: unknown;
  status: unknown;
  store_id: unknown;
  created_at: unknown;
  resolution_status?: unknown;
  resolution_revision?: unknown;
  resolution_updated_at?: unknown;
  resolution_updated_by?: unknown;
  resolved_at?: unknown;
  resolved_by?: unknown;
  [key: string]: unknown;
};

/** PoC 화면에 필요한 필드만. answer/similarity_score/source_manual_id는 담지 않는다. */
export type PendingQuestion = {
  id: string;
  question: string;
  status: typeof PENDING_QUESTION_STATUS;
  createdAt: string;
  resolutionStatus: QuestionResolutionStatus;
  resolutionRevision: number;
  resolutionUpdatedAt: string | null;
  resolutionUpdatedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  originReason: "manual_gap" | "frequent_question";
  repeatCount: number;
};

export type PendingQuestionsResult =
  | {
      status: 200;
      body: {
        success: true;
        data: {
          questions: PendingQuestion[];
          limit: number;
          resolutionFeatureAvailable: boolean;
        };
      };
    }
  | { status: 400 | 401 | 403 | 404 | 409 | 500; body: { success: false; error: string; code?: string } };

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
  resolutionFeatureAvailable = true,
): PendingQuestionsResult {
  return {
    status: 200,
    body: {
      success: true,
      data: {
        questions,
        limit,
        resolutionFeatureAvailable,
      },
    },
  };
}

/** 031 마이그레이션이 미적용된 DB에서 발생하는 누락 컬럼 에러인지 엄격히 검사한다. */
export function isMissingResolutionColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; message?: string; details?: string; hint?: string };
  const combined = `${err.message ?? ""} ${err.details ?? ""} ${err.hint ?? ""}`.toLowerCase();

  const mentionsResolution =
    combined.includes("resolution_status") ||
    combined.includes("resolution_revision") ||
    combined.includes("resolution_updated_at") ||
    combined.includes("resolution_updated_by") ||
    combined.includes("resolved_at") ||
    combined.includes("resolved_by");

  if (!mentionsResolution) return false;

  return (
    err.code === "42703" ||
    err.code === "PGRST204" ||
    combined.includes("does not exist") ||
    combined.includes("schema cache")
  );
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
 * resolution_status가 없는 이전 DB 행은 기본값 "open"으로 호환 처리한다.
 */
export function toPendingQuestions(
  rows: readonly QuestionLogRow[],
  verifiedStoreId: string,
  repeatCounts: ReadonlyMap<string, number> = new Map(),
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

    const resolutionStatus: QuestionResolutionStatus =
      isQuestionResolutionStatus(row.resolution_status)
        ? row.resolution_status
        : "open";

    const resolutionRevision = typeof row.resolution_revision === "number"
      ? row.resolution_revision
      : 1;

    const repeatCount = repeatCounts.get(normalizeRepeatedQuestionKey(question)) ?? 1;

    return [
      {
        id: row.id,
        question,
        status: PENDING_QUESTION_STATUS,
        createdAt: row.created_at,
        resolutionStatus,
        resolutionRevision,
        resolutionUpdatedAt: typeof row.resolution_updated_at === "string" ? row.resolution_updated_at : null,
        resolutionUpdatedBy: typeof row.resolution_updated_by === "string" ? row.resolution_updated_by : null,
        resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : null,
        resolvedBy: typeof row.resolved_by === "string" ? row.resolved_by : null,
        originReason: repeatCount >= REPEATED_QUESTION_MIN_COUNT ? "frequent_question" : "manual_gap",
        repeatCount,
      },
    ];
  });
}

/** 보류 카드의 반복 배지용 최근 7일 집계(develop 계약: 최신 500건). 실패하면 null. */
async function fetchRecentRepeatCounts(
  adminClient: SupabaseClient,
  verifiedStoreId: string,
): Promise<Map<string, number> | null> {
  const windowStart = new Date(Date.now() - REPEATED_QUESTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const { data: recentLogs, error: repeatQueryError } = await adminClient
    .from("question_logs")
    .select("id, question, status, store_id, source_manual_id, created_at")
    .eq("store_id", verifiedStoreId)
    .gte("created_at", windowStart.toISOString())
    .order("created_at", { ascending: false })
    .limit(500);

  if (repeatQueryError) {
    logSafePendingQuestionError("QUESTION_REPEAT_QUERY_FAILED", repeatQueryError);
    return null;
  }

  const repeatCounts = new Map<string, number>();
  for (const row of (recentLogs ?? []) as QuestionLogRow[]) {
    if (row.store_id !== verifiedStoreId || typeof row.question !== "string") continue;
    const key = normalizeRepeatedQuestionKey(row.question);
    if (!key) continue;
    repeatCounts.set(key, (repeatCounts.get(key) ?? 0) + 1);
  }
  return repeatCounts;
}

export interface FetchPendingQuestionsInput {
  /** 로그인한 사용자 id. 세션에서만 온다. */
  userId: string;
  /** 클라이언트가 보낸 값. requireStoreOwner로 여기서 다시 검증한다. */
  storeId: string | null | undefined;
  /** 파싱 전 원본 limit 쿼리 값. */
  limit?: string | null;
  /** 처리 상태 필터: 'active'(open+in_progress), 'open', 'in_progress', 'resolved', 'all' */
  resolutionStatus?: string | null;
  /** 알림 링크 등에서 특정 질문을 강조하기 위해 요청된 questionId */
  highlightQuestionId?: string | null;
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
  const filter = parseQuestionResolutionFilter(input.resolutionStatus);
  const highlightId = input.highlightQuestionId?.trim();

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

  const COLUMNS =
    "id, question, status, store_id, created_at, resolution_status, resolution_revision, resolution_updated_at, resolution_updated_by, resolved_at, resolved_by";
  const LEGACY_COLUMNS = "id, question, status, store_id, created_at";

  try {
    // 보류 질문 목록은 기간 제한이 없다. 031이 적용된 DB에서는 resolution 컨럼을 함께 읽는다.
    let query = adminClient
      .from("question_logs")
      .select(COLUMNS)
      .eq("store_id", storeAuth.storeId)
      .eq("status", PENDING_QUESTION_STATUS);

    if (filter === "active") {
      query = query.in("resolution_status", ["open", "in_progress"]);
    } else if (filter !== "all") {
      query = query.eq("resolution_status", filter);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      if (isMissingResolutionColumnError(error)) {
        // 031 미적용 DB 호환 fallback:
        // 미적용 상태에서 in_progress나 resolved 필터 선택 시 open 질문을 그 상태인 것처럼 반환하지 않고 빈 목록을 반환한다.
        if (filter === "in_progress" || filter === "resolved") {
          return successfulPendingQuestionsResult([], limit, false);
        }

        const legacyQuery = adminClient
          .from("question_logs")
          .select(LEGACY_COLUMNS)
          .eq("store_id", storeAuth.storeId)
          .eq("status", PENDING_QUESTION_STATUS)
          .order("created_at", { ascending: false })
          .limit(limit);

        const { data: legacyData, error: legacyError } = await legacyQuery;
        if (legacyError) {
          logSafePendingQuestionError("QUESTION_LOG_QUERY_FAILED", legacyError);
          return failedPendingQuestionsResult();
        }

        const legacyRepeatCounts = await fetchRecentRepeatCounts(adminClient, storeAuth.storeId);
        if (!legacyRepeatCounts) return failedPendingQuestionsResult();

        let parsedLegacy = toPendingQuestions((legacyData ?? []) as QuestionLogRow[], storeAuth.storeId, legacyRepeatCounts);

        // 하이라이트 대상 질문이 조회 목록에 없으면 단건 추가 조회
        if (highlightId && !parsedLegacy.some((q) => q.id === highlightId)) {
          const { data: legacyHighlight, error: legacyHighlightError } = await adminClient
            .from("question_logs")
            .select(LEGACY_COLUMNS)
            .eq("id", highlightId)
            .eq("store_id", storeAuth.storeId)
            .eq("status", PENDING_QUESTION_STATUS)
            .maybeSingle<QuestionLogRow>();

          if (!legacyHighlightError && legacyHighlight) {
            const parsedHighlight = toPendingQuestions([legacyHighlight], storeAuth.storeId, legacyRepeatCounts);
            if (parsedHighlight.length > 0) {
              parsedLegacy = [parsedHighlight[0], ...parsedLegacy];
            }
          }
        }

        return successfulPendingQuestionsResult(parsedLegacy, limit, false);
      }

      logSafePendingQuestionError("QUESTION_LOG_QUERY_FAILED", error);
      return failedPendingQuestionsResult();
    }

    const repeatCounts = await fetchRecentRepeatCounts(adminClient, storeAuth.storeId);
    if (!repeatCounts) return failedPendingQuestionsResult();

    let parsedQuestions = toPendingQuestions((data ?? []) as QuestionLogRow[], storeAuth.storeId, repeatCounts);

    // 하이라이트 대상 질문이 resolved이거나 20건 범위 밖이어서 목록에 없는 경우:
    // 해당 매장 점주 권한(store_id = storeAuth.storeId)으로 단건 조회하여 목록 맨 앞에 포함한다.
    // 타 매장 질문은 store_id 조건으로 인해 조회되지 않으며, 질문 상태나 알림 읽음 상태는 변경하지 않는다.
    if (highlightId && !parsedQuestions.some((q) => q.id === highlightId)) {
      const { data: highlightData, error: highlightError } = await adminClient
        .from("question_logs")
        .select(COLUMNS)
        .eq("id", highlightId)
        .eq("store_id", storeAuth.storeId)
        .eq("status", PENDING_QUESTION_STATUS)
        .maybeSingle<QuestionLogRow>();

      if (!highlightError && highlightData) {
        const parsedHighlight = toPendingQuestions([highlightData], storeAuth.storeId, repeatCounts);
        if (parsedHighlight.length > 0) {
          parsedQuestions = [parsedHighlight[0], ...parsedQuestions];
        }
      }
    }

    return successfulPendingQuestionsResult(parsedQuestions, limit, true);
  } catch (e) {
    logSafePendingQuestionError("QUESTION_LOG_QUERY_FAILED", e);
    return failedPendingQuestionsResult();
  }
}

export interface UpdateQuestionResolutionInput {
  userId: string;
  questionLogId: string;
  nextStatus: QuestionResolutionStatus;
  currentStatus?: QuestionResolutionStatus;
  currentRevision?: number;
}

export type UpdateQuestionResolutionResult =
  | {
      status: 200;
      body: {
        success: true;
        data: {
          id: string;
          resolutionStatus: QuestionResolutionStatus;
          resolutionRevision: number;
          resolutionUpdatedAt: string | null;
          resolutionUpdatedBy: string | null;
          resolvedAt: string | null;
          resolvedBy: string | null;
        };
      };
    }
  | {
      status: 400 | 401 | 403 | 404 | 409 | 500;
      body: { success: false; error: string; code?: string };
    };

/**
 * 점주가 insufficient 질문의 처리 상태(open/in_progress/resolved)를 변경한다.
 *
 * 1) 세션 사용자 인증 (호출부에서 전달)
 * 2) question_logs 조회: 존재하는지, status === 'insufficient' 인지 확인 (answered/cautious 거절)
 * 3) 실제 question_logs.store_id로 requireStoreOwner 검증 (body의 storeId/userId를 절대 신뢰하지 않음)
 * 4) 이미 같은 상태인 경우: revision 일치 여부 확인 후 불필요한 write 없이 200 멱등 성공 반환
 * 5) 동시성 제어: 클라이언트가 보낸 currentRevision/currentStatus와 현재 DB 상태가 불일치하면 409 CONFLICT 반환
 * 6) DB 업데이트 (resolution_status, resolution_revision + 1, resolution_updated_at, resolution_updated_by, resolved_at/by)
 * 7) 031 미적용 DB에서는 명확한 준비 중 에러(400, RESOLUTION_FEATURE_UNAVAILABLE) 반환
 */
export async function updateQuestionResolutionStatusForOwner(
  adminClient: SupabaseClient,
  input: UpdateQuestionResolutionInput,
): Promise<UpdateQuestionResolutionResult> {
  const { userId, questionLogId, nextStatus, currentStatus, currentRevision } = input;

  if (!questionLogId || typeof questionLogId !== "string" || !questionLogId.trim()) {
    return { status: 400, body: { success: false, error: "질문 ID가 올바르지 않습니다." } };
  }

  if (!isQuestionResolutionStatus(nextStatus)) {
    return { status: 400, body: { success: false, error: "올바른 처리 상태를 지정해 주세요." } };
  }

  // 1) 대상 질문 로그 조회
  let logRow: QuestionLogRow | null = null;
  try {
    const { data, error } = await adminClient
      .from("question_logs")
      .select("id, status, store_id, resolution_status, resolution_revision, resolution_updated_at, resolution_updated_by, resolved_at, resolved_by")
      .eq("id", questionLogId.trim())
      .maybeSingle<QuestionLogRow>();

    if (error) {
      if (isMissingResolutionColumnError(error)) {
        return {
          status: 400,
          body: {
            success: false,
            code: "RESOLUTION_FEATURE_UNAVAILABLE",
            error: "질문 처리 상태 관리 기능이 아직 준비 중입니다. 관리자에게 문의해 주세요.",
          },
        };
      }
      logSafePendingQuestionError("QUESTION_LOG_LOOKUP_FAILED", error);
      return { status: 500, body: { success: false, error: "질문을 확인하지 못했습니다." } };
    }
    logRow = data;
  } catch (e) {
    logSafePendingQuestionError("QUESTION_LOG_LOOKUP_FAILED", e);
    return { status: 500, body: { success: false, error: "질문을 확인하지 못했습니다." } };
  }

  if (!logRow) {
    return { status: 404, body: { success: false, error: "질문 로그를 찾을 수 없습니다." } };
  }

  // 2) insufficient 질문에만 처리 상태를 사용한다
  if (logRow.status !== PENDING_QUESTION_STATUS) {
    return {
      status: 400,
      body: { success: false, error: "보류된 질문만 처리 상태를 변경할 수 있습니다." },
    };
  }

  if (typeof logRow.store_id !== "string" || !logRow.store_id) {
    return {
      status: 403,
      body: { success: false, error: "매장 정보가 없는 질문은 처리할 수 없습니다." },
    };
  }

  // 3) question_logs.store_id 기준으로 requireStoreOwner 권한 검증
  let storeAuth;
  try {
    storeAuth = await requireStoreOwner(adminClient, userId, logRow.store_id);
  } catch (e) {
    logSafePendingQuestionError("OWNER_CHECK_FAILED", e);
    return { status: 500, body: { success: false, error: "권한을 확인하지 못했습니다." } };
  }

  if (!storeAuth) {
    return {
      status: 403,
      body: { success: false, error: "이 매장의 질문 상태를 변경할 권한이 없습니다." },
    };
  }

  const existingResolution: QuestionResolutionStatus = isQuestionResolutionStatus(logRow.resolution_status)
    ? logRow.resolution_status
    : "open";
  const existingRevision: number = typeof logRow.resolution_revision === "number"
    ? logRow.resolution_revision
    : 1;

  // 4) 같은 상태로의 반복 요청 (멱등성 처리)
  if (existingResolution === nextStatus) {
    // 같은 상태라도 클라이언트의 revision이 오래되었으면(다른 상태를 거쳐 다시 온 경우) 충돌로 처리
    if (currentRevision !== undefined && currentRevision !== existingRevision) {
      return {
        status: 409,
        body: {
          success: false,
          code: "RESOLUTION_STATUS_CONFLICT",
          error: "다른 관리자에 의해 질문 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
        },
      };
    }

    return {
      status: 200,
      body: {
        success: true,
        data: {
          id: String(logRow.id),
          resolutionStatus: existingResolution,
          resolutionRevision: existingRevision,
          resolutionUpdatedAt: typeof logRow.resolution_updated_at === "string" ? logRow.resolution_updated_at : null,
          resolutionUpdatedBy: typeof logRow.resolution_updated_by === "string" ? logRow.resolution_updated_by : null,
          resolvedAt: typeof logRow.resolved_at === "string" ? logRow.resolved_at : null,
          resolvedBy: typeof logRow.resolved_by === "string" ? logRow.resolved_by : null,
        },
      },
    };
  }

  // 5) 동시성 제어: revision 또는 status 불일치 시 409
  if (currentRevision !== undefined && currentRevision !== existingRevision) {
    return {
      status: 409,
      body: {
        success: false,
        code: "RESOLUTION_STATUS_CONFLICT",
        error: "다른 관리자에 의해 질문 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
      },
    };
  }

  if (currentStatus && isQuestionResolutionStatus(currentStatus) && existingResolution !== currentStatus) {
    return {
      status: 409,
      body: {
        success: false,
        code: "RESOLUTION_STATUS_CONFLICT",
        error: "다른 관리자에 의해 질문 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
      },
    };
  }

  // 6) 업데이트 수행
  const now = new Date().toISOString();
  const nextRevision = existingRevision + 1;
  const isResolving = nextStatus === "resolved";

  try {
    const updatePayload = {
      resolution_status: nextStatus,
      resolution_revision: nextRevision,
      resolution_updated_at: now,
      resolution_updated_by: userId,
      resolved_at: isResolving ? now : null,
      resolved_by: isResolving ? userId : null,
    };

    const updateQuery = adminClient
      .from("question_logs")
      .update(updatePayload)
      .eq("id", logRow.id)
      .eq("store_id", storeAuth.storeId)
      .eq("status", PENDING_QUESTION_STATUS)
      .eq("resolution_revision", existingRevision);

    const { data: updated, error: updateError } = await updateQuery
      .select("id, resolution_status, resolution_revision, resolution_updated_at, resolution_updated_by, resolved_at, resolved_by")
      .maybeSingle<QuestionLogRow>();

    if (updateError) {
      if (isMissingResolutionColumnError(updateError)) {
        return {
          status: 400,
          body: {
            success: false,
            code: "RESOLUTION_FEATURE_UNAVAILABLE",
            error: "질문 처리 상태 관리 기능이 아직 준비 중입니다. 관리자에게 문의해 주세요.",
          },
        };
      }
      logSafePendingQuestionError("QUESTION_LOG_UPDATE_FAILED", updateError);
      return { status: 500, body: { success: false, error: "처리 상태를 변경하지 못했습니다." } };
    }

    if (!updated) {
      return {
        status: 409,
        body: {
          success: false,
          code: "RESOLUTION_STATUS_CONFLICT",
          error: "다른 관리자에 의해 질문 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
        },
      };
    }

    return {
      status: 200,
      body: {
        success: true,
        data: {
          id: String(updated.id),
          resolutionStatus: nextStatus,
          resolutionRevision: nextRevision,
          resolutionUpdatedAt: now,
          resolutionUpdatedBy: userId,
          resolvedAt: isResolving ? now : null,
          resolvedBy: isResolving ? userId : null,
        },
      },
    };
  } catch (e) {
    logSafePendingQuestionError("QUESTION_LOG_UPDATE_FAILED", e);
    return { status: 500, body: { success: false, error: "처리 상태를 변경하지 못했습니다." } };
  }
}

// 고정 오류 코드와 안전한 error name만 남기고 질문 본문·UUID는 출력하지 않는다.
function logSafePendingQuestionError(code: string, error: unknown): void {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(`[BOSS_QUESTION_LOGS] ${code}`, { name });
}
