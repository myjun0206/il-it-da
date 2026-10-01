import type { ReactNode } from "react";
import { CheckCircle2, Clock3, XCircle, type LucideIcon } from "lucide-react";

// 신청·승인 결과 화면 공통 UI (회원가입 완료, 매장 신청 완료, 신청 현황 등).
// 구조: 상태 아이콘 → 제목 → 설명 → 관련 정보(children) → 다음 행동(actions)
// 상태별 색상/아이콘은 이 파일 한 곳에서 정한다. 표시만 담당하며 상태 값은 항상 실제 데이터에서 온다.

/** 신청(membership) 상태 */
export type RequestStatus = "pending" | "approved" | "rejected";

/** 결과 화면 톤: success = 신청/가입 완료, 나머지는 신청 상태와 동일 */
export type ResultTone = "success" | RequestStatus;

const TONE_STYLE: Record<ResultTone, { Icon: LucideIcon; circle: string; text: string; badge: string }> = {
  success: {
    Icon: CheckCircle2,
    circle: "bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]",
    text: "text-[var(--color-primary)]",
    badge: "bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]",
  },
  approved: {
    Icon: CheckCircle2,
    circle: "bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]",
    text: "text-[var(--color-primary)]",
    badge: "bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]",
  },
  pending: {
    Icon: Clock3,
    circle: "bg-amber-50 text-amber-700",
    text: "text-amber-800",
    badge: "bg-amber-50 text-amber-800",
  },
  rejected: {
    Icon: XCircle,
    circle: "bg-red-50 text-red-700",
    text: "text-red-700",
    badge: "bg-red-50 text-red-700",
  },
};

const DEFAULT_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "승인 대기",
  approved: "승인 완료",
  rejected: "신청 반려",
};

export function isRequestStatus(value: unknown): value is RequestStatus {
  return value === "pending" || value === "approved" || value === "rejected";
}

/** 신청 상태 배지: 색상만이 아니라 아이콘 + 문구로 구분한다. */
export function RequestStatusBadge({ status, label }: { status: RequestStatus; label?: string }) {
  const { Icon, badge } = TONE_STYLE[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-sm font-medium ${badge}`}>
      <Icon size={14} aria-hidden="true" />
      {label ?? DEFAULT_STATUS_LABEL[status]}
    </span>
  );
}

interface ResultPanelProps {
  tone: ResultTone;
  title: string;
  description?: ReactNode;
  /** 관련 정보 (예: 신청한 매장 카드) */
  children?: ReactNode;
  /** 다음 행동 버튼/링크 */
  actions?: ReactNode;
  /** 제목 id (aria-labelledby 연결용) */
  titleId?: string;
  /** 카드 테두리 없이 내용만 쓸 때 (이미 카드 안에 있는 화면) */
  bare?: boolean;
}

export default function ResultPanel({ tone, title, description, children, actions, titleId = "result-panel-title", bare = false }: ResultPanelProps) {
  const { Icon, circle } = TONE_STYLE[tone];
  return (
    <section
      role="status"
      aria-labelledby={titleId}
      className={bare ? "w-full" : "w-full rounded-xl border border-[var(--color-border)] bg-white p-6 sm:p-8"}
    >
      <div className="mx-auto flex w-full max-w-xl flex-col items-center text-center">
        <span className={`flex h-14 w-14 items-center justify-center rounded-full ${circle}`}>
          <Icon size={28} aria-hidden="true" />
        </span>
        <h2 id={titleId} className="mt-4 text-xl font-bold text-[var(--color-text-primary)] break-keep">
          {title}
        </h2>
        {description && <div className="mt-2 text-base text-[var(--color-text-secondary)] break-keep">{description}</div>}
      </div>

      {children && <div className="mx-auto mt-6 w-full max-w-xl text-left">{children}</div>}
      {actions && <div className="mx-auto mt-6 w-full max-w-xl">{actions}</div>}
    </section>
  );
}
