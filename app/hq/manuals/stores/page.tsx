"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Store, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import type { ManualRecord } from "@/lib/types/manual";

interface StoreInfo {
  id: string;
  name: string;
  manualCount: number;
}

interface StoreListItem {
  id: string;
  name: string;
}

type StoreManualItem = Pick<ManualRecord, "store_id">;

function hasStoreId(manual: StoreManualItem): manual is StoreManualItem & { store_id: string } {
  return Boolean(manual.store_id);
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
  const [stats, setStats] = useState<StoreViewStats>({
    totalStores: 0,
    storesWithManuals: 0,
    totalStoreManuals: 0,
  });
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

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

        // Fetch stores
        const storesResponse = await fetch("/api/stores");
        const storesData = await readJsonResponse<{ stores?: StoreListItem[] }>(
          storesResponse,
          "지점 목록을 불러오지 못했습니다.",
        );

        // Fetch manuals
        const manualsResponse = await fetch("/api/manuals");
        const manualsData = await readJsonResponse<{ manuals?: StoreManualItem[] }>(
          manualsResponse,
          "매뉴얼 목록을 불러오지 못했습니다.",
        );

        const storesList = storesData.stores ?? [];
        const manualsList = manualsData.manuals ?? [];

        // Filter store manuals (those with store_id)
        const storeManuals = manualsList.filter(hasStoreId);

        // Create store info map with manual counts
        const storeInfoMap = new Map<string, { name: string; manualCount: number }>();

        // Initialize all stores with 0 manuals
        storesList.forEach((store) => {
          storeInfoMap.set(store.id, { name: store.name, manualCount: 0 });
        });

        // Count manuals per store
        storeManuals.forEach((manual) => {
          const storeId = manual.store_id;
          if (!storeId) return;
          const current = storeInfoMap.get(storeId);
          if (current) {
            storeInfoMap.set(storeId, { ...current, manualCount: current.manualCount + 1 });
          }
        });

        // Convert to array and sort by store name
        const storesArray: StoreInfo[] = Array.from(storeInfoMap, ([id, info]) => ({
          id,
          ...info,
        })).sort((a, b) => a.name.localeCompare(b.name));

        setStores(storesArray);

        // Calculate stats
        const storesWithManualsCount = storesArray.filter((s) => s.manualCount > 0).length;

        setStats({
          totalStores: storesList.length,
          storesWithManuals: storesWithManualsCount,
          totalStoreManuals: storeManuals.length,
        });
      } catch (e) {
        console.error("Failed to fetch store data:", e);
      } finally {
        setIsLoading(false);
      }
    };

    if (isReady) {
      fetchStoreData();
    }
  }, [isReady]);

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
        <HQHeader userName={userName} franchiseName={franchiseName} />

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
        </main>
      </div>
    </div>
  );
}
