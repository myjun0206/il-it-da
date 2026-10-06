"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Clock3, Settings, Store } from "lucide-react";

/** 선택 가능한(승인된) 매장 */
export interface SwitcherStore {
  id: string;
  name: string;
}

interface StoreSwitcherProps {
  /** 승인(approved)된 매장만 전달한다. 승인 대기 매장은 선택지에 넣지 않는다. */
  stores: SwitcherStore[];
  /** 예: "현재 근무 매장"(직원) / "현재 운영 매장"(점주) */
  label: string;
  /** 예: "근무 매장 관리" / "운영 매장 관리" */
  manageLabel: string;
  /** 승인 대기 신청 수 (선택 불가, 근무 매장 관리로 안내만 한다) */
  pendingCount: number;
  selectedStoreId: string | null;
  isLoading: boolean;
  disabled?: boolean;
  onSelect: (storeId: string) => void;
  /** 매장 관리 화면(/staff/stores, /boss/stores)으로 이동 */
  onManageStores: () => void;
  /** 헤더용: 라벨은 스크린리더 전용, 직원 Header의 매장 표시와 같은 텍스트형 버튼과 우측 정렬 메뉴를 쓴다. */
  compact?: boolean;
}

/**
 * "현재 매장" 빠른 전환 (WAI-ARIA listbox 패턴). 직원/점주 공통 UI.
 * 승인된 매장만 선택 가능하고, 소속/신청 관리는 각 역할의 매장 관리 페이지로 연결한다.
 * 권한 검증은 하지 않는다(각 API가 서버에서 approved membership을 검증).
 */
export default function StoreSwitcher({
  stores,
  label,
  manageLabel,
  pendingCount,
  selectedStoreId,
  isLoading,
  disabled = false,
  onSelect,
  onManageStores,
  compact = false,
}: StoreSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const labelId = `${baseId}-label`;

  const selectedStore = stores.find((store) => store.id === selectedStoreId) ?? null;

  const buttonText = isLoading
    ? "매장을 불러오는 중..."
    : selectedStore
      ? selectedStore.name
      : stores.length > 0
        ? "매장을 선택해 주세요"
        : "승인된 매장이 없습니다";

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const open = () => {
    if (disabled || isLoading) return;
    const selectedIndex = stores.findIndex((store) => store.id === selectedStoreId);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : stores.length > 0 ? 0 : -1);
    setIsOpen(true);
    requestAnimationFrame(() => listRef.current?.focus());
  };

  const close = (restoreFocus = true) => {
    setIsOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  const choose = (index: number) => {
    const store = stores[index];
    if (!store) return;
    onSelect(store.id);
    close();
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(stores.length - 1, index + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(stores.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        setIsOpen(false);
        break;
    }
  };

  return (
    <div ref={containerRef} className={compact ? "relative min-w-0" : "relative"}>
      <span
        id={labelId}
        className={compact ? "sr-only" : "mb-1 block text-xs font-semibold text-[var(--color-text-secondary)]"}
      >
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-labelledby={`${labelId} ${baseId}-value`}
        disabled={disabled || isLoading}
        onClick={() => (isOpen ? close(false) : open())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            open();
          }
        }}
        className={
          compact
            ? "flex min-h-[44px] max-w-full items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-[var(--color-primary-light)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-70 sm:px-3"
            : "flex min-h-[44px] w-full items-center gap-3 rounded-lg border border-[var(--color-border)] bg-white px-3 text-left transition-colors hover:border-[var(--color-primary)]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-70"
        }
      >
        {!compact && <Store size={18} className="shrink-0 text-[var(--color-primary)]" aria-hidden="true" />}
        <span
          id={`${baseId}-value`}
          title={compact ? buttonText : undefined}
          className={`min-w-0 truncate text-sm ${
            compact ? "max-w-[5.5rem] font-medium min-[360px]:max-w-[8rem] sm:max-w-[200px]" : "flex-1 font-semibold"
          } ${selectedStore ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}
        >
          {buttonText}
        </span>
        <ChevronDown
          size={compact ? 16 : 18}
          aria-hidden="true"
          className={`shrink-0 text-[var(--color-text-secondary)] transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          className={
            compact
              ? "fixed inset-x-2 top-16 z-50 mt-2 rounded-xl border border-[var(--color-border)] bg-white p-2 shadow-md sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:w-[280px]"
              : "absolute left-0 right-0 top-full z-30 mt-2 rounded-xl border border-[var(--color-border)] bg-white p-2 shadow-md"
          }
        >
          {compact && (
            <p aria-hidden="true" className="mb-1 border-b border-[var(--color-border)] px-3 pb-3 pt-1 text-sm font-medium text-[var(--color-text-secondary)]">
              {label}
            </p>
          )}
          {stores.length > 0 ? (
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-labelledby={labelId}
              aria-activedescendant={activeIndex >= 0 ? `${baseId}-option-${activeIndex}` : undefined}
              onKeyDown={handleListKeyDown}
              className="max-h-64 overflow-y-auto focus:outline-none"
            >
              {stores.map((store, index) => {
                const isSelected = store.id === selectedStoreId;
                const isActive = index === activeIndex;
                return (
                  <li
                    key={store.id}
                    id={`${baseId}-option-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(index)}
                    className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg px-3 text-sm ${
                      isActive ? "bg-[var(--color-primary-light)]/30" : ""
                    } ${isSelected ? "font-semibold text-[var(--color-primary)]" : "text-[var(--color-text-primary)]"}`}
                  >
                    <Check
                      size={16}
                      aria-hidden="true"
                      className={`shrink-0 ${isSelected ? "text-[var(--color-primary)]" : "invisible"}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{store.name}</span>
                    {isSelected && (
                      <span className="shrink-0 text-xs font-medium text-[var(--color-primary)]">현재</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p id={listId} className="px-3 py-3 text-sm text-[var(--color-text-secondary)]">
              승인된 매장이 없습니다.
            </p>
          )}

          <div className="mt-1 border-t border-[var(--color-border)] pt-1">
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onManageStores();
                }}
                className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                <Clock3 size={16} aria-hidden="true" className="shrink-0 text-amber-700" />
                <span className="flex-1 text-left">승인 대기 {pendingCount}건</span>
                <ChevronRight size={16} aria-hidden="true" className="shrink-0" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onManageStores();
              }}
              className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <Settings size={16} aria-hidden="true" />
              {manageLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
