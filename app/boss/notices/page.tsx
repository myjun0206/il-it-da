"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import { Input } from "@/components/common/Input";
import { Button } from "@/components/common/Button";

interface Notice {
  id: string;
  title: string;
  content: string;
  category: "운영 안내" | "매뉴얼" | "교육" | "시스템" | "기타";
  isImportant: boolean;
  createdAt: string;
  updatedAt: string;
  franchiseName: string;
}

interface NoticesData {
  notices: Notice[];
  summary: {
    total: number;
    important: number;
  };
}

interface ModalState {
  isOpen: boolean;
  notice: Notice | null;
}

// 날짜 포맷팅
function formatDate(dateString: string): string {
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

// 카테고리별 색상
function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    "운영 안내": "bg-blue-50 text-blue-700 border border-blue-200",
    "매뉴얼": "bg-green-50 text-green-700 border border-green-200",
    "교육": "bg-purple-50 text-purple-700 border border-purple-200",
    "시스템": "bg-orange-50 text-orange-700 border border-orange-200",
    "기타": "bg-gray-50 text-gray-700 border border-gray-200",
  };
  return colors[category] || colors["기타"];
}

export default function NoticesPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [userName, setUserName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [notices, setNotices] = useState<NoticesData>({
    notices: [],
    summary: { total: 0, important: 0 },
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("전체");
  const [modal, setModal] = useState<ModalState>({ isOpen: false, notice: null });

  // Categories available
  const categories = ["전체", "운영 안내", "매뉴얼", "교육", "시스템", "기타"];

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

  // 사용자 정보 및 매장 로드
  useEffect(() => {
    const loadUserAndStoreInfo = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) return;

        const name = data.session.user.user_metadata?.name || "점주";
        setUserName(name);

        // sessionStorage에서 선택된 매장 정보
        const storedStoreId = sessionStorage.getItem("selectedStoreId") || "";
        const storedStoreName = sessionStorage.getItem("selectedStoreName") || "";

        // 서버 검증
        try {
          const response = await fetch("/api/signup/store-membership");
          const result = (await response.json()) as {
            success?: boolean;
            data?: Array<{ storeId: string; storeName: string; status: string; role: string }>;
          };

          if (response.ok && result.data) {
            const approvedStores = result.data.filter(
              (m) => m.status === "approved" && m.role === "owner",
            );

            if (approvedStores.length === 0) {
              setError("승인된 매장이 없습니다.");
              setIsLoading(false);
              return;
            }

            let storeId = storedStoreId;
            let storeName = storedStoreName;

            if (!storeId || !approvedStores.some((s) => s.storeId === storeId)) {
              storeId = approvedStores[0]?.storeId || "";
              storeName = approvedStores[0]?.storeName || "";
              sessionStorage.setItem("selectedStoreId", storeId);
              sessionStorage.setItem("selectedStoreName", storeName);
            }

            setSelectedStoreId(storeId);
            setStoreName(storeName);
          }
        } catch (e) {
          console.error("Failed to fetch store membership:", e);
          setError("매장 정보를 불러올 수 없습니다.");
          setIsLoading(false);
          return;
        }
      } catch (e) {
        console.error("Failed to load user info:", e);
        setIsLoading(false);
      }
    };

    if (isReady) {
      loadUserAndStoreInfo();
    }
  }, [isReady]);

  // 공지사항 조회
  useEffect(() => {
    const fetchNotices = async () => {
      if (!selectedStoreId) return;

      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/boss/notices?storeId=${selectedStoreId}`);
        const data = (await response.json()) as { success: boolean; data?: NoticesData; error?: string };

        if (!response.ok || !data.success) {
          throw new Error(data.error || "공지사항을 불러올 수 없습니다.");
        }

        setNotices(data.data || { notices: [], summary: { total: 0, important: 0 } });
      } catch (e) {
        console.error("Failed to fetch notices:", e);
        setError(e instanceof Error ? e.message : "공지사항을 불러올 수 없습니다.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchNotices();
  }, [selectedStoreId]);

  // 로그아웃
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

  // 검색 및 필터링
  const filteredNotices = notices.notices.filter((notice) => {
    // 카테고리 필터
    if (categoryFilter !== "전체" && notice.category !== categoryFilter) {
      return false;
    }

    // 검색 필터
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;

    return (
      notice.title.toLowerCase().includes(query) ||
      notice.content.toLowerCase().includes(query)
    );
  });

  // 중요 공지와 일반 공지 분리
  const importantNotices = filteredNotices.filter((n) => n.isImportant);
  const regularNotices = filteredNotices.filter((n) => !n.isImportant);

  // 모달 열기
  const handleOpenModal = (notice: Notice) => {
    setModal({ isOpen: true, notice });
  };

  // 모달 닫기
  const handleCloseModal = () => {
    setModal({ isOpen: false, notice: null });
  };

  if (!isReady || isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-default)] flex">
        <OwnerSidebar activeMenu="notice" onLogout={handleLogout} />
        <div className="flex-1 ml-0 lg:ml-[240px] flex flex-col">
          <OwnerHeader userName={userName} storeName={storeName} />
          <main className="flex-1 p-8">
            <div className="text-center">로딩 중...</div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex">
      <OwnerSidebar activeMenu="notice" onLogout={handleLogout} />

      <div className="flex-1 ml-0 lg:ml-[240px] flex flex-col">
        <OwnerHeader userName={userName} storeName={storeName} />

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="px-5 sm:px-8 lg:px-12 xl:px-16 py-8 lg:py-12">
            {/* 페이지 제목 */}
            <div className="mb-8">
              <h1 className="text-3xl lg:text-4xl font-bold text-[var(--color-text-primary)] mb-2">
                공지사항
              </h1>
              <p className="text-lg text-[var(--color-text-secondary)]">
                본사에서 전달한 공지사항과 운영 안내를 확인하세요.
              </p>
            </div>

            {/* 현재 매장 */}
            <div className="mb-8">
              <p className="text-sm font-semibold text-[var(--color-text-secondary)] mb-2">
                현재 매장
              </p>
              <p className="text-base lg:text-lg font-semibold text-[var(--color-text-primary)]">
                {storeName}
              </p>
            </div>

            {/* 에러 메시지 */}
            {error && (
              <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* 중요 공지 */}
            {importantNotices.length > 0 && (
              <section className="mb-12">
                <h2 className="text-xl lg:text-2xl font-bold text-[var(--color-text-primary)] mb-6">
                  중요 공지
                </h2>
                <div className="space-y-3">
                  {importantNotices.map((notice) => (
                    <div
                      key={notice.id}
                      onClick={() => handleOpenModal(notice)}
                      className="bg-white border border-[var(--color-border)] rounded-lg p-4 lg:p-6 cursor-pointer hover:shadow-md hover:border-[var(--color-primary)] transition-all group"
                    >
                      <div className="flex items-start gap-3 mb-3">
                        <span className="text-xs font-bold text-[var(--color-primary)] bg-[var(--color-primary-light)]/20 px-2 py-1 rounded flex-shrink-0">
                          중요
                        </span>
                        <span className={`text-xs font-medium px-2 py-1 rounded flex-shrink-0 ${getCategoryColor(notice.category)}`}>
                          {notice.category}
                        </span>
                      </div>
                      <h3 className="text-base lg:text-lg font-semibold text-[var(--color-text-primary)] mb-2 group-hover:text-[var(--color-primary)] transition-colors line-clamp-2">
                        {notice.title}
                      </h3>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        {formatDate(notice.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 공지사항 목록 */}
            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl lg:text-2xl font-bold text-[var(--color-text-primary)]">
                  공지사항
                </h2>
                {notices.summary.total > 0 && (
                  <span className="text-sm font-semibold text-[var(--color-text-secondary)]">
                    총 {notices.summary.total}개
                  </span>
                )}
              </div>

              {/* 검색 및 필터 */}
              <div className="mb-6 flex flex-col lg:flex-row gap-3">
                <div className="flex-1 relative">
                  <Search
                    size={20}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
                  />
                  <Input
                    type="text"
                    placeholder="공지사항을 검색해보세요."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-12"
                  />
                </div>

                <div className="flex-shrink-0">
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="h-12 px-4 border border-[var(--color-border)] rounded-lg bg-white text-[var(--color-text-primary)] font-medium hover:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)]"
                  >
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 공지 목록 */}
              {filteredNotices.length === 0 ? (
                <div className="bg-white border border-[var(--color-border)] rounded-lg p-12 text-center">
                  {notices.notices.length === 0 ? (
                    <>
                      <p className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
                        등록된 공지사항이 없습니다.
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        본사에서 새로운 공지를 등록하면 이곳에서 확인할 수 있습니다.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
                        검색 결과가 없습니다.
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        다른 검색어를 입력해보세요.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {regularNotices.map((notice) => (
                    <div
                      key={notice.id}
                      onClick={() => handleOpenModal(notice)}
                      className="bg-white border border-[var(--color-border)] rounded-lg p-4 lg:p-6 cursor-pointer hover:shadow-md hover:border-[var(--color-primary)] transition-all group"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-xs font-medium px-2 py-1 rounded flex-shrink-0 ${getCategoryColor(notice.category)}`}>
                              {notice.category}
                            </span>
                          </div>
                          <h3 className="text-base lg:text-lg font-semibold text-[var(--color-text-primary)] group-hover:text-[var(--color-primary)] transition-colors line-clamp-2 mb-2">
                            {notice.title}
                          </h3>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <p className="text-sm text-[var(--color-text-secondary)] whitespace-nowrap">
                            {formatDate(notice.createdAt)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </main>
      </div>

      {/* Detail Modal */}
      {modal.isOpen && modal.notice && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-0">
          <div className="bg-white w-full lg:max-w-2xl lg:rounded-lg rounded-t-2xl max-h-[90vh] lg:max-h-[80vh] flex flex-col overflow-hidden">
            {/* Sticky Header */}
            <div className="sticky top-0 border-b border-[var(--color-border)] bg-white p-6 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  {modal.notice.isImportant && (
                    <span className="text-xs font-bold text-[var(--color-primary)] bg-[var(--color-primary-light)]/20 px-2 py-1 rounded">
                      중요
                    </span>
                  )}
                  <span className={`text-xs font-medium px-2 py-1 rounded ${getCategoryColor(modal.notice.category)}`}>
                    {modal.notice.category}
                  </span>
                </div>
                <h2 className="text-xl lg:text-2xl font-bold text-[var(--color-text-primary)]">
                  {modal.notice.title}
                </h2>
              </div>
              <button
                onClick={handleCloseModal}
                className="flex-shrink-0 p-2 hover:bg-[var(--color-bg-surface)] rounded-lg transition-colors"
                aria-label="닫기"
              >
                <X size={24} className="text-[var(--color-text-secondary)]" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6">
              <p className="text-sm text-[var(--color-text-secondary)] mb-6 pb-6 border-b border-[var(--color-border)]">
                {formatDate(modal.notice.createdAt)}
              </p>

              <div className="prose prose-sm max-w-none text-[var(--color-text-primary)]">
                <div className="whitespace-pre-wrap text-base leading-relaxed">
                  {modal.notice.content}
                </div>
              </div>
            </div>

            {/* Sticky Footer */}
            <div className="sticky bottom-0 border-t border-[var(--color-border)] bg-white p-6">
              <Button
                onClick={handleCloseModal}
                className="w-full h-12"
              >
                닫기
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
