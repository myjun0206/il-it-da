"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Pencil, Search, Store } from "lucide-react";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import { createClient } from "@/lib/supabase/client";

interface StoreInfo {
  id: string;
  name: string;
  manualCount: number;
}

interface StoreListItem {
  id: string;
  name: string;
}

interface StoreManualItem {
  store_id: string | null;
}

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || fallbackMessage);
  }
  return data;
}

export default function HqStoresPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("메가MGC커피");
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const loadPage = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const user = data.session?.user;
        if (user?.user_metadata?.name) {
          setUserName(user.user_metadata.name);
          const firstName = user.user_metadata.name.split(" ")[0];
          if (firstName) setFranchiseName(firstName);
        }

        const [storesResponse, manualsResponse] = await Promise.all([
          fetch("/api/stores"),
          fetch("/api/manuals"),
        ]);
        const storesData = await readJson<{ stores?: StoreListItem[] }>(
          storesResponse,
          "지점 목록을 불러오지 못했습니다.",
        );
        const manualsData = await readJson<{ manuals?: StoreManualItem[] }>(
          manualsResponse,
          "매뉴얼 목록을 불러오지 못했습니다.",
        );

        const manualCounts = new Map<string, number>();
        for (const manual of manualsData.manuals ?? []) {
          if (manual.store_id) {
            manualCounts.set(manual.store_id, (manualCounts.get(manual.store_id) ?? 0) + 1);
          }
        }

        setStores(
          (storesData.stores ?? []).map((store) => ({
            ...store,
            manualCount: manualCounts.get(store.id) ?? 0,
          })),
        );
      } catch (error) {
        console.error("Failed to load HQ stores:", error);
        setErrorMessage(error instanceof Error ? error.message : "지점 목록을 불러오지 못했습니다.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadPage();
  }, []);

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      window.location.href = "/";
    }
  };

  const filteredStores = stores.filter((store) =>
    store.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <HQSidebar
        userName={userName}
        franchiseName={franchiseName}
        onLogout={handleLogout}
        activeMenu="store-status"
      />

      <div className="lg:ml-[240px]">
        <HQHeader userName={userName} franchiseName={franchiseName} />

        <main className="mx-auto max-w-7xl p-6 lg:p-8">
          <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="mb-2 text-2xl font-bold text-[var(--color-text-primary)]">지점 관리</h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                등록된 지점과 지점별 매뉴얼 현황을 확인하세요.
              </p>
            </div>
            <div className="relative w-full lg:w-80">
              <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="지점명 검색"
                aria-label="지점명 검색"
                className="w-full rounded-lg border-2 border-[var(--color-border)] bg-white py-2.5 pl-10 pr-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-12 text-center shadow-md">
              <p className="text-sm text-[var(--color-text-secondary)]">지점 목록을 불러오는 중...</p>
            </div>
          ) : errorMessage ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{errorMessage}</div>
          ) : filteredStores.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] p-12 text-center shadow-sm">
              <Store size={32} className="mx-auto mb-4 text-[var(--color-text-tertiary)]" />
              <p className="text-base font-medium text-[var(--color-text-secondary)]">
                {stores.length === 0 ? "등록된 지점이 없습니다." : "검색 결과가 없습니다."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredStores.map((store, index) => (
                <article
                  key={store.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/hq/stores/${store.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(`/hq/stores/${store.id}`);
                    }
                  }}
                  className="relative cursor-pointer rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 text-left shadow-md transition-all hover:-translate-y-0.5 hover:border-[var(--color-primary)] hover:bg-white hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2"
                >
                  <Link
                    href={`/hq/stores/${store.id}`}
                    onClick={(event) => event.stopPropagation()}
                    className="absolute right-4 top-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] shadow-sm transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                    aria-label={`${store.name} 관리`}
                    title={`${store.name} 관리`}
                  >
                    <Pencil size={15} />
                  </Link>
                  <div className="relative">
                    <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-sm font-bold text-[var(--color-primary)]">
                      {index + 1}
                    </div>
                    <div className="mb-4 flex items-center gap-2">
                      <Building2 size={18} className="text-[var(--color-primary)]" />
                      <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{store.name}</h2>
                    </div>
                    <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-4 text-sm text-[var(--color-text-secondary)]">
                      <span>지점 전용 매뉴얼</span>
                      <strong className="text-[var(--color-text-primary)]">{store.manualCount}개</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}