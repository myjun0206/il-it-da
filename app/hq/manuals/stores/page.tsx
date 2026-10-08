"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useClientReady } from "@/lib/hq/use-client-ready";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Store, Search, FileText, AlertCircle, ChevronRight, ArrowLeft } from "lucide-react";
import type { ManualRecord } from "@/lib/types/manual";
import type { HqStoreSummary } from "@/lib/types/store";

interface StoreInfo {
  id: string;
  name: string;
  manualCount: number;
}

interface ManualWithStore {
  manual: ManualRecord;
  storeName: string;
  storeId: string;
}

type SearchFilter = "all" | "store" | "manual";

const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_ID_LIKE_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

function getDisplayCategoryName(category: string | null | undefined): string {
  const trimmed = category?.trim();
  if (!trimmed || UUID_LIKE_PATTERN.test(trimmed) || INTERNAL_ID_LIKE_PATTERN.test(trimmed)) {
    return "카테고리";
  }
  return trimmed;
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(fallbackMessage);
  }

  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || fallbackMessage);
  }

  return data;
}

export default function StoreManualViewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isReady = useClientReady();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  
  // Data
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [allManuals, setAllManuals] = useState<ManualWithStore[]>([]);
  
  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFilter, setSearchFilter] = useState<SearchFilter>("all");
  
  // Detail view state
  const selectedStoreId = searchParams.get("storeId");
  const selectedManualIdFromQuery = searchParams.get("manualId");
  const selectedStore = selectedStoreId ? stores.find((s) => s.id === selectedStoreId) : null;
  const storeManuals = selectedStoreId ? allManuals.filter((m) => m.storeId === selectedStoreId) : [];
  
  // Manual detail view state
  const [selectedManualId, setSelectedManualId] = useState<string | null>(selectedManualIdFromQuery);
  const selectedManual = selectedManualId && selectedStoreId
    ? allManuals.find((m) => m.storeId === selectedStoreId && m.manual.id === selectedManualId)
    : null;

  // Sync manual selection with URL query parameters
  useEffect(() => {
    setSelectedManualId(selectedManualIdFromQuery);
  }, [selectedManualIdFromQuery]);

  // Load all stores and their manuals
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        setLoadError("");

        // Fetch all stores
        const storesResponse = await fetch("/api/hq/stores");
        const storesData = await readJsonResponse<{ stores?: HqStoreSummary[] }>(
          storesResponse,
          "지점 목록을 불러오지 못했습니다.",
        );
        const storesArray: StoreInfo[] = (storesData.stores ?? []).map((store) => ({
          id: store.id,
          name: store.name,
          manualCount: store.manualCount,
        }));
        setStores(storesArray);

        // Fetch manuals for each store
        const allManualsWithStore: ManualWithStore[] = [];
        for (const store of storesArray) {
          try {
            const manualsResponse = await fetch(
              `/api/manuals?storeId=${encodeURIComponent(store.id)}&scope=store`,
            );
            const manualsData = await readJsonResponse<{ manuals?: ManualRecord[] }>(
              manualsResponse,
              "",
            );
            const manuals = (manualsData.manuals ?? []).filter(
              (manual) => manual.store_id === store.id,
            );
            for (const manual of manuals) {
              allManualsWithStore.push({
                manual,
                storeName: store.name,
                storeId: store.id,
              });
            }
          } catch (e) {
            console.warn(`Failed to fetch manuals for store ${store.id}:`, e);
          }
        }
        setAllManuals(allManualsWithStore);
      } catch (e) {
        console.error("Failed to fetch data:", e);
        setLoadError(
          e instanceof Error && e.message.includes("지점")
            ? e.message
            : "데이터를 불러오지 못했습니다. 다시 시도해 주세요.",
        );
      } finally {
        setIsLoading(false);
      }
    };

    if (isReady) {
      fetchData();
    }
  }, [isReady, reloadKey]);

  // Search filtering
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return { stores: [], manuals: [] };
    }

    const matchingStores =
      searchFilter === "all" || searchFilter === "store"
        ? stores.filter((store) => store.name.toLowerCase().includes(query))
        : [];

    const matchingManuals =
      searchFilter === "all" || searchFilter === "manual"
        ? allManuals.filter((item) => {
            const searchText = [item.manual.title, item.storeName].join(" ").toLowerCase();
            return searchText.includes(query);
          })
        : [];

    return { stores: matchingStores, manuals: matchingManuals };
  }, [searchQuery, searchFilter, stores, allManuals]);

  if (!isReady) {
    return null;
  }

  const hasResults = searchQuery.trim() && (searchResults.stores.length > 0 || searchResults.manuals.length > 0);
  const noResults = searchQuery.trim() && !hasResults;

  // Detail view
  if (selectedStore) {
    // Manual content view
    if (selectedManual) {
      return (
        <>
          <main className="p-6 lg:p-8 max-w-7xl mx-auto">
            {/* Back Button */}
            <button
              type="button"
              onClick={() => {
                if (selectedStoreId) {
                  router.push(
                    `/hq/manuals/stores?storeId=${encodeURIComponent(selectedStoreId)}`,
                    { scroll: false }
                  );
                }
              }}
              className="mb-6 inline-flex items-center gap-2 text-base font-medium text-[var(--color-primary)] hover:text-[var(--color-primary)]/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <ArrowLeft size={20} aria-hidden="true" />
              매뉴얼 목록으로
            </button>

            {/* Header */}
            <div className="mb-8">
              <p className="text-sm text-[var(--color-text-secondary)] mb-2">{selectedStore.name}</p>
              <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-4">{selectedManual.manual.title}</h1>
              {selectedManual.manual.category && (
                <div className="inline-flex rounded-full bg-[var(--color-primary-light)]/40 px-3 py-1.5 text-sm font-semibold text-[var(--color-primary)]">
                  {getDisplayCategoryName(selectedManual.manual.category)}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-8 shadow-sm">
              {selectedManual.manual.content ? (
                <div className="prose max-w-none text-base text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap break-words">
                  {selectedManual.manual.content}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-[var(--color-text-secondary)]">매뉴얼 내용이 없습니다.</p>
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="mt-8 text-sm text-[var(--color-text-tertiary)]">
              <p>업데이트: {selectedManual.manual.updated_at ? new Date(selectedManual.manual.updated_at).toLocaleDateString("ko-KR") : "-"}</p>
            </div>
          </main>
        </>
      );
    }

    // Store manuals list view
    return (
      <>
        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Back Button */}
          <button
            type="button"
            onClick={() => router.push("/hq/manuals/stores", { scroll: false })}
            className="mb-6 inline-flex items-center gap-2 text-base font-medium text-[var(--color-primary)] hover:text-[var(--color-primary)]/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <ArrowLeft size={20} aria-hidden="true" />
            검색으로 돌아가기
          </button>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{selectedStore.name}</h1>
            <p className="mt-2 text-base text-[var(--color-text-secondary)]">
              총 {storeManuals.length}개의 매뉴얼
            </p>
          </div>

          {storeManuals.length === 0 ? (
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                <FileText size={32} className="text-amber-600" />
              </div>
              <p className="text-base text-[var(--color-text-secondary)]">등록된 매뉴얼이 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {storeManuals.map((item, index) => (
                  <li key={`${item.storeId}-${item.manual.id}-${index}`}>
                    <button
                      type="button"
                      onClick={() => {
                        router.push(
                          `/hq/manuals/stores?storeId=${encodeURIComponent(item.storeId)}&manualId=${encodeURIComponent(item.manual.id)}`,
                          { scroll: false }
                        );
                      }}
                      className="w-full min-h-[130px] text-left flex flex-col rounded-lg border border-[var(--color-border)] bg-white px-6 py-6 shadow-sm transition-all cursor-pointer hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/10 hover:shadow-md focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30"
                    >
                      {/* 상단: 카테고리 배지 */}
                      <div className="mb-3">
                        {item.manual.category && (
                          <span className="inline-flex rounded-full bg-[var(--color-primary-light)]/40 px-3 py-1 text-sm font-semibold text-[var(--color-primary)]">
                            {getDisplayCategoryName(item.manual.category)}
                          </span>
                        )}
                      </div>

                      {/* 중앙: 제목 + 화살표 */}
                      <div className="flex items-start justify-between gap-3 mb-4 flex-1">
                        <p className="text-lg font-semibold text-[var(--color-text-primary)] line-clamp-2 break-keep">
                          {item.manual.title}
                        </p>
                        <ChevronRight
                          size={20}
                          className="shrink-0 text-[var(--color-primary)] mt-1"
                          aria-hidden="true"
                        />
                      </div>

                      {/* 하단: 업데이트 정보 */}
                      <div className="flex items-center gap-2 pt-2 text-xs text-[var(--color-text-tertiary)]">
                        <span>업데이트: {item.manual.updated_at ? new Date(item.manual.updated_at).toLocaleDateString("ko-KR") : "-"}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <main className="p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">지점 매뉴얼 보기</h1>
          <p className="text-base text-[var(--color-text-secondary)]">
            지점명이나 매뉴얼명으로 검색하여 각 지점의 매뉴얼을 확인할 수 있습니다.
          </p>
        </div>

        {isLoading ? (
          <div className="bg-white border border-[var(--color-border)] rounded-xl p-8 shadow-sm text-center">
            <p className="text-sm text-[var(--color-text-secondary)]">로드 중...</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-6" role="alert">
            <p className="flex-1 text-sm text-red-700">{loadError}</p>
            <button
              type="button"
              onClick={() => setReloadKey((prev) => prev + 1)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              <RefreshCw size={16} aria-hidden="true" /> 다시 시도
            </button>
          </div>
        ) : (
          <>
            {/* Search Section */}
            <div className="mb-8">
              {/* Search Input */}
              <div className="mb-4">
                <div className="relative">
                  <Search
                    size={20}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                  />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="지점명 또는 매뉴얼명 검색"
                    aria-label="지점명 또는 매뉴얼명 검색"
                    className="h-12 w-full rounded-lg border-2 border-[var(--color-border)] bg-white pl-12 pr-4 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30"
                  />
                </div>
              </div>

              {/* Filter Chips */}
              <div className="flex flex-wrap gap-2" role="group" aria-label="검색 필터">
                <button
                  type="button"
                  onClick={() => setSearchFilter("all")}
                  aria-pressed={searchFilter === "all"}
                  className={`min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                    searchFilter === "all"
                      ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]"
                      : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-text-primary)]"
                  }`}
                >
                  전체
                </button>
                <button
                  type="button"
                  onClick={() => setSearchFilter("store")}
                  aria-pressed={searchFilter === "store"}
                  className={`min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                    searchFilter === "store"
                      ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]"
                      : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-text-primary)]"
                  }`}
                >
                  지점
                </button>
                <button
                  type="button"
                  onClick={() => setSearchFilter("manual")}
                  aria-pressed={searchFilter === "manual"}
                  className={`min-h-9 rounded-full border px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                    searchFilter === "manual"
                      ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]"
                      : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-text-primary)]"
                  }`}
                >
                  매뉴얼
                </button>
              </div>
            </div>

            {/* Results Section */}
            {noResults ? (
              <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle size={32} className="text-amber-600" />
                </div>
                <p className="text-base text-[var(--color-text-secondary)] mb-1">검색 결과가 없습니다.</p>
                <p className="text-sm text-[var(--color-text-tertiary)]">다른 검색어를 입력해 보세요.</p>
              </div>
            ) : hasResults ? (
              <div className="space-y-8">
                {/* Store Results */}
                {searchResults.stores.length > 0 && (
                  <section>
                    <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">지점 ({searchResults.stores.length})</h2>
                    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {searchResults.stores.map((store) => (
                        <li key={store.id}>
                          <button
                            type="button"
                            onClick={() => {
                              router.push(
                                `/hq/manuals/stores?storeId=${encodeURIComponent(store.id)}`,
                                { scroll: false },
                              );
                            }}
                            className="w-full h-[130px] text-left flex flex-col items-start justify-between rounded-lg border border-[var(--color-border)] bg-white px-6 py-6 transition-all cursor-pointer hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/10 hover:shadow-md focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30"
                          >
                            <div className="flex items-start gap-4 w-full">
                              <Store size={24} className="shrink-0 text-[var(--color-primary)] mt-1" />
                              <div className="min-w-0 flex-1">
                                <p className="text-base font-semibold text-[var(--color-text-primary)] break-words">
                                  {store.name}
                                </p>
                                <p className="text-sm text-[var(--color-text-secondary)] mt-2">
                                  매뉴얼 {store.manualCount}개
                                </p>
                              </div>
                            </div>
                            <ChevronRight
                              size={20}
                              className="shrink-0 text-[var(--color-primary)]"
                              aria-hidden="true"
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* Manual Results */}
                {searchResults.manuals.length > 0 && (
                  <section>
                    <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">
                      매뉴얼 ({searchResults.manuals.length})
                    </h2>
                    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {searchResults.manuals.map((item, index) => (
                        <li key={`${item.storeId}-${item.manual.id}-${index}`}>
                          <button
                            type="button"
                            onClick={() => {
                              router.push(
                                `/hq/manuals/stores?storeId=${encodeURIComponent(item.storeId)}&manualId=${encodeURIComponent(item.manual.id)}`,
                                { scroll: false },
                              );
                            }}
                            className="w-full min-h-[130px] text-left flex flex-col rounded-lg border border-[var(--color-border)] bg-white px-6 py-6 transition-all cursor-pointer hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/10 hover:shadow-md focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30"
                          >
                            {/* 상단: 카테고리 배지 */}
                            <div className="mb-3">
                              {item.manual.category && (
                                <span className="inline-flex rounded-full bg-[var(--color-primary-light)]/40 px-3 py-1 text-sm font-semibold text-[var(--color-primary)]">
                                  {getDisplayCategoryName(item.manual.category)}
                                </span>
                              )}
                            </div>

                            {/* 중앙: 제목 + 화살표 */}
                            <div className="flex items-start justify-between gap-3 mb-4 flex-1">
                              <p className="text-lg font-semibold text-[var(--color-text-primary)] line-clamp-2 break-keep">
                                {item.manual.title}
                              </p>
                              <ChevronRight
                                size={20}
                                className="shrink-0 text-[var(--color-primary)] mt-1"
                                aria-hidden="true"
                              />
                            </div>

                            {/* 하단: 지점 정보 */}
                            <div className="flex items-center gap-3 mt-auto pt-2">
                              <Store size={20} className="shrink-0 text-[var(--color-primary)]" />
                              <span className="text-base text-[var(--color-text-secondary)] font-medium break-words">
                                {item.storeName}
                              </span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            ) : (
              <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
                  <FileText size={32} className="text-blue-600" />
                </div>
                <p className="text-base text-[var(--color-text-secondary)] mb-1">지점명이나 매뉴얼명을 입력하여 검색하세요.</p>
                <p className="text-sm text-[var(--color-text-tertiary)]">
                  현재 {stores.length}개 지점, {allManuals.length}개 매뉴얼을 검색할 수 있습니다.
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
