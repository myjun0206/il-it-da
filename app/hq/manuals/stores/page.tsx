"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Store, ExternalLink, Search, FileText } from "lucide-react";
import type { ManualRecord } from "@/lib/types/manual";
import type { HqStoreSummary } from "@/lib/types/store";

interface StoreInfo {
  id: string;
  name: string;
  manualCount: number;
}

interface StoreViewStats {
  totalStores: number;
  storesWithManuals: number;
  totalStoreManuals: number;
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
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [storeListError, setStoreListError] = useState("");
  const [reloadStoreList, setReloadStoreList] = useState(0);
  const [stats, setStats] = useState<StoreViewStats>({
    totalStores: 0,
    storesWithManuals: 0,
    totalStoreManuals: 0,
  });
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [selectedStoreManuals, setSelectedStoreManuals] = useState<ManualRecord[]>([]);
  const [loadedStoreId, setLoadedStoreId] = useState("");
  const [storeManualsError, setStoreManualsError] = useState("");
  const [storeSearchQuery, setStoreSearchQuery] = useState("");
  const [selectedManualCategory, setSelectedManualCategory] = useState<string | null>(null);

  useEffect(() => {
    setIsReady(true);
  }, []);

  useEffect(() => {
    const fetchStoreData = async () => {
      try {
        setIsLoading(true);
        setStoreListError("");

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
        const storesWithManualsCount = storesArray.filter((s) => s.manualCount > 0).length;

        setStats({
          totalStores: storesArray.length,
          storesWithManuals: storesWithManualsCount,
          totalStoreManuals: storesArray.reduce((count, store) => count + store.manualCount, 0),
        });

        const requestedStoreId = new URLSearchParams(window.location.search).get("storeId");
        if (requestedStoreId && storesArray.some((store) => store.id === requestedStoreId)) {
          setSelectedStoreId(requestedStoreId);
        }
      } catch (e) {
        console.error("Failed to fetch store data:", e);
        setStoreListError(e instanceof Error ? e.message : "지점 목록을 불러오지 못했습니다.");
      } finally {
        setIsLoading(false);
      }
    };

    if (isReady) {
      fetchStoreData();
    }
  }, [isReady, reloadStoreList]);

  useEffect(() => {
    if (!selectedStoreId) return;

    const controller = new AbortController();

    fetch(`/api/manuals?storeId=${encodeURIComponent(selectedStoreId)}&scope=store`, {
      signal: controller.signal,
    })
      .then((response) => readJsonResponse<{ manuals?: ManualRecord[] }>(response, "지점 매뉴얼을 불러오지 못했습니다."))
      .then((data) => {
        setSelectedStoreManuals((data.manuals ?? []).filter((manual) => manual.store_id === selectedStoreId));
        setLoadedStoreId(selectedStoreId);
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setStoreManualsError(error instanceof Error ? error.message : "지점 매뉴얼을 불러오지 못했습니다.");
      })
    return () => controller.abort();
  }, [selectedStoreId]);

