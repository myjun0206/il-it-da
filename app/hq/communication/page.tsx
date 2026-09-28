"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Megaphone, Plus, Search } from "lucide-react";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import { createClient } from "@/lib/supabase/client";
import type { HqNoticeItem } from "@/lib/types/notice";

// 목록 표시용 형태. /api/hq/notices 응답에서 대상 라벨을 계산해 만든다.
interface HqNotice {
  id: string;
  target: string;
  title: string;
  createdAt: string;
}

const ALL_TARGETS = "all";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}.${month}.${day}`;
}

const NEW_NOTICE_HREF = "/hq/communication/new";

function CreateNoticeButton({ label }: { label: string }) {
  return (
    <Link
      href={NEW_NOTICE_HREF}
      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
    >
      <Plus size={18} aria-hidden="true" />
      {label}
    </Link>
  );
}

function toNoticeRow(notice: HqNoticeItem): HqNotice {
  return {
    id: notice.id,
    target: notice.targetType === "all" ? "전체 지점" : notice.targetStoreName ?? "삭제된 지점",
    title: notice.title,
    createdAt: notice.createdAt,
  };
}

export default function CommunicationPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("프랜차이즈");
  const [isReady, setIsReady] = useState(false);
  const [notices, setNotices] = useState<HqNotice[]>([]);
  const [isLoadingNotices, setIsLoadingNotices] = useState(true);
  const [noticesError, setNoticesError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [targetFilter, setTargetFilter] = useState(ALL_TARGETS);

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

  useEffect(() => {
    if (!isReady) return;

    const loadNotices = async () => {
      try {
        const response = await fetch("/api/hq/notices");
        const result = (await response.json()) as { notices?: HqNoticeItem[]; error?: string };
        if (!response.ok) {
          throw new Error(result.error || "공지사항을 불러오지 못했습니다.");
        }
        setNotices((result.notices ?? []).map(toNoticeRow));
      } catch (error) {
        console.error("Failed to load notices:", error);
        setNoticesError(error instanceof Error ? error.message : "공지사항을 불러오지 못했습니다.");
      } finally {
        setIsLoadingNotices(false);
      }
    };

    void loadNotices();
  }, [isReady]);

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

  // 대상 필터 값은 실제로 불러온 공지의 대상에서만 만든다.
  const targetOptions = useMemo(
    () => [...new Set(notices.map((notice) => notice.target))].sort((a, b) => a.localeCompare(b)),
    [notices],
  );

  const filteredNotices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return notices
      .filter((notice) => targetFilter === ALL_TARGETS || notice.target === targetFilter)
      .filter((notice) => !query || notice.title.toLowerCase().includes(query))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [notices, searchQuery, targetFilter]);

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
        <HQHeader userName={userName} franchiseName={franchiseName} onLogout={handleLogout} />

        {/* Content */}
        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Page Title - 소통 기능이 여러 개가 되면 이 아래에 탭을 다시 추가한다. */}
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">공지사항</h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                전체 또는 특정 지점에 전달할 공지를 작성하고 관리합니다.
              </p>
            </div>
            <CreateNoticeButton label="새 공지 작성" />
          </div>

          <section aria-label="공지사항 목록">
            {isLoadingNotices ? (
              <div className="bg-white border border-[var(--color-border)] rounded-xl p-8 shadow-sm text-center">
                <p className="text-base text-[var(--color-text-secondary)]" role="status">
                  공지사항을 불러오는 중...
                </p>
              </div>
            ) : noticesError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-base text-red-700" role="alert">
                {noticesError}
              </div>
            ) : notices.length === 0 ? (
              <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                  <Megaphone size={32} className="text-amber-600" aria-hidden="true" />
                </div>
                <p className="text-base text-[var(--color-text-secondary)] mb-2">등록된 공지사항이 없습니다.</p>
                <p className="text-sm text-[var(--color-text-tertiary)] mb-6">
                  새 공지를 작성해 지점과 점주에게 소식을 전달해보세요.
                </p>
                <CreateNoticeButton label="첫 공지 작성" />
              </div>
            ) : (
              <>
                {/* Toolbar */}
                <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="relative w-full md:max-w-sm">
                    <Search
                      size={18}
                      aria-hidden="true"
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                    />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="공지 제목으로 검색"
                      aria-label="공지 제목으로 검색"
                      className="min-h-[44px] w-full rounded-lg border-2 border-[var(--color-border)] bg-white py-2.5 pl-11 pr-4 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30"
                    />
                  </div>
                  <select
                    value={targetFilter}
                    onChange={(event) => setTargetFilter(event.target.value)}
                    aria-label="공지 대상 필터"
                    className="min-h-[44px] rounded-lg border-2 border-[var(--color-border)] bg-white px-4 text-sm font-medium text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/30"
                  >
                    <option value={ALL_TARGETS}>전체 대상</option>
                    {targetOptions.map((target) => (
                      <option key={target} value={target}>
                        {target}
                      </option>
                    ))}
                  </select>
                </div>

                {filteredNotices.length === 0 ? (
                  <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                    <Search size={28} className="mx-auto mb-3 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                    <p className="text-base text-[var(--color-text-secondary)]">검색 조건에 맞는 공지사항이 없습니다.</p>
                  </div>
                ) : (
                  <div className="bg-white border border-[var(--color-border)] rounded-xl shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <caption className="sr-only">공지사항 목록 (최신순)</caption>
                        <thead className="bg-[var(--color-bg-default)] border-b border-[var(--color-border)]">
                          <tr>
                            <th scope="col" className="px-6 py-4 text-left text-sm font-bold text-[var(--color-text-primary)]">대상</th>
                            <th scope="col" className="px-6 py-4 text-left text-sm font-bold text-[var(--color-text-primary)]">제목</th>
                            <th scope="col" className="px-6 py-4 text-left text-sm font-bold text-[var(--color-text-primary)]">작성일</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredNotices.map((notice) => (
                            <tr key={notice.id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-bg-default)] transition-colors">
                              <td className="px-6 py-4 text-base text-[var(--color-text-secondary)]">{notice.target}</td>
                              <td className="px-6 py-4 text-base font-medium text-[var(--color-text-primary)]">{notice.title}</td>
                              <td className="px-6 py-4 text-base text-[var(--color-text-secondary)]">{formatDate(notice.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}