/**
 * /boss/questions 화면의 순수 로직 (매장 선택 대조, 응답 분류, 매장별 상태 격리).
 * 브라우저·Supabase 없이 단위 테스트할 수 있도록 fetch나 storage를 직접 쓰지 않는다.
 */
import type { OwnerStore } from "@/lib/owner/current-store";
import type { PendingQuestion } from "@/lib/owner/pending-questions";

export const BOSS_QUESTIONS_PATH = "/boss/questions";
export const HIGHLIGHT_QUESTION_PARAM = "questionId";

export function buildBossQuestionsUrl(storeId: string): string {
  return `${BOSS_QUESTIONS_PATH}?storeId=${encodeURIComponent(storeId)}`;
}

export function buildBossQuestionDetailUrl(questionId: string, storeId: string): string {
  return `${BOSS_QUESTIONS_PATH}/${encodeURIComponent(questionId)}?storeId=${encodeURIComponent(storeId)}`;
}

export const BOSS_REPEATED_QUESTIONS_PATH = "/boss/questions/repeated";

export function buildBossRepeatedQuestionsUrl(storeId: string, alertId: string): string {
  return `${BOSS_REPEATED_QUESTIONS_PATH}?storeId=${encodeURIComponent(storeId)}&alertId=${encodeURIComponent(alertId)}`;
}

export type QuestionsStoreChoice = {
  store: OwnerStore | null;
  /** URL로 요청된 매장이 승인된 점주 매장 목록에 없어 무시했는지. */
  requestedStoreRejected: boolean;
};

/**
 * URL의 storeId는 힌트일 뿐이다. 승인된 점주 매장 목록(resolveOwnerCurrentStore 결과)에
 * 있을 때만 채택하고, 없으면 기존 현재 매장을 유지한다. 최종 권한은 서버 API가 다시 검증한다.
 */
export function pickQuestionsStore(
  stores: readonly OwnerStore[],
  current: OwnerStore | null,
  requestedStoreId: string | null | undefined,
): QuestionsStoreChoice {
  const requested = requestedStoreId?.trim();

  if (!requested) {
    return { store: current, requestedStoreRejected: false };
  }

  const matched = stores.find((store) => store.storeId === requested);

  if (matched) {
    return { store: matched, requestedStoreRejected: false };
  }

  return { store: current, requestedStoreRejected: true };
}

export type QuestionsLoadState =
  | { kind: "loading"; storeId: string }
  | {
      kind: "ready";
      storeId: string;
      questions: PendingQuestion[];
      resolutionFeatureAvailable: boolean;
    }
  | { kind: "forbidden"; storeId: string }
  | { kind: "error"; storeId: string };

type PendingQuestionsBody = {
  success?: unknown;
  data?: {
    questions?: unknown;
    resolutionFeatureAvailable?: unknown;
  } | null;
};

function isPendingQuestion(value: unknown): value is PendingQuestion {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  // 031 미적용 응답에는 resolutionStatus가 없을 수 있어 open으로 본다.
  const resolutionStatus = row.resolutionStatus === null
    ? null
    : typeof row.resolutionStatus === "string"
      ? row.resolutionStatus
      : "open";
  const isKnownQuestionStatus = row.status === "answered" || row.status === "cautious" || row.status === "insufficient";
  return typeof row.id === "string"
    && typeof row.question === "string"
    && typeof row.createdAt === "string"
    && isKnownQuestionStatus
    && (resolutionStatus === null || resolutionStatus === "open" || resolutionStatus === "in_progress" || resolutionStatus === "resolved")
    && (row.originReason === "manual_gap" || row.originReason === "frequent_question")
    && typeof row.repeatCount === "number"
    && Number.isInteger(row.repeatCount)
    && row.repeatCount >= 1;
}

/** GET /api/boss/question-logs 응답을 화면 상태로 분류한다. 401/403은 권한 오류로 구분한다. */
export function classifyPendingQuestionsResponse(
  storeId: string,
  httpStatus: number,
  body: unknown,
): QuestionsLoadState {
  if (httpStatus === 401 || httpStatus === 403) {
    return { kind: "forbidden", storeId };
  }

  const parsed = (body ?? {}) as PendingQuestionsBody;
  const questions = parsed.data?.questions;

  if (httpStatus !== 200 || parsed.success !== true || !Array.isArray(questions)) {
    return { kind: "error", storeId };
  }

  const resolutionFeatureAvailable =
    typeof parsed.data?.resolutionFeatureAvailable === "boolean"
      ? parsed.data.resolutionFeatureAvailable
      : true;

  return {
    kind: "ready",
    storeId,
    questions: questions.filter(isPendingQuestion),
    resolutionFeatureAvailable,
  };
}

/** 현재 선택 매장과 다른 매장의 결과는 절대 보여주지 않고 로딩으로 취급한다. */
export function visibleQuestionsState(
  state: QuestionsLoadState | null,
  selectedStoreId: string,
): QuestionsLoadState {
  if (!state || state.storeId !== selectedStoreId) {
    return { kind: "loading", storeId: selectedStoreId };
  }
  return state;
}
