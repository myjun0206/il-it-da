"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Check, Store } from "lucide-react";
import type { StaffStore } from "@/lib/staff/approved-stores";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";

interface StoreSelectorProps {
  /** 승인된 근무 매장 목록 */
  stores: StaffStore[];
  /** 현재 기본 매장 ID */
  defaultStoreId: string | null;
  /** 로딩 중 여부 */
  isStoresLoading?: boolean;
  /** 기본 매장 변경 핸들러 */
  onSetDefaultStore?: (storeId: string) => Promise<void>;
}

export default function StoreSelector({
  stores,
  defaultStoreId,
  isStoresLoading = false,
  onSetDefaultStore,
}: StoreSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  const currentStore = stores.find((s) => s.id === defaultStoreId);
  const hasMultipleStores = stores.length > 1;

  const handleSelectStore = async (storeId: string) => {
    if (!onSetDefaultStore || isSettingDefault || isStoresLoading) return;
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
      {/* 헤더 버튼: 현재 기본 매장 표시 */}
      <button
        type="button"
        onClick={() => hasMultipleStores && setIsOpen((prev) => !prev)}
        disabled={isStoresLoading || isSettingDefault || !hasMultipleStores}
        aria-haspopup={hasMultipleStores ? "menu" : undefined}
        aria-expanded={isOpen}
        aria-controls={hasMultipleStores ? "store-selector-menu" : undefined}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg transition-colors
          ${hasMultipleStores ? "hover:bg-[var(--color-primary-light)]/10 cursor-pointer" : "cursor-default"}
          focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]
        `}
      >
        {/* 매장명 */}
        <span className="max-w-[200px] text-sm font-medium text-[var(--color-text-primary)] truncate">
          {isStoresLoading ? "매장 불러오는 중..." : currentStore ? formatStoreDisplayName(currentStore.name) : ""}
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
          aria-label="기본 매장 선택"
          className="absolute right-0 top-full z-50 mt-2 w-[280px] rounded-xl border border-[var(--color-border)] bg-white shadow-md overflow-hidden"
        >
          {/* 헤더: "기본 매장" 라벨 */}
          <div className="px-3 py-3 border-b border-[var(--color-border)]">
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">기본 매장</p>
          </div>

          {/* 매장 목록 */}
          <div className="max-h-[320px] overflow-y-auto">
            {stores.map((store) => {
              const isSelected = store.id === defaultStoreId;
              return (
                <button
                  key={store.id}
                  type="button"
                  onClick={() => void handleSelectStore(store.id)}
                  disabled={isStoresLoading || isSettingDefault}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-primary-light)]/10 transition-colors text-left disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="w-5 flex-shrink-0 flex items-center justify-center">
                    <Check
                      size={16}
                      className={`${isSelected ? "text-[var(--color-primary)]" : "text-transparent"}`}
                      strokeWidth={2.5}
                      aria-hidden="true"
                    />
                  </div>
                  <span className="flex-1 break-keep">{formatStoreDisplayName(store.name)}</span>
                </button>
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
