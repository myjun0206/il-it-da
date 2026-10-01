"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import { NoticeCard } from "@/components/notices/NoticeCard";
import { NoticeDetailDialog } from "@/components/notices/NoticeDetailDialog";
import { NoticeEditDialog } from "@/components/notices/NoticeEditDialog";
import { NoticeFilter, type NoticeFilterOption } from "@/components/notices/NoticeFilter";
import { NoticePageHeader } from "@/components/notices/NoticePageHeader";
import { getNoticeViewCountIncrement, markNoticeAsRead } from "@/lib/notices/mark-notice-read";
import { resolveOwnerCurrentStore } from "@/lib/owner/current-store";
import { Input } from "@/components/common/Input";

interface Notice {
  id: string;
  isMine: boolean;
  isRead: boolean;
  viewCount: number;
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

type OwnerNoticeFilter = "all" | "hq" | "mine";

const OWNER_NOTICE_FILTERS: readonly NoticeFilterOption<OwnerNoticeFilter>[] = [
  { value: "all", label: "전체" },
  { value: "hq", label: "본사 공지" },
  { value: "mine", label: "내 공지" },
];

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
  const [sourceFilter, setSourceFilter] = useState<OwnerNoticeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("전체");
  const [selectedNotice, setSelectedNotice] = useState<Notice | null>(null);
  const [editingNotice, setEditingNotice] = useState<Notice | null>(null);
  const [deletingNotice, setDeletingNotice] = useState<Notice | null>(null);
  const [isDeletingNotice, setIsDeletingNotice] = useState(false);

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

        if (!data.session?.user) {
          setIsLoading(false);
          return;
        }

        const name = data.session.user.user_metadata?.name || "점주";
        setUserName(name);

        // 점주 공통 현재 매장 결정 (approved owner membership → store)
        const resolution = await resolveOwnerCurrentStore();
        if (resolution.status === "error") {
          setError("매장 정보를 불러올 수 없습니다.");
          setIsLoading(false);
          return;
        }
        if (!resolution.current) {
          setError("승인된 매장이 없습니다.");
          setIsLoading(false);
          return;
        }
        setSelectedStoreId(resolution.current.storeId);
        setStoreName(resolution.current.storeName);
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

  const updateNotice = async (title: string, content: string) => {
    if (!editingNotice) return;
    const response = await fetch("/api/boss/notices", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: editingNotice.id, title, content }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error || "공지를 수정하지 못했습니다.");

