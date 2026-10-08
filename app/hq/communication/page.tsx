"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Megaphone, Pencil, Plus, Search, Store, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { NoticeCard } from "@/components/notices/NoticeCard";
import { NoticeDetailDialog } from "@/components/notices/NoticeDetailDialog";
import { NoticeEditDialog } from "@/components/notices/NoticeEditDialog";
import { NoticePageHeader } from "@/components/notices/NoticePageHeader";
import { NoticePagination } from "@/components/notices/NoticePagination";
import { createClient } from "@/lib/supabase/client";
import { useClientReady } from "@/lib/hq/use-client-ready";
import type { HqNoticeItem } from "@/lib/types/notice";
import type { NoticeSortOrder } from "@/lib/notices/sort-notices";
import { DEFAULT_NOTICE_LIMIT, DEFAULT_NOTICE_PAGE, type NoticePaginationMetadata } from "@/lib/notices/pagination";

// 목록 표시용 형태. /api/hq/notices 응답에서 대상 라벨을 계산해 만든다.
interface HqNotice {
  id: string;
  targetType: HqNoticeItem["targetType"];
  targetStoreId: string | null;
  target: string;
  sourceLabel: string;
  title: string;
  content: string;
  createdAt: string;
  viewCount: number;
  isMine: boolean;
}

type HqNoticeFilter = "all" | "franchise" | "store";
interface HqTargetStore { id: string; name: string }
interface HqNoticeFilterOption { value: HqNoticeFilter; label: string }

const HQ_NOTICE_FILTERS: readonly HqNoticeFilterOption[] = [
  { value: "all", label: "전체" },
  { value: "franchise", label: "전체 지점" },
  { value: "store", label: "특정 지점" },
];

const NEW_NOTICE_HREF = "/hq/communication/new";
const ALL_TARGETS = "__all__";
const NOTICES_PER_PAGE = 9;

const SORT_OPTIONS: Array<{ value: NoticeSortOrder; label: string }> = [
  { value: "latest", label: "최신순" },
  { value: "oldest", label: "오래된순" },
  { value: "views", label: "조회수순" },
];

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
  const target = notice.targetType === "all" || notice.targetType === "franchise"
    ? "전체 지점"
    : notice.targetStoreName ?? "삭제된 지점";
  return {
    id: notice.id,
    targetType: notice.targetType,
    targetStoreId: notice.targetStoreId,
    target,
    sourceLabel: `본사 공지 · ${target} · ${notice.audience === "owner" ? "점주" : "점주+직원"}`,
    title: notice.title,
    content: notice.content,
    createdAt: notice.createdAt,
    viewCount: notice.viewCount,
    isMine: notice.isMine,
  };
}

