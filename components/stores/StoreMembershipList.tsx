import type { ReactNode } from "react";
import { CheckCircle2, Clock3, Store as StoreIcon, Check } from "lucide-react";

import { formatStoreDisplayName } from "@/lib/stores/search-stores";
import { StoreMenu } from "@/components/common/StoreMenu";

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
  storeId: string;
  storeName: string;
  isCurrent: boolean;
  onSetAsDefault?: () => void;
  onRemoveStart?: () => void;
  onRemoveCancel?: () => void;
}

/** 승인된 매장 행: 왼쪽 매장명, 오른쪽 기본매장버튼/상태 + 더보기메뉴 */
export function ApprovedStoreRow({
  storeId,
  storeName,
  isCurrent,
  onSetAsDefault,
  onRemoveStart,
  onRemoveCancel,
}: ApprovedRowProps) {
  // 더보기 메뉴 액션
  const menuActions = onRemoveStart
    ? [
        {
          label: isCurrent ? "기본 매장 변경 필요" : "근무 종료",
          destructive: true,
          onClick: onRemoveStart,
        },
      ]
    : [];

  return (
    <li
      className={`flex items-center justify-between gap-4 px-5 py-4 ${
        isCurrent ? "bg-[var(--color-primary)]/8 border-l-4 border-[var(--color-primary)]" : ""
      }`}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <StoreIcon size={20} className="shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
        <p className="truncate text-base font-semibold text-[var(--color-text-primary)]">
          {formatStoreDisplayName(storeName)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* 기본 매장 버튼: 크기 고정 */}
        <div className="inline-flex min-h-[44px] min-w-max items-center">
          {isCurrent ? (
            <div className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border-2 border-[var(--color-primary)]/20 bg-[var(--color-primary)]/5">
              <Check size={16} className="text-[var(--color-primary)] flex-shrink-0" aria-hidden="true" />
              <span className="text-sm font-medium text-[var(--color-primary)] whitespace-nowrap">기본 매장</span>
            </div>
          ) : onSetAsDefault ? (
            <button
              type="button"
              onClick={onSetAsDefault}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border-2 border-[var(--color-primary)] bg-white text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 transition-colors whitespace-nowrap"
            >
              기본 매장으로 설정
            </button>
          ) : null}
        </div>

        {/* 더보기 메뉴 */}
        {menuActions.length > 0 && (
          <StoreMenu actions={menuActions} ariaLabel="근무 매장 관리 메뉴" />
        )}
      </div>
    </li>
  );
}

interface PendingRowProps {
  storeName: string;
  /** 예: "점주 승인 대기" / "본사 승인 대기" */
  waitingLabel: string;
  requestedAt?: string;
  onCancelStart?: () => void;
}

/** 승인 대기 행: 왼쪽 매장명+신청일, 오른쪽 상태배지 + 더보기메뉴 */
export function PendingStoreRow({ storeName, waitingLabel, requestedAt, onCancelStart }: PendingRowProps) {
  const date = formatRequestDate(requestedAt);

  // 더보기 메뉴 액션
  const menuActions = onCancelStart
    ? [
        {
          label: "신청 취소",
          destructive: true,
          onClick: onCancelStart,
        },
      ]
    : [];

  return (
    <li className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Clock3 size={20} className="shrink-0 text-amber-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-[var(--color-text-primary)]">
            {formatStoreDisplayName(storeName)}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            {date && `${date} 신청`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* 상태 배지 */}
        <StoreStatusBadge tone="pending">{waitingLabel}</StoreStatusBadge>

        {/* 더보기 메뉴 */}
        {menuActions.length > 0 && (
          <StoreMenu actions={menuActions} ariaLabel="신청 관리 메뉴" />
        )}
      </div>
    </li>
  );
}
