"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, FileText, Pencil, Store, UserRound, Users } from "lucide-react";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import type { HqStoreSummary } from "@/lib/types/store";

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("ko-KR");
}

export default function HqStoreDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("메가MGC커피");
  const [store, setStore] = useState<HqStoreSummary | null>(null);
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

        // /api/hq/stores는 서버에서 현재 HQ의 franchise 지점만 돌려주므로 다른 브랜드 ID로는 조회되지 않는다.
        const storesResponse = await fetch("/api/hq/stores");
        const storesData = (await storesResponse.json()) as { stores?: HqStoreSummary[]; error?: string };

        if (!storesResponse.ok) throw new Error(storesData.error || "지점 정보를 불러오지 못했습니다.");

        const selectedStore = storesData.stores?.find((item) => item.id === params.id) ?? null;
        if (!selectedStore) {
          setErrorMessage("지점 정보를 찾을 수 없습니다.");
          return;
        }

        setStore(selectedStore);
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
      router.push("/");
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
        <HQHeader userName={userName} franchiseName={franchiseName} onLogout={handleLogout} />
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

              <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {[
                  {
                    label: "점주",
                    value: store.ownerNames.length > 0 ? store.ownerNames.join(", ") : "미지정",
                    icon: UserRound,
                  },
                  { label: "등록된 직원", value: `${store.staffCount}명`, icon: Users },
                  { label: "지점 전용 매뉴얼", value: `${store.manualCount}개`, icon: FileText },
                  { label: "등록일", value: formatDate(store.createdAt), icon: CalendarDays },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-md"
                  >
                    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary)]">
                      <item.icon size={19} aria-hidden="true" />
                    </div>
                    <dt className="text-sm text-[var(--color-text-secondary)]">{item.label}</dt>
                    <dd className="mt-1 text-2xl font-bold text-[var(--color-text-primary)]">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}