"use client";

import React, { useLayoutEffect, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  UserCheck,
  MessageSquare,
  Store,
  ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";

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
    id: 2,
    title: "미처리 문의 · 요청",
    description: "아직 처리되지 않은 지점 요청",
    icon: MessageSquare,
    // 문의·요청 페이지의 "미처리" 업무 화면. 문의 테이블이 아직 없어 0건으로 표시된다.
    href: "/hq/stores/requests?view=unresolved",
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
  const router = useRouter();
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("메가MGC커피");
  const [isReady, setIsReady] = useState(false);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [storesWithoutOwnerCount, setStoresWithoutOwnerCount] = useState(0);
  const [storesWithOwnerCount, setStoresWithOwnerCount] = useState(0);
  const [ownerCount, setOwnerCount] = useState(0);
  const [commonManualCount, setCommonManualCount] = useState(0);
  const [storesWithManualsCount, setStoresWithManualsCount] = useState(0);
  const [totalStores, setTotalStores] = useState(0);

  useLayoutEffect(() => {
    // Check Supabase session
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getUser();
        
        if (error || !data.user) {
          router.push("/");
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", data.user.id)
          .maybeSingle<{ role: string }>();

        // Verify user is HQ
        if (profile?.role !== "hq") {
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
    // Set user info from metadata
    const setUserInfo = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        
        if (!data.session?.user) return;

        const user = data.session.user;
        const name = user.user_metadata?.name;

        // Set user name from metadata
        if (name) {
          setUserName(name);
        }

        // Extract franchise name from user name or use default
        // Format: "메가MGC커피 본사 관리자" -> "메가MGC커피"
        if (name && name.includes(" ")) {
          const parts = name.split(" ");
          if (parts[0]) {
            setFranchiseName(parts[0]);
          }
        }

        setIsReady(true);
      } catch (e) {
        console.error("Set user info failed:", e);
        setIsReady(true);
      }
    };

    setUserInfo();
  }, []);

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
        const manualsResponse = await fetch("/api/manuals", { credentials: "include" });
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

    if (isReady) {
      fetchDashboardData();
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

  if (!isReady) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      {/* Sidebar */}
      <HQSidebar
        userName={userName}
        franchiseName={franchiseName}
        onLogout={handleLogout}
        activeMenu="home"
      />
      <div className="lg:ml-[240px]">
        {/* Header */}
        <HQHeader userName={userName} franchiseName={franchiseName} onLogout={handleLogout} />

        {/* Content */}
        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Greeting Section */}
          <div className="mb-9">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
              안녕하세요, {userName}님
            </h1>
            <p className="text-base text-[var(--color-text-secondary)]">
              {franchiseName}의 오늘 운영 현황을 확인해보세요.
            </p>
          </div>

          {/* Pending Tasks Section */}
          <div className="mb-12">
            <h2 className="text-base font-bold text-[var(--color-text-primary)] mb-5">
              확인이 필요한 업무
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {pendingTasksConfig.map((task) => {
                const Icon = task.icon;
                let count = 0;
                if (task.id === 1) {
                  count = pendingApprovalsCount;
                } else if (task.id === 2) {
                  count = 0; // inquiries 테이블 없음
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
                        {task.title === "승인 대기" ? "건" : task.title === "미처리 문의 · 요청" ? "건" : "곳"}
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

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.75fr_1fr] gap-8 items-stretch">
            {/* Recent Requests */}
            <div className="flex flex-col">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                  최근 지점 문의 · 요청
                </h2>
                <Link href="/hq/stores/requests" className="text-sm font-medium text-[var(--color-primary)] hover:underline flex items-center gap-2 px-2 rounded transition-colors min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
                  전체 요청 보기 <ChevronRight size={16} aria-hidden="true" />
                </Link>
              </div>
              <div className="bg-white border border-[var(--color-border)] rounded-lg overflow-hidden flex-1">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
                        <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                          지점명
                        </th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                          요청 내용
                        </th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                          시간
                        </th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                          상태
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-[var(--color-border)]">
                        <td colSpan={4} className="px-6 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                          아직 접수된 문의·요청이 없습니다.
                        </td>
                      </tr>
                    </tbody>
                  </table>
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
          </div>
        </main>
      </div>
    </div>
  );
}
