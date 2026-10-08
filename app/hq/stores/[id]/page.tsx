"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Users } from "lucide-react";
import { useParams } from "next/navigation";
import type { HqStoreSummary } from "@/lib/types/store";

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("ko-KR");
}

export default function HqStoreDetailPage() {
  const params = useParams<{ id: string }>();
  const [store, setStore] = useState<HqStoreSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const loadStore = async () => {
      try {

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



  return (
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
              {/* Header */}
              <div className="mb-8 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">{store.name}</h1>
                <Link
                  href={`/hq/manuals/stores?storeId=${encodeURIComponent(store.id)}`}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 border-[var(--color-primary)] bg-[var(--color-primary-light)]/20 px-4 text-base font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-light)]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <FileText size={18} aria-hidden="true" />
                  매뉴얼 보기
                </Link>
              </div>

              {/* Current Status Cards */}
              <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
                {[
                  { label: "등록된 직원", value: `${store.staffCount}명`, icon: Users },
                  { label: "지점 매뉴얼", value: `${store.manualCount}개`, icon: FileText },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border border-[var(--color-border)] bg-white p-6 shadow-sm"
                  >
                    <dt className="mb-3 text-sm font-medium text-[var(--color-text-secondary)]">{item.label}</dt>
                    <div className="flex items-baseline gap-2">
                      <dd className="text-3xl font-bold text-[var(--color-text-primary)]">
                        {item.value.split(/\D+/)[0]}
                      </dd>
                      <span className="text-sm text-[var(--color-text-secondary)]">
                        {item.value.includes("명") ? "명" : "개"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Basic Information */}
              <div className="rounded-lg border border-[var(--color-border)] bg-white p-6 shadow-sm">
                <h2 className="mb-6 text-lg font-bold text-[var(--color-text-primary)]">지점 기본 정보</h2>
                <dl className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  {/* Owner Name */}
                  <div>
                    <dt className="mb-2 text-sm font-medium text-[var(--color-text-secondary)]">점주</dt>
                    <dd className="text-base font-semibold text-[var(--color-text-primary)]">
                      {store.ownerNames.length > 0 ? store.ownerNames.join(", ") : <span className="text-[var(--color-text-tertiary)]">미지정</span>}
                    </dd>
                  </div>

                  {/* Registration Date */}
                  <div>
                    <dt className="mb-2 text-sm font-medium text-[var(--color-text-secondary)]">등록일</dt>
                    <dd className="text-base font-semibold text-[var(--color-text-primary)]">{formatDate(store.createdAt)}</dd>
                  </div>
                </dl>
              </div>
            </>
          ) : null}
        </main>
      );
}