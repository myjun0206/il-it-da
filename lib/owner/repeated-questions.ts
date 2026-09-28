/**
 * 반복 질문 탐지·집계 (매뉴얼 개선 제안의 1단계).
 *
 * "답변 불가(insufficient) 1건 -> 점주 확인 요청"은 lib/notifications/escalate-question-log.ts가
 * 담당한다. 이 모듈은 그것과 별개로 "같은 매장에서 같은 질문이 반복된다"를 찾아 집계만 한다.
 * 답변 가능한 질문도 반복될 수 있으므로 상태별 건수를 나눠 담고, 알림은 보내지 않는다.
 *
 * client는 항상 호출부에서 주입한다 - 실제 Supabase 없이 가짜 client로 단위 테스트할 수 있다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeFingerprintText } from "@/lib/manuals/manual-content-fingerprint";

/**
 * PoC 반복 기준. 최근 7일 / 같은 질문 3건 이상.
 *
 * 주의: 이 두 숫자는 실제 질문 분포로 검증한 값이 아니라 **검증 전 가정**이다.
 * 실데이터가 쌓이면 "하루 몇 건이 실제로 반복인가"를 보고 조정해야 한다.
 */
export const REPEATED_QUESTION_WINDOW_DAYS = 7;
export const REPEATED_QUESTION_MIN_COUNT = 3;
export const REPEATED_QUESTION_THRESHOLDS_VALIDATED = false;

/** 한 번에 훑는 로그 상한. 매장 하나의 최근 7일 분량으로 충분하다. */
export const MAX_ANALYZED_QUESTION_LOGS = 500;

export const QUESTION_LOG_STATUSES = ["answered", "cautious", "insufficient"] as const;
export type QuestionLogStatus = (typeof QUESTION_LOG_STATUSES)[number];

/**
 * 끝에서 한 번만 떼어내는 정중체/구어체 어미. 의미를 바꾸지 않는 것만 담는다.
 * 조사 제거·불용어 제거·동의어 확장은 하지 않는다 - 서로 다른 업무 질문이 한 주제로
 * 합쳐지는 쪽이 놓치는 쪽보다 위험하기 때문이다.
 *
 * 부정·금지 표지(안/못/없/말)를 포함한 어미는 여기에 넣지 않는다.
 * 그래야 "해도 돼요"와 "하면 안 돼요"처럼 운영 판단이 반대인 쌍이 같은 키로 합쳐지지 않는다.
 */
const POLITE_ENDINGS = [
  "알려주실래요", "알려주세요", "알려줘요", "알려줘",
  "가르쳐주세요", "가르쳐줘",
  "설명해주세요", "설명해줘",
  "궁금합니다", "궁금해요", "궁금해",
  "해주실래요", "해주세요", "해줘요", "해줘",
  "있습니까", "있을까요", "있나요", "있어요",
  "될까요", "되나요", "돼요", "되요",
  // "인가"(認可)는 영업·출입·건축 인가처럼 명사로 쓰여 떼면 다른 주제가 된다.
  // 정중형 "인가요"만 남긴다("출입인가" -> "출입" 같은 명사 잘림 방지).
  "일까요", "인가요",
  "합니까", "하나요", "할까요",
  "입니까", "입니다",
  "이에요", "예요", "에요",
].sort((a, b) => b.length - a.length);