export default function CommunicationPage() {
  const router = useRouter();
  const isReady = useClientReady();
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("프랜차이즈");
  const [notices, setNotices] = useState<HqNotice[]>([]);
  const [targetStores, setTargetStores] = useState<HqTargetStore[]>([]);
  const [pagination, setPagination] = useState<NoticePaginationMetadata>({
    page: DEFAULT_NOTICE_PAGE,
    limit: DEFAULT_NOTICE_LIMIT,
    totalCount: 0,
    totalPages: 0,
  });
  const [page, setPage] = useState(DEFAULT_NOTICE_PAGE);
  const [isLoadingNotices, setIsLoadingNotices] = useState(true);
  const [noticesError, setNoticesError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<NoticeSortOrder>("latest");
  const [scopeFilter, setScopeFilter] = useState<HqNoticeFilter>("all");
  const [targetFilter, setTargetFilter] = useState<string>(ALL_TARGETS);
  const [selectedStoreTarget, setSelectedStoreTarget] = useState<string | null>(null);
  const [storeSearchQuery, setStoreSearchQuery] = useState("");
  const [editingNotice, setEditingNotice] = useState<HqNotice | null>(null);
  const [deletingNotice, setDeletingNotice] = useState<HqNotice | null>(null);
  const [selectedNotice, setSelectedNotice] = useState<HqNotice | null>(null);
  const [isDeletingNotice, setIsDeletingNotice] = useState(false);
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);

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

        const savedFranchiseName = sessionStorage.getItem("loggedInFranchiseName");

        if (savedFranchiseName) {
          setFranchiseName(savedFranchiseName);
        } else if (name && name.includes(" ")) {
          const parts = name.split(" ");
          if (parts[0]) {
            setFranchiseName(parts[0]);
          }
        }
      } catch (error) {
        console.error("Set user info failed:", error);
        router.push("/");
      }
    };

    setUserInfo();
  }, [router]);

  useEffect(() => {
    if (!isSortDropdownOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-sort-dropdown]')) {
        setIsSortDropdownOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isSortDropdownOpen]);

  useEffect(() => {
    if (!isReady) return;

    const loadNotices = async () => {
      setIsLoadingNotices(true);
      setNoticesError("");
      try {
        const params = new URLSearchParams();
        if (submittedSearch) params.set("search", submittedSearch);
        params.set("sort", sortOrder);
        params.set("page", String(page));
        params.set("limit", String(DEFAULT_NOTICE_LIMIT));
        if (scopeFilter !== "all") params.set("scope", scopeFilter);
        if (targetFilter !== ALL_TARGETS) params.set("targetStoreId", targetFilter);
        const query = params.toString();
        const response = await fetch(`/api/hq/notices${query ? `?${query}` : ""}`);
        const result = (await response.json()) as {
          notices?: HqNoticeItem[];
          targetStores?: HqTargetStore[];
          pagination?: NoticePaginationMetadata;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error || "공지사항을 불러오지 못했습니다.");
        }
        setNotices((result.notices ?? []).map(toNoticeRow));
        setTargetStores(result.targetStores ?? []);
        setPagination(result.pagination ?? { page, limit: DEFAULT_NOTICE_LIMIT, totalCount: 0, totalPages: 0 });
      } catch (error) {
        console.error("Failed to load notices:", error);
        setNoticesError(error instanceof Error ? error.message : "공지사항을 불러오지 못했습니다.");
      } finally {
        setIsLoadingNotices(false);
      }
    };

    void loadNotices();
  }, [isReady, submittedSearch, sortOrder, page, scopeFilter, targetFilter]);

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

  const updateNotice = async (title: string, content: string) => {
    if (!editingNotice) return;
    const response = await fetch("/api/hq/notices", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingNotice.id, title, content }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error || "공지를 수정하지 못했습니다.");

    setNotices((current) => current.map((notice) =>
      notice.id === editingNotice.id ? { ...notice, title, content } : notice,
    ));
    setEditingNotice(null);
  };

  const deleteNotice = async () => {
    if (!deletingNotice || isDeletingNotice) return;
    setIsDeletingNotice(true);
    try {
      const response = await fetch("/api/hq/notices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deletingNotice.id }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "공지를 삭제하지 못했습니다.");
      setNotices((current) => current.filter((notice) => notice.id !== deletingNotice.id));
      setDeletingNotice(null);
    } catch (error) {
      setNoticesError(error instanceof Error ? error.message : "공지를 삭제하지 못했습니다.");
      setDeletingNotice(null);
    } finally {
      setIsDeletingNotice(false);
    }
  };

  // 클라이언트 측 지점 검색 필터 (HEAD의 지점명 검색)
  const storeTargets = useMemo(() => {
    const scopedNotices = notices.filter((notice) => notice.targetType === "store");
    return [...new Set(scopedNotices.map((notice) => notice.target))].sort((a, b) => a.localeCompare(b));
  }, [notices]);

  const filteredStoreTargets = useMemo(() => {
    const query = storeSearchQuery.trim().toLowerCase();
    return query ? storeTargets.filter((target) => target.toLowerCase().includes(query)) : storeTargets;
  }, [storeTargets, storeSearchQuery]);

  // 서버에서 받은 notices 사용 (이미 필터링됨)
  const filteredNotices = notices;

  // 클라이언트 사이드 페이지네이션
  const totalPages = useMemo(() => {
    return Math.ceil(filteredNotices.length / NOTICES_PER_PAGE);
  }, [filteredNotices.length]);

  const paginatedNotices = useMemo(() => {
    const startIndex = (page - 1) * NOTICES_PER_PAGE;
    const endIndex = startIndex + NOTICES_PER_PAGE;
    return filteredNotices.slice(startIndex, endIndex);
  }, [filteredNotices, page]);

  const targetOptions = useMemo(() => scopeFilter === "franchise" ? [] : targetStores, [scopeFilter, targetStores]);

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedSearch(searchQuery.trim());
    setPage(DEFAULT_NOTICE_PAGE);
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSubmittedSearch("");
    setPage(DEFAULT_NOTICE_PAGE);
  };

  const changeScopeFilter = (value: HqNoticeFilter) => {
    setScopeFilter(value);
    setTargetFilter(ALL_TARGETS);
    setSelectedStoreTarget(null);
    setStoreSearchQuery("");
    setPage(DEFAULT_NOTICE_PAGE);
  };

  const getSortLabel = (value: NoticeSortOrder) => {
    return SORT_OPTIONS.find((opt) => opt.value === value)?.label || "최신순";
  };

  if (!isReady) {
    return null;
  }

  return (
    <>
      <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          <NoticePageHeader
            title="공지사항"
            description="전체 또는 특정 지점에 전달할 공지를 작성하고 관리합니다."
            action={<CreateNoticeButton label="새 공지 작성" />}
          />

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
            ) : notices.length === 0 && !submittedSearch ? (
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
                {/* 검색창과 정렬 드롭다운 */}
                <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center">
                  <div className="relative flex-1">
                    <Search
                      size={18}
                      aria-hidden="true"
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                    />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(event) => {
                        setSearchQuery(event.target.value);
                        setSubmittedSearch(event.target.value.trim());
                        setPage(DEFAULT_NOTICE_PAGE);
                      }}
                      placeholder="공지사항 검색"
                      aria-label="공지사항 검색"
                      className="min-h-[44px] w-full rounded-lg border border-[var(--color-border)] bg-white py-2.5 pl-11 pr-4 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
                    />
                  </div>
                  {/* 커스텀 정렬 드롭다운 */}
                  <div data-sort-dropdown className="relative flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
                      aria-label="공지 정렬"
                      aria-expanded={isSortDropdownOpen}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-primary)]/30 focus:outline-none focus:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/30"
                    >
                      <span>{getSortLabel(sortOrder)}</span>
                      <ChevronDown size={16} className={`flex-shrink-0 transition-transform ${isSortDropdownOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>

                    {isSortDropdownOpen && (
                      <div className="absolute right-0 top-full mt-1 rounded-lg border border-[var(--color-border)] bg-white shadow-md z-50 min-w-[120px] overflow-hidden">
                        {SORT_OPTIONS.map((option, index) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setSortOrder(option.value);
                              setPage(DEFAULT_NOTICE_PAGE);
                              setIsSortDropdownOpen(false);
                            }}
                            className={`block w-full text-left px-4 py-2.5 text-sm font-medium transition-colors ${
                              sortOrder === option.value
                                ? "bg-[var(--color-primary-light)]/20 text-[var(--color-primary)]"
                                : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-default)]"
                            } ${index !== SORT_OPTIONS.length - 1 ? 'border-b border-[var(--color-border)]/50' : ''}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 공지 대상 필터 - 칩 형태 */}
                <div className="mb-5 flex flex-wrap gap-2">
                  {HQ_NOTICE_FILTERS.map((filter) => {
                    const isActive = scopeFilter === filter.value;
                    return (
                      <button
                        key={filter.value}
                        type="button"
                        onClick={() => changeScopeFilter(filter.value)}
                        aria-pressed={isActive}
                        className={`min-h-[36px] rounded-full px-4 text-sm font-medium transition-all ${
                          isActive
                            ? "border border-[var(--color-primary)] bg-[var(--color-primary-light)]/20 text-[var(--color-primary)]"
                            : "border border-[var(--color-border)] bg-white text-[var(--color-text-primary)] hover:border-[var(--color-primary)]/50"
                        }`}
                      >
                        {filter.label}
                      </button>
                    );
                  })}
                </div>

                {/* 특정 지점 선택 UI (클라이언트 필터) - scopeFilter === "store"일 때만 표시 */}
                {scopeFilter === "store" && (
                  <div className="mb-6">
                    {selectedStoreTarget ? (
                      /* 선택 후: 선택된 지점 표시 */
                      <div className="flex min-h-[44px] items-center justify-between rounded-lg border border-[var(--color-border)] bg-white px-4 py-2">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <Store size={18} className="text-[var(--color-primary)] flex-shrink-0" aria-hidden="true" />
                          <span
                            className="text-base font-medium text-[var(--color-text-primary)] truncate"
                            title={selectedStoreTarget}
                          >
                            {selectedStoreTarget}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedStoreTarget(null);
                            setStoreSearchQuery("");
                          }}
                          className="ml-3 flex-shrink-0 min-h-[36px] rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                        >
                          변경
                        </button>
                      </div>
                    ) : (
                      /* 선택 전: 지점 검색 UI */
                      <div>
                        <label className="mb-3 block text-sm font-medium text-[var(--color-text-primary)]">
                          지점 선택
                        </label>
                        <div className="rounded-lg border border-[var(--color-border)] bg-white">
                          {/* 지점 검색 입력창 */}
                          <div className="border-b border-[var(--color-border)] p-4 pb-3">
                            <div className="relative">
                              <Search
                                size={18}
                                aria-hidden="true"
                                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                              />
                              <input
                                type="search"
                                value={storeSearchQuery}
                                onChange={(event) => setStoreSearchQuery(event.target.value)}
                                placeholder="지점명 검색..."
                                aria-label="지점명 검색"
                                className="min-h-[44px] w-full rounded-lg border border-[var(--color-border)] bg-white pl-11 pr-4 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                              />
                            </div>
                          </div>

                          {/* 지점 목록 - 검색어가 있을 때만 표시 */}
                          {storeSearchQuery && filteredStoreTargets.length > 0 ? (
                            <div className="max-h-[240px] overflow-y-auto">
                              {filteredStoreTargets.map((target) => (
                                <label
                                  key={target}
                                  className="flex min-h-[44px] items-center gap-3 border-b border-[var(--color-border)] px-4 py-2 hover:bg-[var(--color-bg-default)] cursor-pointer transition-colors last:border-b-0"
                                >
                                  <input
                                    type="radio"
                                    name="store-target"
                                    value={target}
                                    checked={false}
                                    onChange={() => setSelectedStoreTarget(target)}
                                    className="w-4 h-4 text-[var(--color-primary)] cursor-pointer flex-shrink-0"
                                  />
                                  <span
                                    className="text-base font-medium text-[var(--color-text-primary)] truncate"
                                    title={target}
                                  >
                                    {target}
                                  </span>
                                </label>
                              ))}
                            </div>
                          ) : storeSearchQuery && filteredStoreTargets.length === 0 ? (
                            <div className="px-4 py-8 text-center">
                              <p className="text-base text-[var(--color-text-secondary)]">검색 결과가 없습니다.</p>
                            </div>
                          ) : (
                            <div className="px-4 py-8 text-center">
                              <p className="text-base text-[var(--color-text-secondary)]">지점명을 입력해 검색하세요.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {filteredNotices.length === 0 ? (
                  <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                    <Search size={28} className="mx-auto mb-3 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                    <p className="text-base text-[var(--color-text-secondary)]">{submittedSearch ? "검색 결과가 없습니다." : "선택한 조건에 맞는 공지사항이 없습니다."}</p>
                  </div>
                ) : (
                  <>
                    <p className="mb-4 text-sm font-medium text-[var(--color-text-secondary)]">
                      공지사항 <span className="text-[var(--color-primary)]">{filteredNotices.length}</span>개
                    </p>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {paginatedNotices.map((notice) => (
                        <NoticeCard
                          key={notice.id}
                          title={notice.title}
                          content={notice.content}
                          sourceLabel={notice.targetType === "all" || notice.targetType === "franchise" ? "전체 지점" : "특정 지점"}
                          createdAt={notice.createdAt}
                          viewCount={notice.viewCount}
                          isRead={null}
                          onOpen={() => setSelectedNotice(notice)}
                          showContent={false}
                          showSourceLabel={true}
                        />
                      ))}
                    </div>
                  </>
                )}
                <NoticePagination page={page} totalPages={totalPages} onPageChange={setPage} />
              </>
            )}
          </section>
    </main>
      {selectedNotice && (
        <NoticeDetailDialog
          notice={{ ...selectedNotice, isRead: null }}
          onClose={() => setSelectedNotice(null)}
          actions={selectedNotice.isMine ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditingNotice(selectedNotice);
                  setSelectedNotice(null);
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                <Pencil size={16} aria-hidden="true" /> 수정
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeletingNotice(selectedNotice);
                  setSelectedNotice(null);
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
    </>
  );
}
