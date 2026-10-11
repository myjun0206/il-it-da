"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Check, Store } from "lucide-react";
import type { StaffStore } from "@/lib/staff/approved-stores";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";

interface StoreSelectorProps {
  /** 승인된 근무 매장 목록 */
  stores: StaffStore[];
  /** 현재 탭에서 업무에 사용하는 매장 ID */
  selectedStoreId: string | null;
  /** 계정에 저장된 기본 매장 ID */
  defaultStoreId: string | null;
  /** 로딩 중 여부 */
  isStoresLoading?: boolean;
  /** 탭의 현재 업무 매장만 바꾼다. */
  onSelectStore?: (storeId: string) => void;
  /** 기본 매장 변경 핸들러 */
  onSetDefaultStore?: (storeId: string) => Promise<void>;
}

export default function StoreSelector({
  stores,
  selectedStoreId,
  defaultStoreId,
  isStoresLoading = false,
  onSelectStore,
  onSetDefaultStore,
}: StoreSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  const currentStore = stores.find((s) => s.id === selectedStoreId);
  const hasMultipleStores = stores.length > 1;

  const handleSelectStore = (storeId: string) => {
    if (!onSelectStore || isSettingDefault || isStoresLoading) return;
    onSelectStore(storeId);
    setIsOpen(false);
  };

  const handleSetDefaultStore = async (storeId: string) => {
    if (!onSetDefaultStore || storeId === defaultStoreId || isSettingDefault || isStoresLoading) return;
    setIsSettingDefault(true);
    try {
      await onSetDefaultStore(storeId);
      setIsOpen(false);
    } finally {
      setIsSettingDefault(false);
    }
  };

  // 드롭다운 닫기: 외부 클릭 또는 Escape
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // 매장이 없으면 표시하지 않음
  if (stores.length === 0 && !isStoresLoading) return null;

  return (
    <div ref={selectorRef} className="relative">
      {/* 현재 업무 매장과 계정 기본 매장은 별도로 관리한다. */}
      <button
        type="button"
        onClick={() => hasMultipleStores && setIsOpen((prev) => !prev)}
        disabled={isStoresLoading || isSettingDefault || !hasMultipleStores}
        aria-label={`현재 업무 매장 ${isStoresLoading ? "매장을 불러오는 중" : currentStore ? formatStoreDisplayName(currentStore.name) : "승인된 매장이 없습니다"}`}
        aria-haspopup={hasMultipleStores ? "menu" : undefined}
        aria-expanded={isOpen}
        aria-controls={hasMultipleStores ? "store-selector-menu" : undefined}
        className={`
          flex h-12 max-h-12 min-w-0 items-center gap-2 px-2 py-0 rounded-lg transition-colors
          ${hasMultipleStores ? "hover:bg-[var(--color-primary-light)]/10 cursor-pointer" : "cursor-default"}
          focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]
        `}
      >
        <span className="flex min-w-0 max-w-[180px] flex-col items-start">
          <span className="text-[10px] leading-4 text-[var(--color-text-secondary)]">현재 업무 매장</span>
          <span className="max-w-full truncate text-xs font-medium leading-4 text-[var(--color-text-primary)]">
            {isStoresLoading ? "매장 불러오는 중..." : currentStore ? formatStoreDisplayName(currentStore.name) : "승인된 매장이 없습니다"}
          </span>
        </span>

        {/* Chevron 아이콘: 여러 매장일 때만 표시 */}
        {hasMultipleStores && (
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`text-[var(--color-text-secondary)] transition-transform flex-shrink-0 ${isOpen ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {/* 드롭다운 메뉴: 여러 매장이 있고 열려있을 때만 표시 */}
      {isOpen && hasMultipleStores && (
        <div
          id="store-selector-menu"
          role="menu"
          aria-label="현재 업무 매장 선택"
          className="absolute right-0 top-full z-50 mt-2 w-[300px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-md"
        >
          <div className="px-3 py-3 border-b border-[var(--color-border)]">
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">현재 업무 매장</p>
          </div>

          <div className="max-h-[320px] overflow-y-auto">
            {stores.map((store) => {
              const isSelected = store.id === selectedStoreId;
              const isDefault = store.id === defaultStoreId;
              return (
                <div key={store.id} className="flex items-center gap-1 border-b border-[var(--color-border)]/60 px-2 py-1 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => handleSelectStore(store.id)}
                    disabled={isStoresLoading || isSettingDefault}
                    aria-label={`${formatStoreDisplayName(store.name)} 현재 업무 매장으로 전환`}
                    aria-pressed={isSelected}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-primary-light)]/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="flex w-5 flex-shrink-0 items-center justify-center">
                    <Check
                      size={16}
                      className={`${isSelected ? "text-[var(--color-primary)]" : "text-transparent"}`}
                      strokeWidth={2.5}
                      aria-hidden="true"
                    />
                    </span>
                    <span className="min-w-0 flex-1 truncate break-keep">{formatStoreDisplayName(store.name)}</span>
                    {isSelected && <span className="shrink-0 text-xs text-[var(--color-primary)]">현재</span>}
                  </button>
                  {isDefault ? (
                    <span className="shrink-0 px-2 text-xs text-[var(--color-text-secondary)]">기본 매장</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleSetDefaultStore(store.id)}
                      disabled={isStoresLoading || isSettingDefault || !onSetDefaultStore}
                      aria-label={`${formatStoreDisplayName(store.name)} 기본 매장으로 설정`}
                      className="min-h-11 shrink-0 rounded-lg px-2 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-primary-light)]/10 hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      기본 설정
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Divider */}
          <div className="border-t border-[var(--color-border)]" />

          {/* 매장 관리 링크 */}
          <Link
            href="/staff/stores"
            onClick={() => setIsOpen(false)}
            className="flex h-11 items-center gap-2 px-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-primary-light)]/10 transition-colors"
          >
            <Store size={16} aria-hidden="true" className="text-[var(--color-text-secondary)]" />
            <span className="flex-1">매장 관리</span>
            <ChevronRight size={16} aria-hidden="true" className="text-[var(--color-text-tertiary)]" />
          </Link>
        </div>
      )}
    </div>
  );
}
