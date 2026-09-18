"use client";

import React, { useLayoutEffect, useEffect, useState } from "react";
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

// Mock Data for Dashboard
const dashboardMockData = {
  pendingTasks: [
    {
      id: 1,
      title: "승인 대기",
      count: 3,
      description: "새로운 점주 또는 지점 승인 요청",
      icon: UserCheck,
    },
    {
      id: 2,
      title: "미처리 문의 · 요청",
      count: 5,
      description: "아직 처리되지 않은 지점 요청",
      icon: MessageSquare,
    },
    {
      id: 3,
      title: "조치 필요 지점",
      count: 3,
      description: "운영 상태 확인이 필요한 지점",
      icon: Store,
    },
  ],
  storeStatus: [
    { label: "전체 지점", count: 128, color: "bg-[var(--color-primary)]" },
    { label: "운영 중", count: 121, color: "bg-green-500" },
    { label: "오픈 준비", count: 4, color: "bg-blue-500" },
    { label: "확인 필요", count: 3, color: "bg-orange-500" },
  ],
  recentRequests: [
    {
      id: 1,
      store: "강남역점",
      content: "신규 메뉴 매뉴얼 관련 문의",
      time: "10분 전",
      status: "대기",
    },
    {
      id: 2,
      store: "홍대점",
      content: "근무 절차 수정 요청",
      time: "1시간 전",
      status: "확인 중",
    },
    {
      id: 3,
      store: "성수점",
      content: "매장 운영 매뉴얼 문의",
      time: "어제",
      status: "완료",
    },
  ],
  manualData: {
    commonManuals: 24,
    lastUpdate: "매장 오픈·마감 체크리스트",
    lastUpdateDate: "오늘",
    storeManuals: 36,
  },
  recentNotices: [
    {
      id: 1,
      target: "전 지점",
      title: "9월 운영 정책 변경 안내",
      date: "2026.09.17",
    },
    {
      id: 2,
      target: "점주",
      title: "신규 메뉴 교육 자료 안내",
      date: "2026.09.16",
    },
    {
      id: 3,
      target: "전 지점",
      title: "추석 연휴 매장 운영 안내",
      date: "2026.09.15",
    },
  ],
};

export default function HQPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("메가MGC커피");
  const [isReady, setIsReady] = useState(false);

  useLayoutEffect(() => {
    // Check Supabase session
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        
        if (!data.session?.user) {
          router.push("/");
          return;
        }

        const user = data.session.user;
        const role = user.user_metadata?.role;

        // Verify user is HQ
        if (role !== "hq") {
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

  const statusBadgeColor = (status: string) => {
    switch (status) {
      case "대기":
        return "bg-yellow-100 text-yellow-700";
      case "확인 중":
        return "bg-blue-100 text-blue-700";
      case "완료":
        return "bg-green-100 text-green-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      {/* Sidebar */}
      <HQSidebar
        userName={userName}
        franchiseName={franchiseName}
        onLogout={handleLogout}
        activeMenu="home"
      />

      {/* Main Content */}
      <div className="lg:ml-[240px]">
        {/* Header */}
        <HQHeader userName={userName} franchiseName={franchiseName} />

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
              {dashboardMockData.pendingTasks.map((task) => {
                const Icon = task.icon;
                return (
                  <div
                    key={task.id}
                    className="bg-white border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-primary)] hover:bg-[var(--color-bg-surface)] transition-all cursor-pointer"
                  >
                    <Icon
                      size={24}
                      className="text-[var(--color-primary)] mb-4"
                    />
                    <p className="text-base font-semibold text-[var(--color-text-primary)] mb-3">
                      {task.title}
                    </p>
                    <p className="text-3xl font-bold text-[var(--color-text-primary)] mb-3">
                      {task.count}
                      <span className="text-base font-normal text-[var(--color-text-secondary)] ml-1">
                        {task.title === "승인 대기" ? "건" : task.title === "미처리 문의 · 요청" ? "건" : "곳"}
                      </span>
                    </p>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {task.description}
                    </p>
                  </div>
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
              <button className="text-sm font-medium text-[var(--color-primary)] hover:text-[var(--color-primary-light)] hover:underline flex items-center gap-2 px-2 py-2 rounded transition-colors" style={{minHeight: '44px'}}>
                전체 지점 보기 <ChevronRight size={16} />
              </button>
            </div>
            <div className="bg-white border border-[var(--color-border)] rounded-lg p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-0">
                {dashboardMockData.storeStatus.map((status, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col items-center justify-center py-6 ${
                      idx < dashboardMockData.storeStatus.length - 1
                        ? "border-r border-[var(--color-border)]"
                        : ""
                    }`}
                  >
                    <p className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">
                      {status.count}
                    </p>
                    <p className="text-sm text-[var(--color-text-secondary)] text-center">
                      {status.label}
                    </p>
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
                <button className="text-sm font-medium text-[var(--color-primary)] hover:text-[var(--color-primary-light)] hover:underline flex items-center gap-2 px-2 py-2 rounded transition-colors" style={{minHeight: '44px'}}>
                  전체 요청 보기 <ChevronRight size={16} />
                </button>
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
                      {dashboardMockData.recentRequests.map((request) => (
                        <tr
                          key={request.id}
                          className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-surface)] transition-colors last:border-b-0"
                        >
                          <td className="px-6 py-4 text-sm text-[var(--color-text-primary)] font-medium">
                            {request.store}
                          </td>
                          <td className="px-6 py-4 text-sm text-[var(--color-text-primary)]">
                            {request.content}
                          </td>
                          <td className="px-6 py-4 text-sm text-[var(--color-text-secondary)]">
                            {request.time}
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`px-3 py-2 rounded text-sm font-medium inline-block ${statusBadgeColor(
                                request.status
                              )}`}
                            >
                              {request.status}
                            </span>
                          </td>
                        </tr>
                      ))}
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
                <button className="text-sm font-medium text-[var(--color-primary)] hover:text-[var(--color-primary-light)] hover:underline flex items-center gap-2 px-2 py-2 rounded transition-colors" style={{minHeight: '44px'}}>
                  매뉴얼 관리 <ChevronRight size={16} />
                </button>
              </div>
              <div className="bg-white border border-[var(--color-border)] rounded-lg p-6 space-y-3 flex-1">
                <div>
                  <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                    공통 매뉴얼
                  </p>
                  <p className="text-2xl font-bold text-[var(--color-text-primary)]">
                    {dashboardMockData.manualData.commonManuals}
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
                    {dashboardMockData.manualData.storeManuals}
                    <span className="text-sm font-normal text-[var(--color-text-secondary)]"> 개 지점에서 사용 중</span>
                  </p>
                </div>

                <div className="border-t border-[var(--color-border)] pt-3">
                  <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                    최근 업데이트
                  </p>
                  <p className="text-sm font-medium text-[var(--color-text-primary)] mb-1">
                    {dashboardMockData.manualData.lastUpdate}
                  </p>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {dashboardMockData.manualData.lastUpdateDate}
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

