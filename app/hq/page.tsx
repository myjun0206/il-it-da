"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  UserCheck,
  Store,
  ChevronRight,
} from "lucide-react";

// Pending tasks configuration (counts will be fetched from DB)
const pendingTasksConfig = [
  {
    id: 1,
    title: "승인 대기",
    description: "새로운 점주 또는 지점 승인 요청",
    icon: UserCheck,
    href: "/hq/approvals",
  },
  {
    id: 3,
    // "조치 필요" 판별 기준이 DB/API에 없어, 실제로 판별 가능한 "점주 미등록" 기준을 쓴다.
    title: "점주 미등록 지점",
    description: "담당 점주가 등록되지 않은 지점",
    icon: Store,
    href: "/hq/stores?view=no-owner",
  },
];

export default function HQPage() {
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [storesWithoutOwnerCount, setStoresWithoutOwnerCount] = useState(0);
  const [storesWithOwnerCount, setStoresWithOwnerCount] = useState(0);
  const [ownerCount, setOwnerCount] = useState(0);
  const [commonManualCount, setCommonManualCount] = useState(0);
  const [storesWithManualsCount, setStoresWithManualsCount] = useState(0);
  const [totalStores, setTotalStores] = useState(0);

  useEffect(() => {
    // Fetch pending approvals count and total stores
    const fetchDashboardData = async () => {
      try {
        // Fetch pending approvals
        const response = await fetch("/api/hq/approvals?status=pending", { credentials: "include" });
        const result = await response.json();
        if (result.success && Array.isArray(result.data)) {
          setPendingApprovalsCount(result.data.length);
        }

        // 지점 수치: 지점 현황·매뉴얼 관리와 같은 franchise 범위 API(/api/hq/stores)로 계산한다.
        const storesResponse = await fetch("/api/hq/stores", { credentials: "include" });
        if (storesResponse.ok) {
          const storesResult = (await storesResponse.json()) as {
            stores?: { ownerNames: string[]; manualCount: number }[];
          };
          const stores = storesResult.stores ?? [];
          setTotalStores(stores.length);
          setStoresWithOwnerCount(stores.filter((store) => store.ownerNames.length > 0).length);
          setStoresWithoutOwnerCount(stores.filter((store) => store.ownerNames.length === 0).length);
          setOwnerCount(stores.reduce((sum, store) => sum + store.ownerNames.length, 0));
          setStoresWithManualsCount(stores.filter((store) => store.manualCount > 0).length);
        }

        // 공통 매뉴얼: 매뉴얼 관리 Overview와 같은 /api/manuals 기준(store_id 없는 매뉴얼).
        const manualsResponse = await fetch("/api/manuals", { credentials: "include", cache: "no-store" });
        if (manualsResponse.ok) {
          const manualsResult = (await manualsResponse.json()) as {
            manuals?: { store_id: string | null; scope_type?: string | null }[];
          };
          setCommonManualCount(
            (manualsResult.manuals ?? []).filter((manual) => manual.scope_type === "hq" || !manual.store_id).length,
          );
        }
      } catch (e) {
        console.error("Failed to fetch dashboard data:", e);
      }
    };

    fetchDashboardData();
  }, []);

  return (
    <main className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Greeting Section */}
      <div className="mb-9">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
          안녕하세요, 본사 관리자님
        </h1>
        <p className="text-base text-[var(--color-text-secondary)]">
          메가MGC커피의 오늘 운영 현황을 확인해보세요.
        </p>
      </div>

      {/* Pending Tasks Section */}
      <div className="mb-12">
        <h2 className="text-base font-bold text-[var(--color-text-primary)] mb-5">
          확인이 필요한 업무
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {pendingTasksConfig.map((task) => {
                const Icon = task.icon;
                let count = 0;
                if (task.id === 1) {
                  count = pendingApprovalsCount;
                } else if (task.id === 3) {
                  count = storesWithoutOwnerCount;
                }
                return (
                  <Link
                    key={task.id}
                    href={task.href}
                    className="block cursor-pointer bg-white border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-primary)] hover:bg-[var(--color-bg-surface)] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
                  >
                    <Icon
                      size={24}
                      aria-hidden="true"
                      className="text-[var(--color-primary)] mb-4"
                    />
                    <p className="text-base font-semibold text-[var(--color-text-primary)] mb-3">
                      {task.title}
                    </p>
                    <p className="text-3xl font-bold text-[var(--color-text-primary)] mb-3">
                      {count}
                      <span className="text-base font-normal text-[var(--color-text-secondary)] ml-1">
                        {task.title === "승인 대기" ? "건" : "곳"}
                      </span>
                    </p>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {task.description}
                    </p>
                  </Link>
                );
              })}
        </div>
      </div>

      {/* Store Status Section - Unified Panel */}
      <div className="mb-12">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-[var(--color-text-primary)]">
            지점 운영 현황
          </h2>
          <Link href="/hq/stores" className="text-sm font-medium text-[var(--color-primary)] hover:underline flex items-center gap-2 px-2 rounded transition-colors min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
            전체 지점 보기 <ChevronRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <div className="bg-white border border-[var(--color-border)] rounded-lg p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0">
            {[
                  { label: "전체 지점", value: totalStores },
                  { label: "점주 등록 지점", value: storesWithOwnerCount },
                  { label: "점주 미등록 지점", value: storesWithoutOwnerCount },
                  { label: "등록된 점주", value: ownerCount },
                ].map((stat, index) => (
                  <div
                    key={stat.label}
                    className={`flex flex-col items-center justify-center py-6 ${
                      index < 3 ? "md:border-r md:border-[var(--color-border)]" : ""
                    } ${index % 2 === 0 ? "border-r border-[var(--color-border)]" : ""}`}
                  >
                    <p className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">{stat.value}</p>
                    <p className="text-sm text-[var(--color-text-secondary)] text-center">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Manual Status */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                매뉴얼 현황
              </h2>
              <Link href="/hq/manuals" className="text-sm font-medium text-[var(--color-primary)] hover:underline flex items-center gap-2 px-2 rounded transition-colors min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
                매뉴얼 관리 <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <div className="bg-white border border-[var(--color-border)] rounded-lg p-6 space-y-3 flex-1">
              <div>
                <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                  공통 매뉴얼
                </p>
                <p className="text-2xl font-bold text-[var(--color-text-primary)]">
                  {commonManualCount}
                  <span className="text-sm font-normal text-[var(--color-text-secondary)] ml-1">
                    개
                  </span>
                </p>
              </div>

              <div className="border-t border-[var(--color-border)] pt-3">
                <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                  지점별 매뉴얼
                </p>
                <p className="text-base text-[var(--color-text-primary)] font-medium">
                  {storesWithManualsCount}
                  <span className="text-sm font-normal text-[var(--color-text-secondary)]"> 개 지점에서 사용 중</span>
                </p>
              </div>
            </div>
          </div>
    </main>
  );
}
