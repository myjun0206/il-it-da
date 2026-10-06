"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Megaphone, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import { NoticeReadStatus } from "@/components/notices/NoticeReadStatus";
import { NoticeDetailDialog } from "@/components/notices/NoticeDetailDialog";
import { NoticeEditDialog } from "@/components/notices/NoticeEditDialog";
import { NoticeFilter, type NoticeFilterOption } from "@/components/notices/NoticeFilter";
import { NoticePageHeader } from "@/components/notices/NoticePageHeader";
import { getNoticeViewCountIncrement, markNoticeAsRead } from "@/lib/notices/mark-notice-read";
import { resolveOwnerCurrentStore } from "@/lib/owner/current-store";

const stateBoxClass = "rounded-xl border border-[var(--color-border)] bg-white p-8 text-center";

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
        <div className="flex-1 min-w-0 ml-0 lg:ml-[240px] flex flex-col">
          <OwnerHeader userName={userName} storeName={storeName} onLogout={handleLogout} />
          <main className="flex-1 overflow-y-auto p-6 lg:p-8">
            <div className="mx-auto max-w-7xl">
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">공지사항</h1>
                <p className="text-base text-[var(--color-text-secondary)]">본사 공지와 현재 매장의 직원 공지를 확인하세요.</p>
              </div>
              <div className={stateBoxClass}>
                <p className="text-base text-[var(--color-text-secondary)]" role="status">공지사항을 불러오는 중...</p>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex">
      <OwnerSidebar activeMenu="notice" onLogout={handleLogout} />

      <div className="flex-1 min-w-0 ml-0 lg:ml-[240px] flex flex-col">
        <OwnerHeader userName={userName} storeName={storeName} onLogout={handleLogout} />

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            <NoticePageHeader
              title="공지사항"
              description={storeName ? `본사 공지와 ${storeName}의 직원 공지를 확인하세요.` : "본사 공지와 현재 매장의 직원 공지를 확인하세요."}
              action={selectedStoreId ? (
                <Link
                  href="/boss/notices/new"
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
                >
                  <Plus size={18} aria-hidden="true" /> 직원 공지 작성
                </Link>
              ) : undefined}
            />

            {/* 에러 메시지 */}
            {error && (
              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* 공지사항 목록 */}
            <section aria-label="공지사항 목록">
              {/* 검색 */}
              <div className="mb-6 relative">
                <Search
                  size={18}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  placeholder="공지사항 검색"
                  aria-label="공지사항 검색"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-12 w-full rounded-lg border border-[var(--color-border)] bg-white pl-11 pr-4 text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                />
              </div>

              {/* 출처 필터 + 분류 */}
              <div className="mb-5 flex flex-wrap items-center gap-2">
                {notices.notices.length > 0 && (
                  <NoticeFilter
                    ariaLabel="공지 출처"
                    appearance="chip"
                    value={sourceFilter}
                    options={OWNER_NOTICE_FILTERS}
                    onChange={setSourceFilter}
                  />
                )}
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  aria-label="공지 분류 필터"
                  className="ml-auto min-h-[36px] rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm font-medium text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat === "전체" ? "전체 분류" : cat}
                    </option>
                  ))}
                </select>
              </div>

              <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
                공지사항 <span className="font-bold text-[var(--color-text-primary)]">{filteredNotices.length}</span>개
              </p>

              {/* 공지 목록 */}
              {filteredNotices.length === 0 ? (
                <div className={stateBoxClass}>
                  {notices.notices.length === 0 ? (
                    <>
                      <Megaphone size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                      <p className="text-base font-semibold text-[var(--color-text-primary)]">
                        등록된 공지사항이 없습니다.
                      </p>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                        본사에서 새로운 공지를 등록하면 이곳에서 확인할 수 있습니다.
                      </p>
                    </>
                  ) : (
                    <>
                      <Search size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                      <p className="text-base font-semibold text-[var(--color-text-primary)]">
                        검색 결과가 없습니다.
                      </p>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                        필터 또는 검색 조건을 바꿔보세요.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {filteredNotices.map((notice) => (
                    <li key={notice.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => handleOpenModal(notice)}
                        className="flex h-full w-full flex-col items-start rounded-xl border border-[var(--color-border)] bg-white p-5 text-left transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                      >
                        <span className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="inline-flex rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
                            {notice.isMine ? "내 공지" : "본사"}
                          </span>
                          <NoticeReadStatus isRead={notice.isRead} />
                        </span>
                        <span className="w-full text-base font-semibold text-[var(--color-text-primary)] break-keep line-clamp-2">
                          {notice.title}
                        </span>
                        <span className="mt-1 w-full text-sm text-[var(--color-text-secondary)] break-words line-clamp-2">
                          {notice.content}
                        </span>
                        <span className="mt-auto pt-3 text-xs text-[var(--color-text-tertiary)]">
                          {notice.category} · {notice.createdAt.split("T")[0]} · 조회 {notice.viewCount}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
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
