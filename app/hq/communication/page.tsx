"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import { createClient } from "@/lib/supabase/client";

export default function CommunicationPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("프랜차이즈");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const setUserInfo = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();

        if (!data.user) {
          router.push("/");
          return;
        }

        const name = data.user.user_metadata?.name;

        if (name) {
          setUserName(name);
        }

        // 기존에 저장된 프랜차이즈 이름이 있으면 화면 표시용으로 사용
        const savedFranchiseName = sessionStorage.getItem(
          "loggedInFranchiseName"
        );

        if (savedFranchiseName) {
          setFranchiseName(savedFranchiseName);
        } else if (name && name.includes(" ")) {
          const parts = name.split(" ");

          if (parts[0]) {
            setFranchiseName(parts[0]);
          }
        }

        setIsReady(true);
      } catch (error) {
        console.error("Set user info failed:", error);
        router.push("/");
      }
    };

    setUserInfo();
  }, [router]);

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      sessionStorage.clear();
      router.push("/");
    } catch (error) {
      console.error("Logout failed:", error);
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
                    <tr className="border-b border-[var(--color-border)]">
                      <td
                        colSpan={4}
                        className="px-6 py-8 text-center text-sm text-[var(--color-text-secondary)]"
                      >
                        등록된 공지사항이 없습니다.
                      </td>
                    </tr>
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