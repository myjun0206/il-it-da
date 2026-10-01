"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Store, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
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
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("메가MGC커피");
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

  useLayoutEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user || data.session.user.user_metadata?.role !== "hq") {
          router.push("/");
          return;
        }
      } catch (e) {
        console.error("Auth check failed:", e);
        router.push("/");
      }
    };

    checkAuth();
  }, [router]);

  useEffect(() => {
    const setUserInfo = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) return;

        const name = data.session.user.user_metadata?.name;
        if (name) {
          setUserName(name);
          if (name.includes(" ")) {
            const [first] = name.split(" ");
            if (first) setFranchiseName(first);
          }
        }
      } finally {
        setIsReady(true);
      }
    };

    setUserInfo();
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

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
    } catch (e) {
      console.error("Logout failed:", e);
      router.push("/");
    }
  };

  const filteredStores = stores.filter((store) =>
    store.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const selectedStore = stores.find((store) => store.id === selectedStoreId) ?? null;

  const childrenByParent = new Map<string, ManualRecord[]>();
  for (const manual of selectedStoreManuals) {
    if (!manual.parent_manual_id) continue;
    const children = childrenByParent.get(manual.parent_manual_id) ?? [];
    children.push(manual);
    childrenByParent.set(manual.parent_manual_id, children);
  }

  const manualsByCategory = new Map<string, { parent: ManualRecord; children: ManualRecord[] }[]>();
  for (const parent of selectedStoreManuals.filter((manual) => !manual.parent_manual_id)) {
    const category = parent.category?.trim() || "미분류";
    const groups = manualsByCategory.get(category) ?? [];
    groups.push({ parent, children: childrenByParent.get(parent.id) ?? [] });
    manualsByCategory.set(category, groups);
  }

  const openStoreManuals = (storeId: string) => {
    setSelectedStoreManuals([]);
    setLoadedStoreId("");
    setStoreManualsError("");
    setSelectedStoreId(storeId);
    router.push(`/hq/manuals/stores?storeId=${encodeURIComponent(storeId)}`, { scroll: false });
  };

  const closeStoreManuals = () => {
    setSelectedStoreId("");
    router.push("/hq/manuals/stores", { scroll: false });
  };

  if (!isReady) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <HQSidebar
        userName={userName}
        franchiseName={franchiseName}
        onLogout={handleLogout}
        activeMenu="manual-store"
      />

      <div className="lg:ml-[240px]">
        <HQHeader userName={userName} franchiseName={franchiseName} onLogout={handleLogout} />

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
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
                    {selectedStore.name} 지점 매뉴얼
                  </h2>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    지점 전용 매뉴얼 {selectedStore.manualCount}개
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeStoreManuals}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]"
                >
                  <ArrowLeft size={16} aria-hidden="true" /> 전체 지점
                </button>
              </div>

              {selectedStoreId !== loadedStoreId && !storeManualsError ? (
                <p className="rounded-lg border border-[var(--color-border)] bg-white p-6 text-sm text-[var(--color-text-secondary)]" role="status">
                  지점 매뉴얼을 불러오는 중...
                </p>
              ) : storeManualsError ? (
                <p className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700" role="alert">
                  {storeManualsError}
                </p>
              ) : selectedStoreManuals.length === 0 ? (
                <p className="rounded-lg border border-[var(--color-border)] bg-white p-6 text-sm text-[var(--color-text-secondary)]">
                  이 지점에 등록된 매뉴얼이 없습니다.
                </p>
              ) : (
                <div className="space-y-5">
                  {Array.from(manualsByCategory, ([category, groups]) => (
                    <section key={category} className="border-b border-[var(--color-border)] pb-5 last:border-0">
                      <h3 className="mb-3 text-base font-bold text-[var(--color-primary)]">{category}</h3>
                      <div className="space-y-3">
                        {groups.map(({ parent, children }) => (
                          <article key={parent.id} className="rounded-lg border border-[var(--color-border)] bg-white p-4">
                            <h4 className="font-semibold text-[var(--color-text-primary)]">{parent.title}</h4>
                            {children.length > 0 ? (
                              <ul className="mt-2 space-y-2">
                                {children.map((child) => (
                                  <li key={child.id} className="border-l-2 border-[var(--color-border)] pl-3 text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">
                                    {child.content}
                                  </li>
                                ))}
                              </ul>
                            ) : parent.content ? (
                              <p className="mt-2 text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">
                                {parent.content}
                              </p>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
