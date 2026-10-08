"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { HqStoreSummary } from "@/lib/types/store";

type Props = {
  stores: HqStoreSummary[];
  selectedStoreIds: string[];
  onSelectionChange: (storeIds: string[]) => void;
  error?: string;
};

export function StoreMultiSelector({ stores, selectedStoreIds, onSelectionChange, error }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 검색어 변경에 따라 목록 자동 열고 닫기
  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [searchQuery]);

  // 검색어에 일치하는 지점 필터링
  const filteredStores = useMemo(() => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) return [];
    const query = trimmedQuery.toLowerCase();
    return stores.filter((store) => store.name.toLowerCase().includes(query));
  }, [stores, searchQuery]);

  // 선택된 지점 객체 조회
  const selectedStores = useMemo(
    () => stores.filter((store) => selectedStoreIds.includes(store.id)),
    [stores, selectedStoreIds],
  );

  const handleToggleStore = (storeId: string) => {
    const newSelection = selectedStoreIds.includes(storeId)
      ? selectedStoreIds.filter((id) => id !== storeId)
      : [...selectedStoreIds, storeId];
    onSelectionChange(newSelection);
  };

  const handleRemoveStore = (storeId: string) => {
    onSelectionChange(selectedStoreIds.filter((id) => id !== storeId));
  };

  return (
    <div className="space-y-3" ref={containerRef}>
      <div className="relative">
        {/* 검색 입력창 */}
        <div className="relative">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="지점명으로 검색"
            className="w-full h-11 rounded-lg border-2 border-[var(--color-border)] bg-white px-4 pl-10 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
        </div>

        {/* 검색 결과 패널 */}
        {searchQuery.trim().length > 0 && filteredStores.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-10 mt-2 bg-white border border-[var(--color-border)] rounded-lg shadow-md max-h-64 overflow-y-auto">
            {filteredStores.map((store) => (
              <label
                key={store.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-bg-default)] cursor-pointer border-b border-[var(--color-border)] last:border-b-0 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedStoreIds.includes(store.id)}
                  onChange={() => handleToggleStore(store.id)}
                  className="h-4 w-4 rounded accent-[var(--color-primary)] cursor-pointer"
                />
                <span className="text-base text-[var(--color-text-primary)]">{store.name}</span>
              </label>
            ))}
          </div>
        )}

        {/* 결과 없음 메시지 */}
        {searchQuery.trim().length > 0 && filteredStores.length === 0 && (
          <div className="absolute top-full left-0 right-0 z-10 mt-2 bg-white border border-[var(--color-border)] rounded-lg p-4">
            <p className="text-sm text-[var(--color-text-secondary)] text-center">
              검색 결과가 없습니다.
            </p>
          </div>
        )}

        {/* 외부 클릭으로 패널 닫기 */}
        {isOpen && (
          <div
            className="fixed inset-0 z-0"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
        )}
      </div>

      {/* 선택한 지점 정보 */}
      {selectedStoreIds.length > 0 && (
        <div className="text-sm text-[var(--color-text-secondary)]">
          선택한 지점 {selectedStoreIds.length}개
        </div>
      )}

      {/* 선택된 지점 태그 */}
      {selectedStores.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedStores.map((store) => (
            <div
              key={store.id}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-primary-light)]/30 px-3 py-1.5 text-sm font-medium text-[var(--color-primary)]"
            >
              {store.name}
              <button
                type="button"
                onClick={() => handleRemoveStore(store.id)}
                className="ml-1 inline-flex items-center justify-center rounded-full hover:bg-[var(--color-primary-light)]/50 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)]"
                aria-label={`${store.name} 제거`}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 에러 메시지 */}
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