const EDGE_PUNCTUATION = /^[\s"'“”‘’(\[]+|[\s"'“”‘’)\]?!.,~…]+$/gu;

/** 어미를 떼고 남은 줄기가 이보다 짧으면 떼지 않는다("원인가" -> "원" 같은 과도한 축약 방지). */
const MIN_STEM_LENGTH = 2;

/**
 * 같은 질문인지 판정하는 키를 만든다.
 *
 * 흡수하는 차이: 유니코드 정규화(NFC), 대소문자, 앞뒤/끝 문장부호, 띄어쓰기, 끝의 정중체 어미 1개.
 * 흡수하지 않는 차이: 단어 순서, 조사, 동의어, 의미만 같은 다른 표현.
 * 키가 완전히 같을 때만 같은 주제로 묶으므로, 의미가 같아도 표현이 다르면 따로 집계된다.
 */
export function normalizeRepeatedQuestionKey(question: string): string {
  if (typeof question !== "string") {
    return "";
  }

  const base = normalizeFingerprintText(question)
    .toLocaleLowerCase("ko-KR")
    .replace(EDGE_PUNCTUATION, "")
    .replace(/\s+/gu, "");

  if (!base) {
    return "";
  }

  for (const ending of POLITE_ENDINGS) {
    if (base.length > ending.length && base.endsWith(ending)) {
      const stem = base.slice(0, -ending.length).replace(EDGE_PUNCTUATION, "");
      return stem.length >= MIN_STEM_LENGTH ? stem : base;
    }
  }

  return base;
}

export type QuestionLogRow = {
  id: unknown;
  question: unknown;
  status: unknown;
  store_id: unknown;
  source_manual_id: unknown;
  created_at: unknown;
  [key: string]: unknown;
};

export type StatusCounts = Record<QuestionLogStatus, number>;

/**
 * 세 값 모두 "후보"다. 집계만으로는 원인을 확정할 수 없으므로 점주 검토를 전제로 한다.
 *
 * manual_gap_candidate: 반복된 질문이 대부분 근거를 못 찾았다.
 *   주의: insufficient는 "매뉴얼에 기준이 없다"만 뜻하지 않는다. 검색 실패,
 *   임계값(0.40/0.60) 미달, 임베딩 누락, 질문 표현 차이로도 같은 상태가 나온다.
 * guidance_gap_candidate: 답변은 되는데 계속 묻는다 -> 교육·안내 개선 후보.
 * mixed_candidate: 둘이 섞였다 -> 사람이 직접 봐야 한다.
 */
export type RepeatedQuestionCategory =
  | "manual_gap_candidate"
  | "guidance_gap_candidate"
  | "mixed_candidate";

/** 화면·프롬프트가 제각각 단정적인 문구를 지어내지 않도록 표기를 고정한다. */
export const REPEATED_QUESTION_CATEGORY_LABELS: Record<RepeatedQuestionCategory, string> = {
  manual_gap_candidate: "매뉴얼 공백 후보 (점주 확인 필요)",
  guidance_gap_candidate: "교육·안내 개선 후보 (점주 확인 필요)",
  mixed_candidate: "답변 가능·불가 혼재 (점주 확인 필요)",
};

export interface RepeatedQuestionGroup {
  groupKey: string;
  /** 가장 최근에 실제로 들어온 원문. 정규화된 키가 아니라 사람이 읽는 문장이다. */
  representativeQuestion: string;
  repeatCount: number;
  firstAskedAt: string;
  lastAskedAt: string;
  statusCounts: StatusCounts;
  category: RepeatedQuestionCategory;
  categoryLabel: string;
  /**
   * 로그의 source_manual_id가 하나로 일치할 때만 채운다. 엇갈리면 null이다.
   * "같은 매뉴얼이 근거로 기록됐다"는 사실일 뿐, 그 매뉴얼이 이 질문의 올바른
   * 근거라는 보장이 아니다(유사도가 낮거나 엉뚱한 매뉴얼이 잡혔을 수 있다).
   * 그래서 "확인할 매뉴얼 후보"로만 다룬다.
   */
  candidateManualId: string | null;
}

export interface RepeatedQuestionReport {
  storeId: string;
  windowDays: number;
  minCount: number;
  windowStart: string;
  windowEnd: string;
  /** 기준을 넘기지 못한 질문까지 포함해 실제로 분석한 로그 수. */
  analyzedLogCount: number;
  thresholdsValidated: boolean;
  groups: RepeatedQuestionGroup[];
}

function emptyStatusCounts(): StatusCounts {
  return { answered: 0, cautious: 0, insufficient: 0 };
}

function isQuestionLogStatus(value: unknown): value is QuestionLogStatus {
  return QUESTION_LOG_STATUSES.includes(value as QuestionLogStatus);
}

function classify(counts: StatusCounts, total: number): RepeatedQuestionCategory {
  if (counts.insufficient === 0) {
    return "guidance_gap_candidate";
  }
  return counts.insufficient * 2 > total ? "manual_gap_candidate" : "mixed_candidate";
}

export interface BuildRepeatedQuestionReportOptions {
  /** 호출부가 이미 검증한 매장 id. */
  storeId: string;
  windowDays?: number;
  minCount?: number;
  /** 테스트에서 기준 시각을 고정하기 위한 값. */
  now?: Date;
}

export function buildRepeatedQuestionReport(
  rows: readonly QuestionLogRow[],
  options: BuildRepeatedQuestionReportOptions,
): RepeatedQuestionReport {
  const windowDays = options.windowDays ?? REPEATED_QUESTION_WINDOW_DAYS;
  const minCount = options.minCount ?? REPEATED_QUESTION_MIN_COUNT;
  const windowEnd = options.now ?? new Date();
  const windowStart = new Date(windowEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const base: RepeatedQuestionReport = {
    storeId: options.storeId,
    windowDays,
    minCount,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    analyzedLogCount: 0,
    thresholdsValidated: REPEATED_QUESTION_THRESHOLDS_VALIDATED,
    groups: [],
  };

  if (!options.storeId) {
    return base;
  }

  type Accumulator = {
    groupKey: string;
    representativeQuestion: string;
    representativeAt: number;
    repeatCount: number;
    firstAskedAt: string;
    lastAskedAt: string;
    statusCounts: StatusCounts;
    manualIds: Set<string>;
  };

  const accumulators = new Map<string, Accumulator>();
  let analyzedLogCount = 0;

  for (const row of rows) {
    // 다른 매장과 store_id가 NULL인 022 이전 로그는 여기서 걸러진다.
    if (row.store_id !== options.storeId) continue;
    if (typeof row.question !== "string" || !isQuestionLogStatus(row.status)) continue;
    if (typeof row.created_at !== "string") continue;

    const askedAt = new Date(row.created_at);
    const askedAtMs = askedAt.getTime();
    if (!Number.isFinite(askedAtMs)) continue;
    if (askedAtMs < windowStart.getTime() || askedAtMs > windowEnd.getTime()) continue;

    const groupKey = normalizeRepeatedQuestionKey(row.question);
    if (!groupKey) continue;

    const displayQuestion = normalizeFingerprintText(row.question);
    if (!displayQuestion) continue;

    analyzedLogCount += 1;

    const current = accumulators.get(groupKey) ?? {
      groupKey,
      representativeQuestion: displayQuestion,
      representativeAt: askedAtMs,
      repeatCount: 0,
      firstAskedAt: row.created_at,
      lastAskedAt: row.created_at,
      statusCounts: emptyStatusCounts(),
      manualIds: new Set<string>(),
    };

    current.repeatCount += 1;
    current.statusCounts[row.status] += 1;

    if (askedAtMs >= current.representativeAt) {
      current.representativeQuestion = displayQuestion;
      current.representativeAt = askedAtMs;
      current.lastAskedAt = row.created_at;
    }
    if (askedAtMs < new Date(current.firstAskedAt).getTime()) {
      current.firstAskedAt = row.created_at;
    }
    if (typeof row.source_manual_id === "string" && row.source_manual_id.trim()) {
      current.manualIds.add(row.source_manual_id.trim());
    }

    accumulators.set(groupKey, current);
  }

  const groups = [...accumulators.values()]
    .filter((item) => item.repeatCount >= minCount)
    .map<RepeatedQuestionGroup>((item) => {
      const category = classify(item.statusCounts, item.repeatCount);
      return {
        groupKey: item.groupKey,
        representativeQuestion: item.representativeQuestion,
        repeatCount: item.repeatCount,
        firstAskedAt: item.firstAskedAt,
        lastAskedAt: item.lastAskedAt,
        statusCounts: item.statusCounts,
        category,
        categoryLabel: REPEATED_QUESTION_CATEGORY_LABELS[category],
        // 근거가 엇갈리면 "확인된 후보 없음"으로 둔다. 추측한 매뉴얼을 AI에 넘기지 않기 위함이다.
        candidateManualId: item.manualIds.size === 1 ? [...item.manualIds][0] : null,
      };
    })
    .sort((a, b) =>
      b.repeatCount - a.repeatCount
      || b.lastAskedAt.localeCompare(a.lastAskedAt)
      || a.groupKey.localeCompare(b.groupKey));

  return { ...base, analyzedLogCount, groups };
}

export type FetchRepeatedQuestionsResult =
  | { status: "ok"; report: RepeatedQuestionReport }
  | { status: "invalid_store" }
  | { status: "failed" };

export interface FetchRepeatedQuestionsInput {
  /** 호출부가 이미 검증한 매장 id. */
  storeId: string;
  windowDays?: number;
  minCount?: number;
  now?: Date;
}

export async function fetchRepeatedQuestionsForStore(
  client: SupabaseClient,
  input: FetchRepeatedQuestionsInput,
): Promise<FetchRepeatedQuestionsResult> {
  const storeId = input.storeId?.trim();

  if (!storeId) {
    return { status: "invalid_store" };
  }

  const windowDays = input.windowDays ?? REPEATED_QUESTION_WINDOW_DAYS;
  const windowEnd = input.now ?? new Date();
  const windowStart = new Date(windowEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);

  try {
    const { data, error } = await client
      .from("question_logs")
      .select("id, question, status, store_id, source_manual_id, created_at")
      .eq("store_id", storeId)
      .gte("created_at", windowStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(MAX_ANALYZED_QUESTION_LOGS);

    if (error) {
      logSafeRepeatedQuestionError("QUESTION_LOG_QUERY_FAILED", error);
      return { status: "failed" };
    }

    return {
      status: "ok",
      report: buildRepeatedQuestionReport((data ?? []) as QuestionLogRow[], {
        storeId,
        windowDays,
        minCount: input.minCount,
        now: windowEnd,
      }),
    };
  } catch (e) {
    logSafeRepeatedQuestionError("QUESTION_LOG_QUERY_FAILED", e);
    return { status: "failed" };
  }
}

/**
 * 나중에 AI에게 넘길 입력의 데이터 계약.
 *
 * 개별 질문 원문을 전부 넘기지 않고 대표 질문 1개와 집계 수치만 넘긴다.
 * category는 확정이 아니라 후보이고, manualToVerify는 "확인할 매뉴얼 후보"일 뿐이다.
 * 출력은 언제나 점주 검토 전 초안이다.
 */
export interface ManualImprovementDraftInput {
  reviewStatus: "draft_pending_owner_review";
  storeId: string;
  representativeQuestion: string;
  repeatCount: number;
  window: { days: number; firstAskedAt: string; lastAskedAt: string };
  statusCounts: StatusCounts;
  category: RepeatedQuestionCategory;
  categoryLabel: string;
  /**
   * 로그에 같은 출처로 기록된 매뉴얼. 이 질문의 올바른 근거라는 보장이 아니므로
   * "확인할 후보"로만 쓴다. null이면 확인할 후보조차 없다는 뜻이다.
   */
  manualToVerify: { manualId: string } | null;
  constraints: readonly string[];
}

export const MANUAL_IMPROVEMENT_DRAFT_CONSTRAINTS = [
  "승인된 매뉴얼에 없는 운영 기준·수치·기한을 새로 만들지 않는다.",
  "category는 집계에서 나온 후보이지 원인 확정이 아니다. 반복된 insufficient는 매뉴얼에 기준이 없다는 뜻일 수도 있지만, 검색 실패·임계값 미달·임베딩 누락 때문일 수도 있다.",
  "manualToVerify는 로그에 같은 출처로 기록됐다는 사실일 뿐 올바른 근거라는 보장이 아니다. 매뉴얼 본문과 질문이 실제로 맞는지 점주가 확인해야 한다.",
  "manualToVerify가 null이면 개정안을 쓰지 말고 점주가 확인해야 할 항목만 제시한다.",
  "출력은 점주 검토 전 초안이며, 그대로 매뉴얼에 반영되지 않는다.",
  "직원 개인이나 특정 고객을 추측해 언급하지 않는다.",
] as const;

export function toManualImprovementDraftInput(
  group: RepeatedQuestionGroup,
  report: Pick<RepeatedQuestionReport, "storeId" | "windowDays">,
): ManualImprovementDraftInput {
  return {
    reviewStatus: "draft_pending_owner_review",
    storeId: report.storeId,
    representativeQuestion: group.representativeQuestion,
    repeatCount: group.repeatCount,
    window: {
      days: report.windowDays,
      firstAskedAt: group.firstAskedAt,
      lastAskedAt: group.lastAskedAt,
    },
    statusCounts: group.statusCounts,
    category: group.category,
    categoryLabel: group.categoryLabel,
    manualToVerify: group.candidateManualId ? { manualId: group.candidateManualId } : null,
    constraints: MANUAL_IMPROVEMENT_DRAFT_CONSTRAINTS,
  };
}

// 고정 오류 코드와 안전한 error name만 남기고 질문 본문·UUID는 출력하지 않는다.
function logSafeRepeatedQuestionError(code: string, error: unknown): void {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(`[REPEATED_QUESTIONS] ${code}`, { name });
}
