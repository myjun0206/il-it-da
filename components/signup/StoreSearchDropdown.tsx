"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, ChevronRight, Check, Loader2 } from "lucide-react";
import type { Store } from "@/lib/types/store";

interface StoreSearchDropdownProps {
  stores?: Store[]; // 더 이상 사용하지 않음 (이전 호환성 유지)
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onStoreSelect: (store: Store) => void;
  selectedStoreIds?: string[];
}

interface ApiStore {
  id: string;
  name: string;
  address: string;
  roadAddress: string;
  category?: string;
  lat: number;
  lng: number;
}

export default function StoreSearchDropdown({
  stores,
  searchQuery,
  onSearchChange,
  onStoreSelect,
  selectedStoreIds = [],
}: StoreSearchDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filteredStores, setFilteredStores] = useState<Store[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 실제 API 검색 (debounce + AbortController)
  useEffect(() => {
    // Debounce timer 정리
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!searchQuery.trim()) {
      setFilteredStores([]);
      setIsOpen(false);
      setFocusedIndex(-1);
      setError(null);
      return;
    }

    // 1글자 이하는 API 호출하지 않음
    if (searchQuery.trim().length < 2) {
      setFilteredStores([]);
      return;
    }

    // 이전 요청 취소
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // 새 AbortController 생성
    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    setError(null);

    // 350ms debounce
    debounceTimerRef.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/stores/search?q=${encodeURIComponent(searchQuery)}`,
          {
            signal: abortControllerRef.current?.signal,
          }
        );

        if (!response.ok) {
          throw new Error("검색 실패");
        }

        const data = await response.json();
        const apiResults = data.results || [];

        // API 결과를 Store 타입으로 변환
        const convertedStores: Store[] = apiResults.map(
          (result: ApiStore) => ({
            id: result.id,
            brandId: `brand_${result.id}`, // 임시 brandId
            brandName: result.name.split(" ")[0] || result.name, // 첫 단어를 브랜드명으로
            name: result.name,
            address: result.address,
            latitude: result.lat,
            longitude: result.lng,
            status: "active" as const,
            createdAt: new Date(),
            manualCount: 0,
            memberCount: 0,
          })
        );

        setFilteredStores(convertedStores);
        setIsOpen(true);
        setFocusedIndex(-1);
      } catch (err: any) {
        if (err.name === "AbortError") {
          // 요청 취소됨 (정상)
          return;
        }
        console.error("[StoreSearch] Error:", err);
        setError("매장 검색 중 문제가 발생했습니다.\n잠시 후 다시 시도해주세요.");
        setFilteredStores([]);
      } finally {
        setIsLoading(false);
      }
    }, 350);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery]);

  // 외부 클릭 감지
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 키보드 네비게이션
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen && e.key !== "ArrowDown") return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setIsOpen(true);
        setFocusedIndex((prev) =>
          prev < filteredStores.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < filteredStores.length) {
          handleSelectStore(filteredStores[focusedIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setFocusedIndex(-1);
        break;
      default:
        break;
    }
  };

  const handleSelectStore = (store: Store) => {
    onStoreSelect(store);
    setIsOpen(false);
    setFocusedIndex(-1);
    // 검색창 초기화 하지 않음 (선택된 매장명 표시)
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Search Input */}
      <div className="relative">
        <Search
          size={20}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] pointer-events-none"
        />
        <input
          ref={inputRef}
          type="text"
          placeholder="매장명, 지점명 또는 주소를 검색해주세요"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (searchQuery.trim()) {
              setIsOpen(true);
            }
          }}
          aria-label="매장 검색"
          aria-expanded={isOpen}
          aria-controls="store-dropdown"
          className="w-full h-14 pl-12 pr-5 rounded-lg border-2 border-[var(--color-border)] bg-white text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30 transition-colors"
        />
      </div>

      {/* Dropdown Results */}
      {isOpen && searchQuery.trim() && (
        <div
          id="store-dropdown"
          role="listbox"
          className="absolute top-full left-0 right-0 mt-2 bg-white border border-[var(--color-border)] rounded-lg shadow-lg max-h-80 overflow-y-auto z-50"
        >
          {isLoading ? (
            <div className="px-4 py-8 flex flex-col items-center justify-center text-[var(--color-text-secondary)]">
              <Loader2 size={24} className="animate-spin mb-2" />
              <p className="text-sm">검색 중...</p>
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-line">
                {error}
              </p>
            </div>
          ) : filteredStores.length > 0 ? (
            <ul className="py-2">
              {filteredStores.slice(0, 5).map((store, index) => {
                const isSelected = selectedStoreIds.includes(store.id);
                return (
                  <li key={store.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectStore(store)}
                      onMouseEnter={() => setFocusedIndex(index)}
                      onMouseLeave={() => setFocusedIndex(-1)}
                      role="option"
                      aria-selected={isSelected}
                      disabled={isSelected}
                      className={`w-full text-left px-4 py-3 min-h-[64px] flex items-center justify-between gap-3 transition-colors ${
                        focusedIndex === index && !isSelected
                          ? "bg-[var(--color-primary-light)]/20"
                          : !isSelected
                            ? "hover:bg-[var(--color-primary-light)]/10"
                            : ""
                      } ${
                        isSelected
                          ? "bg-[var(--color-primary-light)]/20 border-l-2 border-l-[var(--color-primary)] cursor-not-allowed"
                          : ""
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[var(--color-text-primary)] text-sm leading-tight">
                          {store.brandName} {store.name}
                        </p>
                        <p className="text-sm text-[var(--color-text-secondary)] mt-1 truncate">
                          {store.address}
                        </p>
                      </div>
                      {isSelected ? (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Check
                            size={20}
                            className="text-[var(--color-primary)]"
                            strokeWidth={3}
                          />
                          <span className="text-xs font-semibold text-[var(--color-primary)]">
                            선택됨
                          </span>
                        </div>
                      ) : (
                        <ChevronRight
                          size={20}
                          className="flex-shrink-0 text-[var(--color-text-secondary)]"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-4 py-6 text-center text-[var(--color-text-secondary)]">
              <p className="text-sm">검색 결과가 없습니다.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