    setNotices((current) => ({
      ...current,
      notices: current.notices.map((notice) =>
        notice.id === editingNotice.id ? { ...notice, title, content } : notice,
      ),
    }));
    setEditingNotice(null);
  };

  const deleteNotice = async () => {
    if (!deletingNotice || isDeletingNotice) return;
    setIsDeletingNotice(true);
    try {
      const response = await fetch("/api/boss/notices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: deletingNotice.id }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "공지를 삭제하지 못했습니다.");

      setNotices((current) => ({
        summary: {
          total: Math.max(0, current.summary.total - 1),
          important: Math.max(0, current.summary.important - Number(deletingNotice.isImportant)),
        },
        notices: current.notices.filter((notice) => notice.id !== deletingNotice.id),
      }));
      setSelectedNotice(null);
      setDeletingNotice(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "공지를 삭제하지 못했습니다.");
      setDeletingNotice(null);
    } finally {
      setIsDeletingNotice(false);
    }
  };

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
    if (sourceFilter === "hq" && notice.isMine) return false;
    if (sourceFilter === "mine" && !notice.isMine) return false;

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

  // 모달 열기
  const handleOpenModal = (notice: Notice) => {
    setSelectedNotice(notice);
    if (notice.isRead) return;

    void markNoticeAsRead(notice.id).then((result) => {
      if (!result.succeeded) return;
      const viewCountIncrement = getNoticeViewCountIncrement(result);
      setNotices((current) => ({
        ...current,
        notices: current.notices.map((currentNotice) =>
          currentNotice.id === notice.id
            ? { ...currentNotice, isRead: true, viewCount: currentNotice.viewCount + viewCountIncrement }
            : currentNotice,
        ),
      }));
      setSelectedNotice((current) => current?.id === notice.id
        ? { ...current, isRead: true, viewCount: current.viewCount + viewCountIncrement }
        : current,
      );
    });
  };

  // 모달 닫기
  const handleCloseModal = () => {
    setSelectedNotice(null);
  };

  if (!isReady || isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-default)] flex">
        <OwnerSidebar activeMenu="notice" onLogout={handleLogout} />
        <div className="flex-1 ml-0 lg:ml-[240px] flex flex-col">
          <OwnerHeader userName={userName} storeName={storeName} onLogout={handleLogout} />
          <main className="flex-1 overflow-y-auto p-6 lg:p-8">
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
        <OwnerHeader userName={userName} storeName={storeName} onLogout={handleLogout} />

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            <NoticePageHeader
              title="공지사항"
              description="본사 공지와 현재 매장의 직원 공지를 확인하세요."
              action={selectedStoreId ? (
                <Link
                  href="/boss/notices/new"
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
                >
                  <Plus size={18} aria-hidden="true" /> 직원 공지 작성
                </Link>
              ) : undefined}
            />

            {/* 현재 매장 */}
            <div className="mb-8">
              <p className="text-sm font-semibold text-[var(--color-text-secondary)] mb-2">
                현재 매장
              </p>
              <p className="text-base lg:text-lg font-semibold text-[var(--color-text-primary)]">
                {storeName}
              </p>
            </div>

            {notices.notices.length > 0 && (
              <div className="mb-6">
                <NoticeFilter
                  ariaLabel="공지 출처"
                  value={sourceFilter}
                  options={OWNER_NOTICE_FILTERS}
                  onChange={setSourceFilter}
                />
              </div>
            )}

            {/* 에러 메시지 */}
            {error && (
              <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
              </div>
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
                        필터 또는 검색 조건을 바꿔보세요.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredNotices.map((notice) => (
                    <NoticeCard
                      key={notice.id}
                      title={notice.title}
                      content={notice.content}
                      sourceLabel={notice.isMine ? `점주 공지 · ${storeName} · ${notice.category}` : `본사 공지 · ${storeName} · ${notice.category}`}
                      createdAt={notice.createdAt}
                      viewCount={notice.viewCount}
                      isRead={notice.isRead}
                      onOpen={() => handleOpenModal(notice)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </main>
      </div>

      {selectedNotice && (
        <NoticeDetailDialog
          notice={{
            ...selectedNotice,
            sourceLabel: selectedNotice.isMine
              ? `점주 공지 · ${storeName} · ${selectedNotice.category}`
              : `본사 공지 · ${storeName} · ${selectedNotice.category}`,
          }}
          onClose={handleCloseModal}
          actions={selectedNotice.isMine ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditingNotice(selectedNotice);
                  handleCloseModal();
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                <Pencil size={16} aria-hidden="true" /> 수정
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeletingNotice(selectedNotice);
                  handleCloseModal();
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-red-200 px-4 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
              >
                <Trash2 size={16} aria-hidden="true" /> 삭제
              </button>
            </>
          ) : undefined}
        />
      )}
      {editingNotice && (
        <NoticeEditDialog
          key={editingNotice.id}
          notice={editingNotice}
          onClose={() => setEditingNotice(null)}
          onSave={updateNotice}
        />
      )}
      <ConfirmDialog
        isOpen={Boolean(deletingNotice)}
        title="공지 삭제"
        description="이 공지를 삭제하시겠습니까? 삭제한 공지는 복구할 수 없습니다."
        confirmText="삭제"
        cancelText="취소"
        isDangerous
        isLoading={isDeletingNotice}
        onConfirm={() => void deleteNotice()}
        onCancel={() => setDeletingNotice(null)}
      />
    </div>
  );
}
