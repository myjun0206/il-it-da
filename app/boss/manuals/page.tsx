"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ChevronRight, X, BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import { Input } from "@/components/common/Input";
import type { ManualRecord } from "@/lib/types/manual";

type ManualGroup = {
  id: string;
  title: string;
  items: ManualRecord[];
  updatedAt: string;
};

type SortOption = "recent" | "oldest" | "name";

// 부모/자식 구조로 매뉴얼을 그룹화
function groupByParent(manuals: ManualRecord[]): ManualGroup[] {
  const topLevel = manuals.filter((manual) => !manual.parent_manual_id);
  const childrenByParent = new Map<string, ManualRecord[]>();

  for (const manual of manuals) {
    if (!manual.parent_manual_id) continue;
    const list = childrenByParent.get(manual.parent_manual_id) ?? [];
    list.push(manual);
    childrenByParent.set(manual.parent_manual_id, list);
  }

  return topLevel.map((parent) => {
    const children = childrenByParent.get(parent.id) ?? [];
    return {
      id: parent.id,
      title: parent.title,
      items: children.length > 0 ? children : [parent],
      updatedAt: parent.updated_at,
    };
  });
}

// 날짜 포맷팅
function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}.${month}.${day}`;
  } catch {
    return "";
  }
}

// 정렬 함수
function sortGroups(groups: ManualGroup[], sortBy: SortOption): ManualGroup[] {
  const sorted = [...groups];
  if (sortBy === "recent") {
    sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } else if (sortBy === "oldest") {
    sorted.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
  } else if (sortBy === "name") {
    sorted.sort((a, b) => a.title.localeCompare(b.title, "ko"));
  }
  return sorted;
}

export default function OwnerManualsPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [userName, setUserName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [manuals, setManuals] = useState<ManualRecord[]>([]);
  const [isLoadingManuals, setIsLoadingManuals] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [selectedGroup, setSelectedGroup] = useState<ManualGroup | null>(null);
  const [toastMessage, setToastMessage] = useState("");

  // Auth 확인
  useLayoutEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user || data.session.user.user_metadata?.role !== "owner") {
          router.push("/");
          return;
        }

        setIsReady(true);
      } catch (e) {
        console.error("Auth check failed:", e);
        router.push("/");
      }
    };

    checkAuth();
  }, [router]);

  // 사용자 정보 로드
  useEffect(() => {
    const setUserInfo = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) return;

        const name = data.session.user.user_metadata?.name || "점주";
        setUserName(name);

        // sessionStorage에서 선택된 지점 정보 가져오기
        const storedStoreName = sessionStorage.getItem("selectedStoreName") || "선택된 지점";
        setStoreName(storedStoreName);
      } catch (e) {
        console.error("Failed to set user info:", e);
      }
    };

    setUserInfo();
  }, []);

  // 매뉴얼 조회
  const fetchManuals = useCallback(async () => {
    setIsLoadingManuals(true);
    setError("");
    try {
      const response = await fetch("/api/manuals");
      const data = (await response.json()) as { manuals?: ManualRecord[]; error?: string };

      if (!response.ok || !data.manuals) {
        throw new Error(data.error || "매뉴얼 목록을 불러오지 못했습니다.");
      }

      setManuals(data.manuals);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "매뉴얼 목록을 불러오지 못했습니다.";
      setError(errorMsg);
      console.error("Failed to fetch manuals:", e);
    } finally {
      setIsLoadingManuals(false);
    }
  }, []);

  // 초기 로드
  useEffect(() => {
    if (isReady) {
      const loadData = async () => {
        await fetchManuals();
      };
      void loadData();
    }
  }, [isReady, fetchManuals]);

  // 토스트 메시지
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(""), 2500);
  };

  // 매뉴얼 그룹화
  const groups = groupByParent(manuals);

  // 검색 필터링
  const filteredGroups = groups.filter((group) => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;

    return (
      group.title.toLowerCase().includes(query) ||
      group.items.some((item) => item.content?.toLowerCase().includes(query))
    );
  });

  // 정렬 적용
  const sortedAndFilteredGroups = sortGroups(filteredGroups, sortBy);

  // 로그아웃 핸들러
  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
    } catch (e) {
      console.error("Logout failed:", e);
      showToast("로그아웃 중 오류가 발생했습니다.");
    }
  };

  if (!isReady) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <OwnerSidebar activeMenu="manual-common" onLogout={handleLogout} />

      <div className="lg:ml-[240px]">
        <OwnerHeader userName={userName} storeName={storeName} />

        <main className="p-6 lg:p-8">
          <div className="max-w-6xl mx-auto">
            {/* 페이지 제목 영역 */}
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                공통 매뉴얼
              </h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                본사에서 배포한 업무 매뉴얼을 확인하세요.
              </p>
            </div>

            {/* 검색 영역 */}
            <div className="mb-6">
              <div className="relative">
                <Search
                  size={20}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
                />
                <Input
                  type="text"
                  placeholder="매뉴얼을 검색해보세요."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-12"
                />
              </div>
            </div>

            {/* 정보/정렬 툴바 */}
            {!isLoadingManuals && manuals.length > 0 && (
              <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="text-sm text-[var(--color-text-secondary)]">
                  {searchQuery.trim()
                    ? `검색 결과 ${sortedAndFilteredGroups.length}개`
                    : `전체 매뉴얼 ${groups.length}개`}
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-[var(--color-text-secondary)] hidden sm:inline">
                    정렬:
                  </label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="px-3 py-2 border-2 border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] bg-white hover:border-[var(--color-primary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30 transition-colors"
                  >
                    <option value="recent">최근 업데이트순</option>
                    <option value="oldest">오래된 업데이트순</option>
                    <option value="name">이름순</option>
                  </select>
                </div>
              </div>
            )}

            {/* 에러 상태 */}
            {error && !isLoadingManuals && (
              <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* 로딩 상태 */}
            {isLoadingManuals && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-8 h-8 border-3 border-[var(--color-border)] border-t-[var(--color-primary)] rounded-full animate-spin" />
                <p className="mt-4 text-[var(--color-text-secondary)]">매뉴얼 로딩 중...</p>
              </div>
            )}

            {/* 빈 상태 */}
            {!isLoadingManuals && manuals.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center py-12">
                <BookOpen size={48} className="text-[var(--color-border)] mb-4" />
                <p className="text-base font-semibold text-[var(--color-text-primary)] mb-2">
                  등록된 공통 매뉴얼이 없습니다.
                </p>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  본사에서 매뉴얼을 배포하면
                </p>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  이곳에서 확인할 수 있습니다.
                </p>
              </div>
            )}

            {/* 검색 결과 없음 */}
            {!isLoadingManuals && manuals.length > 0 && sortedAndFilteredGroups.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12">
                <Search size={48} className="text-[var(--color-border)] mb-4" />
                <p className="text-base font-semibold text-[var(--color-text-primary)] mb-2">
                  검색 결과가 없습니다.
                </p>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  다른 검색어로 다시 찾아보세요.
                </p>
              </div>
            )}

            {/* 매뉴얼 카드 목록 */}
            {!isLoadingManuals && sortedAndFilteredGroups.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {sortedAndFilteredGroups.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => setSelectedGroup(group)}
                    className="block text-left p-6 bg-white border-2 border-[var(--color-border)] rounded-lg hover:border-[var(--color-primary)] hover:shadow-md transition-all duration-200"
                  >
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-[var(--color-text-primary)] truncate">
                          {group.title}
                        </h3>
                      </div>
                      <ChevronRight size={20} className="text-[var(--color-primary)] flex-shrink-0" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        하위 항목 {group.items.length}개
                      </p>
                      {formatDate(group.updatedAt) && (
                        <p className="text-xs text-[var(--color-text-secondary)]">
                          최근 업데이트 {formatDate(group.updatedAt)}
                        </p>
                      )}
                    </div>
                    <div className="mt-4 text-sm text-[var(--color-primary)] font-medium">
                      자세히 보기 →
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 상세 보기 모달 */}
      {selectedGroup && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white w-full sm:max-w-2xl sm:rounded-lg rounded-t-lg max-h-[90vh] overflow-y-auto">
            {/* 헤더 */}
            <div className="sticky top-0 bg-white border-b border-[var(--color-border)] p-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--color-text-primary)] truncate">
                {selectedGroup.title}
              </h2>
              <button
                onClick={() => setSelectedGroup(null)}
                className="flex-shrink-0 ml-4 p-2 hover:bg-[var(--color-bg-surface)] rounded-lg transition-colors"
              >
                <X size={24} className="text-[var(--color-text-secondary)]" />
              </button>
            </div>

            {/* 내용 */}
            <div className="p-6">
              {selectedGroup.items.map((item, index) => (
                <div key={item.id} className={index > 0 ? "mt-8 pt-8 border-t border-[var(--color-border)]" : ""}>
                  {item.title && item.title !== selectedGroup.title && (
                    <h4 className="text-base font-semibold text-[var(--color-text-primary)] mb-3">
                      {item.title}
                    </h4>
                  )}
                  <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                    {item.content}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 토스트 메시지 */}
      {toastMessage && (
        <div className="fixed bottom-6 left-6 right-6 sm:left-auto sm:right-6 sm:w-auto bg-[var(--color-text-primary)] text-white px-4 py-3 rounded-lg text-sm">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
