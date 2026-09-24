"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Pencil, Store } from "lucide-react";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";

interface StoreInfo {
  id: string;
  name: string;
}

interface StoreManualItem {
  store_id: string | null;
}

export default function HqStoreDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("메가MGC커피");
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [manualCount, setManualCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const loadStore = async () => {
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
        const storesData = (await storesResponse.json()) as { stores?: StoreInfo[]; error?: string };
        const manualsData = (await manualsResponse.json()) as { manuals?: StoreManualItem[]; error?: string };

        if (!storesResponse.ok) throw new Error(storesData.error || "지점 정보를 불러오지 못했습니다.");
        if (!manualsResponse.ok) throw new Error(manualsData.error || "매뉴얼 정보를 불러오지 못했습니다.");

        const selectedStore = storesData.stores?.find((item) => item.id === params.id) ?? null;
        if (!selectedStore) {
          setErrorMessage("지점 정보를 찾을 수 없습니다.");
          return;
        }

        setStore(selectedStore);
        setManualCount(
          (manualsData.manuals ?? []).filter((manual) => manual.store_id === params.id).length,
        );
      } catch (error) {
        console.error("Failed to load HQ store:", error);
        setErrorMessage(error instanceof Error ? error.message : "지점 정보를 불러오지 못했습니다.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadStore();
  }, [params.id]);

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      window.location.href = "/";
    }
  };

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
        <main className="mx-auto max-w-5xl p-6 lg:p-8">
          <Link
            href="/hq/stores"
            className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]"
          >
            <ArrowLeft size={16} /> 지점 현황으로 돌아가기
          </Link>

          {isLoading ? (
            <div className="rounded-xl border-2 border-[var(--color-border)] bg-white p-12 text-center text-sm text-[var(--color-text-secondary)]">
              지점 정보를 불러오는 중...
            </div>
          ) : errorMessage ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{errorMessage}</div>
          ) : store ? (
            <>
              <div className="mb-8 flex flex-col gap-4 rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-md sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary)]">
                    <Store size={23} />
                  </div>
                  <div>
                    <p className="mb-1 text-sm text-[var(--color-text-secondary)]">지점 상세 관리</p>
                    <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{store.name}</h1>
                  </div>
                </div>
                <Link
                  href={`/hq/manuals/stores?storeId=${encodeURIComponent(store.id)}`}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                >
                  <Pencil size={16} /> 매뉴얼 관리
                </Link>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-md">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary)]">
                    <FileText size={19} />
                  </div>
                  <p className="text-sm text-[var(--color-text-secondary)]">지점 전용 매뉴얼</p>
                  <p className="mt-1 text-3xl font-bold text-[var(--color-text-primary)]">{manualCount}개</p>
                </div>
                <div className="rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-md">
                  <p className="mb-2 text-sm text-[var(--color-text-secondary)]">지점 고유 ID</p>
                  <p className="break-all text-sm font-medium text-[var(--color-text-primary)]">{store.id}</p>
                </div>
              </div>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}