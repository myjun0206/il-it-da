"use client";

import React, { useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";

const communicationMockData = {
  notices: [
    {
      id: 1,
      target: "전체",
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
      target: "전체",
      title: "추석 연휴 매장 운영 안내",
      date: "2026.09.15",
    },
  ],
};

export default function CommunicationPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("프랜차이즈");

  useLayoutEffect(() => {
    setMounted(true);

    // 로그인 상태 확인
    const loggedInRole = sessionStorage.getItem("loggedInRole");
    if (loggedInRole !== "hq") {
      router.push("/");
      return;
    }

    // 프랜차이즈 정보 가져오기
    const savedFranchiseName = sessionStorage.getItem("loggedInFranchiseName");
    if (savedFranchiseName) {
      setFranchiseName(savedFranchiseName);
    }

    // 사용자 이름 가져오기 (registeredAccounts에서 조회)
    try {
      const loggedInEmail = sessionStorage.getItem("loggedInEmail");
      const accountsJson = sessionStorage.getItem("registeredAccounts");
      if (accountsJson && loggedInEmail) {
        const accounts = JSON.parse(accountsJson);
        const account = accounts.find(
          (acc: any) => acc.companyEmail === loggedInEmail && acc.role === "hq"
        );
        if (account && account.name) {
          setUserName(account.name);
        }
      }
    } catch (e) {
      console.error("사용자 정보 로드 실패:", e);
    }
  }, [router]);

  const handleLogout = () => {
    sessionStorage.clear();
    router.push("/");
  };

  if (!mounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      {/* Sidebar */}
      <HQSidebar
        userName={userName}
        franchiseName={franchiseName}
        onLogout={handleLogout}
        activeMenu="notice"
      />

      {/* Main Content */}
      <div className="lg:ml-[240px]">
        {/* Header */}
        <HQHeader userName={userName} franchiseName={franchiseName} />

        {/* Content */}
        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Page Title */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
              소통
            </h1>
            <p className="text-base text-[var(--color-text-secondary)]">
              본사에서 지점과 점주에게 전달할 소식을 관리합니다.
            </p>
          </div>

          {/* Notices Tab - Currently only tab */}
          <div className="mb-8">
            <div className="border-b border-[var(--color-border)]">
              <button className="pb-3 px-0 text-base font-semibold text-[var(--color-primary)] border-b-2 border-[var(--color-primary)]">
                공지사항
              </button>
            </div>
          </div>

          {/* Notices Section */}
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-base font-bold text-[var(--color-text-primary)] mb-1">
                  공지사항
                </h2>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  전체 지점과 점주에게 전달한 공지를 확인하세요.
                </p>
              </div>
              <button className="px-4 py-2 bg-[var(--color-primary)] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity">
                + 새 공지 작성
              </button>
            </div>

            {/* Notices List */}
            <div className="bg-white border border-[var(--color-border)] rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
                      <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                        대상
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                        제목
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                        작성일
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-[var(--color-text-primary)]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {communicationMockData.notices.map((notice) => (
                      <tr
                        key={notice.id}
                        className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-surface)] transition-colors cursor-pointer"
                      >
                        <td className="px-6 py-4 text-sm text-[var(--color-text-primary)]">
                          <span className="px-2 py-1 bg-[var(--color-bg-surface)] text-xs font-medium text-[var(--color-text-secondary)] rounded">
                            {notice.target}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-[var(--color-text-primary)]">
                          {notice.title}
                        </td>
                        <td className="px-6 py-4 text-sm text-[var(--color-text-secondary)]">
                          {notice.date}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <ChevronRight
                            size={18}
                            className="text-[var(--color-text-secondary)]"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