  const filteredStores = stores.filter((store) =>
    store.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const selectedStore = stores.find((store) => store.id === selectedStoreId) ?? null;

  const openStoreManuals = (storeId: string) => {
    setSelectedStoreManuals([]);
    setLoadedStoreId("");
    setStoreManualsError("");
    setStoreSearchQuery("");
    setSelectedManualCategory(null);
    setSelectedStoreId(storeId);
    router.push(`/hq/manuals/stores?storeId=${encodeURIComponent(storeId)}`, { scroll: false });
  };

  const closeStoreManuals = () => {
    setSelectedStoreId("");
    setStoreSearchQuery("");
    setSelectedManualCategory(null);
    router.push("/hq/manuals/stores", { scroll: false });
  };

  if (!isReady) {
    return null;
  }

  return (
    <>
    <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
              지점 매뉴얼 보기
            </h1>
            <p className="text-base text-[var(--color-text-secondary)]">
              각 지점에서 등록한 매뉴얼을 확인할 수 있습니다.
            </p>
          </div>

          {isLoading ? (
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-8 shadow-sm text-center">
              <p className="text-sm text-[var(--color-text-secondary)]">로드 중...</p>
            </div>
          ) : storeListError ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-6" role="alert">
              <p className="flex-1 text-sm text-red-700">{storeListError}</p>
              <button
                type="button"
                onClick={() => setReloadStoreList((current) => current + 1)}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-100"
              >
                <RefreshCw size={16} aria-hidden="true" /> 다시 시도
              </button>
            </div>
          ) : stats.totalStores === 0 ? (
            // No stores at all
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                <Store size={32} className="text-amber-600" />
              </div>
              <p className="text-base text-[var(--color-text-secondary)] mb-2">
                아직 등록된 지점이 없습니다.
              </p>
              <p className="text-sm text-[var(--color-text-tertiary)]">
                지점이 추가되고 매뉴얼이 등록되면 여기에서 지점별 매뉴얼 현황을 확인할 수 있습니다.
              </p>
            </div>
          ) : (
            <>
              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                {/* Total Stores */}
                <div className="bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm">
                  <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                    전체 지점
                  </p>
                  <p className="text-2xl font-bold text-[var(--color-text-primary)]">
                    {stats.totalStores}
                  </p>
                </div>

                {/* Stores with Manuals */}
                <div className="bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm">
                  <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                    매뉴얼 등록 지점
                  </p>
                  <p className="text-2xl font-bold text-[var(--color-text-primary)]">
                    {stats.storesWithManuals}
                  </p>
                </div>

                {/* Total Store Manuals */}
                <div className="bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm">
                  <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                    지점 매뉴얼 수
                  </p>
                  <p className="text-2xl font-bold text-[var(--color-text-primary)]">
                    {stats.totalStoreManuals}
                  </p>
                </div>
              </div>

              {stats.totalStoreManuals === 0 ? (
                // Stores exist but no manuals
                <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                  <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
                    <Store size={32} className="text-blue-600" />
                  </div>
                  <p className="text-base text-[var(--color-text-secondary)] mb-2">
                    아직 등록된 지점 매뉴얼이 없습니다.
                  </p>
                  <p className="text-sm text-[var(--color-text-tertiary)]">
                    지점에서 매뉴얼이 등록되면 여기에 표시됩니다.
                  </p>
                </div>
              ) : (
                <>
                  {/* Search Bar */}
                  <div className="mb-6">
                    <input
                      type="text"
                      placeholder="지점명 검색..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full px-4 py-3 rounded-lg border-2 border-[var(--color-border)] text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30"
                    />
                  </div>

                  {/* Stores List Table */}
                  <div className="bg-white border border-[var(--color-border)] rounded-xl shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-[var(--color-bg-default)] border-b border-[var(--color-border)]">
                          <tr>
                            <th className="px-6 py-4 text-left text-sm font-bold text-[var(--color-text-primary)]">
                              지점명
                            </th>
                            <th className="px-6 py-4 text-right text-sm font-bold text-[var(--color-text-primary)]">
                              매뉴얼 수
                            </th>
                            <th className="px-6 py-4 text-center text-sm font-bold text-[var(--color-text-primary)]">
                              작업
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredStores.map((store, index) => (
                            <tr
                              key={store.id}
                              className={`border-t border-[var(--color-border)] hover:bg-[var(--color-bg-default)] transition-colors ${
                                index === filteredStores.length - 1 ? "" : ""
                              }`}
                            >
                              <td className="px-6 py-4 text-sm text-[var(--color-text-primary)] font-medium">
                                {store.name}
                              </td>
                              <td className="px-6 py-4 text-sm text-right text-[var(--color-text-secondary)]">
                                {store.manualCount}
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button
                                  type="button"
                                  onClick={() => openStoreManuals(store.id)}
                                  className="inline-flex items-center gap-1 text-sm text-[var(--color-primary)] hover:text-[var(--color-primary-dark)] transition-colors"
                                  title={`${store.name}의 매뉴얼 보기`}
                                >
                                  보기 <ExternalLink size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {filteredStores.length === 0 && stores.length > 0 && (
                      <div className="text-center py-8 text-sm text-[var(--color-text-secondary)]">
                        검색 결과가 없습니다.
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {selectedStore && (
            <section className="mt-8 border-t border-[var(--color-border)] pt-6" aria-live="polite">
              {/* Header with back button */}
              <div className="mb-6">
                <button
                  type="button"
                  onClick={closeStoreManuals}
                  className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <ArrowLeft size={16} aria-hidden="true" /> 지점 목록
                </button>
                <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                  {selectedStore.name}
                </h2>
                <p className="text-base text-[var(--color-text-secondary)]">
                  지점의 업무 매뉴얼을 확인할 수 있습니다.
                </p>
              </div>

              {selectedStoreId !== loadedStoreId && !storeManualsError ? (
                <div className="bg-white border border-[var(--color-border)] rounded-xl p-8 shadow-sm text-center">
                  <p className="text-sm text-[var(--color-text-secondary)]">지점 매뉴얼을 불러오는 중...</p>
                </div>
              ) : storeManualsError ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-6" role="alert">
                  <p className="flex-1 text-sm text-red-700">{storeManualsError}</p>
                </div>
              ) : selectedStoreManuals.length === 0 ? (
                <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                  <FileText size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                  <p className="text-base text-[var(--color-text-secondary)]">등록된 지점 매뉴얼이 없습니다.</p>
                </div>
              ) : (() => {
                // Helper: normalize category name
                const getDisplayCategoryName = (category: string): string => {
                  const trimmed = category.trim();
                  if (!trimmed) return "미분류";
                  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                  const internalPattern = /^[A-Za-z0-9_-]{16,}$/;
                  if (uuidPattern.test(trimmed) || internalPattern.test(trimmed)) return "카테고리";
                  return trimmed;
                };

                // Group manuals by parent (title) and extract categories
                type ManualGroup = {
                  id: string;
                  category: string;
                  title: string;
                  items: ManualRecord[];
                };

                const groups: ManualGroup[] = [];
                const childrenByParent = new Map<string, ManualRecord[]>();

                for (const manual of selectedStoreManuals) {
                  if (!manual.parent_manual_id) continue;
                  const children = childrenByParent.get(manual.parent_manual_id) ?? [];
                  children.push(manual);
                  childrenByParent.set(manual.parent_manual_id, children);
                }

                for (const parent of selectedStoreManuals.filter((m) => !m.parent_manual_id)) {
                  groups.push({
                    id: parent.id,
                    category: getDisplayCategoryName(parent.category ?? ""),
                    title: parent.title,
                    items: childrenByParent.get(parent.id) ?? [parent],
                  });
                }

                // Extract categories from groups
                const allCategories = [...new Set(groups.map((g) => g.category))];
                const categories = allCategories.length > 1 ? [null, ...allCategories] : [];

                // Filter by search query and category
                const normalizedQuery = storeSearchQuery.trim().toLowerCase();
                const filteredGroups = groups.filter((group) => {
                  // Category filter
                  if (selectedManualCategory && group.category !== selectedManualCategory) {
                    return false;
                  }
                  // Search filter
                  if (normalizedQuery) {
                    const searchText = [group.title, group.category].join(" ").toLowerCase();
                    return searchText.includes(normalizedQuery);
                  }
                  return true;
                });

                return (
                  <>
                    {/* Search and Filter */}
                    <div className="mb-6 flex flex-col gap-4">
                      {/* Search Input */}
                      <div className="relative">
                        <Search
                          size={18}
                          aria-hidden="true"
                          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                        />
                        <input
                          type="search"
                          value={storeSearchQuery}
                          onChange={(event) => setStoreSearchQuery(event.target.value)}
                          placeholder="매뉴얼 검색"
                          aria-label="매뉴얼 검색"
                          className="h-12 w-full rounded-lg border border-[var(--color-border)] bg-white pl-11 pr-4 text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                        />
                      </div>

                      {/* Category Chips */}
                      {categories.length > 0 && (
                        <div className="flex flex-wrap gap-2" role="group" aria-label="카테고리">
                          {categories.map((category) => {
                            const isActive = selectedManualCategory === category;
                            return (
                              <button
                                key={category ?? "__all"}
                                type="button"
                                aria-pressed={isActive}
                                onClick={() => setSelectedManualCategory(category)}
                                className={`min-h-[36px] rounded-full border px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                                  isActive
                                    ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]"
                                    : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-text-primary)]"
                                }`}
                              >
                                {category ?? "전체"}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Manual Count and Grid */}
                    {filteredGroups.length === 0 ? (
                      <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                        <FileText size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                        <p className="text-base text-[var(--color-text-secondary)]">
                          {normalizedQuery ? "검색 결과가 없습니다." : "등록된 매뉴얼이 없습니다."}
                        </p>
                      </div>
                    ) : (
                      <>
                        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
                          매뉴얼 <span className="font-bold text-[var(--color-text-primary)]">{filteredGroups.length}</span>개
                        </p>
                        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                          {filteredGroups.map((group) => (
                            <li key={group.id} className="min-w-0">
                              <div className="flex h-full w-full flex-col items-start rounded-xl border border-[var(--color-border)] bg-white p-5 text-left transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/10">
                                <span className="mb-3 inline-flex max-w-full truncate rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
                                  {group.category}
                                </span>
                                <span className="w-full text-base font-semibold text-[var(--color-text-primary)] break-keep line-clamp-2">
                                  {group.title}
                                </span>
                                <span className="mt-auto pt-3 text-xs text-[var(--color-text-tertiary)]">세부 매뉴얼 {group.items.length}개</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                );
              })()}
            </section>
          )}
        </main>
    </>
  );
}
