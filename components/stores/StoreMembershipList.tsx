import type { ReactNode } from "react";
import { CheckCircle2, Clock3, Store as StoreIcon } from "lucide-react";

import { formatStoreDisplayName } from "@/lib/stores/search-stores";

// 근무/운영 매장 관리 화면(직원 /staff/stores, 점주 /boss/stores) 공통 목록 UI.
// 표시만 담당하며, 어떤 매장을 보여줄지·취소 가능 여부 등 권한 판단은 각 페이지와 서버 API가 한다.

export function formatRequestDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

/** 정보성 배지 (버튼처럼 보이지 않게 soft 스타일) */
export function StoreStatusBadge({ tone, children }: { tone: "current" | "pending"; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        tone === "current"
          ? "border border-[var(--color-primary)]/40 bg-[var(--color-primary-light)]/30 text-[var(--color-primary)]"
          : "bg-amber-50 text-amber-800"
      }`}
    >
      {children}
    </span>
  );
}

/** 섹션 컨테이너: 하나의 테두리 박스 안에서 행을 구분선으로 나눈다. */
export function StoreMembershipList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul
      aria-label={label}
      className="divide-y divide-[var(--color-border)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-white"
    >
      {children}
    </ul>
  );
}

interface ApprovedRowProps {
  storeName: string;
  approvedLabel: string;
  isCurrent: boolean;
}

/** 승인된 매장 행: 매장명 > 승인 상태, 현재 매장에만 배지 */
export function ApprovedStoreRow({ storeName, approvedLabel, isCurrent }: ApprovedRowProps) {
  return (
    <li className="flex items-start gap-3 px-5 py-4">
      <StoreIcon size={20} className="mt-0.5 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-[var(--color-text-primary)]">{formatStoreDisplayName(storeName)}</p>
        <p className="mt-1 flex items-center gap-1 text-sm text-[var(--color-primary)]">
          <CheckCircle2 size={14} aria-hidden="true" /> {approvedLabel}
        </p>
      </div>
      {isCurrent && <StoreStatusBadge tone="current">현재 매장</StoreStatusBadge>}
    </li>
  );
}

interface PendingRowProps {
  storeName: string;
  /** 예: "점주 승인 대기" / "본사 승인 대기" */
  waitingLabel: string;
  requestedAt?: string;
  isCanceling: boolean;
  cancelDisabled: boolean;
  onCancel: () => void;
}

/** 승인 대기 행: 본문에 대기 사유·신청일, 오른쪽에 상태 배지와 작은 텍스트 액션(신청 취소) */
export function PendingStoreRow({ storeName, waitingLabel, requestedAt, isCanceling, cancelDisabled, onCancel }: PendingRowProps) {
  const date = formatRequestDate(requestedAt);
  return (
    <li className="flex items-start gap-3 px-5 py-4">
      <Clock3 size={20} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-[var(--color-text-primary)]">{formatStoreDisplayName(storeName)}</p>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          {waitingLabel}
          {date && ` · ${date} 신청`}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StoreStatusBadge tone="pending">승인 대기</StoreStatusBadge>
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelDisabled}
          className="min-h-[36px] rounded-md px-1.5 text-sm font-medium text-[var(--color-text-secondary)] underline-offset-2 hover:text-red-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-60"
        >
          {isCanceling ? "취소 중..." : "신청 취소"}
        </button>
      </div>
    </li>
  );
}
