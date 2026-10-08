"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronDown, Megaphone, RefreshCw, Search, Store as StoreIcon, X } from "lucide-react";

import { useStaffShell } from "@/components/staff/StaffShellContext";
import { NoticeDetailDialog } from "@/components/notices/NoticeDetailDialog";
import { NoticeFilter, type NoticeFilterOption } from "@/components/notices/NoticeFilter";
import { NoticePagination } from "@/components/notices/NoticePagination";
import { getNoticeViewCountIncrement, markNoticeAsRead } from "@/lib/notices/mark-notice-read";
import { toStaffNotice, type NoticeSourceFilter, type NoticeTargetFilter } from "@/lib/notices/notice-filters";
import type { NoticeReadFilter } from "@/lib/notices/with-read-status";
import type { NoticeTargetType } from "@/lib/notices/notice-authorization";
import type { NoticeSortOrder } from "@/lib/notices/sort-notices";
import { DEFAULT_NOTICE_LIMIT, DEFAULT_NOTICE_PAGE, type NoticePaginationMetadata } from "@/lib/notices/pagination";

// 직원 공지사항: 기본 매장 범위의 공지만 조회·검색·필터·상세 보기 (작성/수정/삭제 없음).
// 기본 매장이 변경되면 자동으로 반영된다.
// 데이터는 /api/staff/notices가 approved staff membership을 검증한 범위로만 내려준다.

interface StaffNotice {
  id: string;
  isRead: boolean;
  viewCount: number;
  sourceType: "hq" | "owner";
  sourceLabel: string;
  targetType: NoticeTargetType;
  title: string;
  content: string;
  authorName: string;
  createdAt: string;
}

type StaffNoticeResponse = Omit<StaffNotice, "sourceType">;

const DEFAULT_LOAD_ERROR = "공지사항을 불러오지 못했습니다.";

const NOTICE_READ_FILTERS: readonly NoticeFilterOption<NoticeReadFilter>[] = [
  { value: "all", label: "전체" },
  { value: "unread", label: "안 읽음" },
];

type LoadResult =
  | { key: string; status: "ready"; notices: StaffNotice[]; pagination: NoticePaginationMetadata }
  | { key: string; status: "error"; message: string };

class UnauthorizedError extends Error {}
class NoticeLoadError extends Error {}

function StateBox({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`rounded-xl border p-8 text-center ${
        tone === "error" ? "border-[var(--color-status-error)] bg-[var(--color-status-error)]/10" : "border-[var(--color-border)] bg-[var(--color-bg-surface)]"
      }`}
    >
      {children}
    </div>
  );
}

export default function StaffNoticesPage() {
  const router = useRouter();
  const { selectedStore, stores, isStoresLoading, storesError, reloadStores } = useStaffShell();
  const storeId = selectedStore?.id ?? null;
  const [result, setResult] = useState<LoadResult | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<NoticeSortOrder>("latest");
  const [page, setPage] = useState(DEFAULT_NOTICE_PAGE);
  const [pageStoreId, setPageStoreId] = useState(storeId);
  const [sourceFilter, setSourceFilter] = useState<NoticeSourceFilter>("all");
  const [targetFilter, setTargetFilter] = useState<NoticeTargetFilter>("all");
  const [detail, setDetail] = useState<string | null>(null);
  const [readFilter, setReadFilter] = useState<NoticeReadFilter>("all");
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const unreadReadPending = useRef(false);
  const debounceTimeoutRef = useRef<number | null>(null);
  const noticeDetailOpen = useRef(false);

  const requestKey = storeId
    ? `${storeId}:${reloadToken}:${submittedQuery}:${sortOrder}:${sourceFilter}:${targetFilter}:${readFilter}:${page}`
    : null;

  useEffect(() => {
    if (pageStoreId === storeId) return;
    startTransition(() => {
      setPage(DEFAULT_NOTICE_PAGE);
      setPageStoreId(storeId);
    });
  }, [storeId, pageStoreId]);

  // 단일 기본 매장 기준 공지 조회
  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();

    const params = new URLSearchParams({ storeId: storeId! });
    if (submittedQuery) params.set("search", submittedQuery);
    params.set("sort", sortOrder);
    params.set("page", String(page));
    params.set("limit", String(DEFAULT_NOTICE_LIMIT));
    params.set("source", sourceFilter);
    params.set("target", targetFilter);
    params.set("read", readFilter);
    fetch(`/api/staff/notices?${params.toString()}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          router.push("/");
          return;
        }
        const payload = (await response.json()) as {
          notices?: StaffNoticeResponse[];
          pagination?: NoticePaginationMetadata;
          error?: string;
        };
        if (!response.ok || !Array.isArray(payload.notices) || !payload.pagination) {
          throw new NoticeLoadError(payload.error || DEFAULT_LOAD_ERROR);
        }
        const notices = payload.notices.map(toStaffNotice);
        setResult({ key: requestKey, status: "ready", notices, pagination: payload.pagination });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof UnauthorizedError) {
          router.push("/");
          return;
        }
        setResult({
          key: requestKey,
          status: "error",
          message: error instanceof NoticeLoadError ? error.message : DEFAULT_LOAD_ERROR,
        });
      });

    return () => controller.abort();
  }, [storeId, requestKey, router, submittedQuery, sortOrder, sourceFilter, targetFilter, readFilter, page]);

  const currentResult = result && result.key === requestKey ? result : null;
  const allNotices = currentResult?.status === "ready" ? currentResult.notices : [];
  const trimmedQuery = submittedQuery;
  // API에서 이미 모든 필터(source, target, read)를 적용했으므로, 클라이언트에서는 그대로 표시
  const visibleNotices = allNotices;

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedQuery(query.trim());
    setPage(DEFAULT_NOTICE_PAGE);
  };

  const handleSearchChange = (value: string) => {
    setQuery(value);
    // 실시간 검색: 0.3초 디바운싱
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = window.setTimeout(() => {
      setSubmittedQuery(value.trim());
      setPage(DEFAULT_NOTICE_PAGE);
    }, 300);
  };

  const clearSearch = () => {
    setQuery("");
    setSubmittedQuery("");
    setPage(DEFAULT_NOTICE_PAGE);
  };

  const getSortLabel = (value: NoticeSortOrder): string => {
    const options: Array<{ value: NoticeSortOrder; label: string }> = [
      { value: "latest", label: "최신순" },
      { value: "oldest", label: "오래된순" },
      { value: "views", label: "조회수순" },
    ];
    return options.find((opt) => opt.value === value)?.label || "최신순";
  };

  // 상세 보기 시 해당 공지 찾기
  const selectedNotice = detail ? allNotices.find((notice) => notice.id === detail) ?? null : null;

  const openNotice = (notice: StaffNotice) => {
    noticeDetailOpen.current = true;
    setDetail(notice.id);
    if (notice.isRead) return;

    void markNoticeAsRead(notice.id).then((result) => {
      if (!result.succeeded) return;
      const viewCountIncrement = getNoticeViewCountIncrement(result);
      setResult((current) =>
        current?.status === "ready"
          ? {
              ...current,
              notices: current.notices.map((currentNotice) =>
                currentNotice.id === notice.id
                  ? { ...currentNotice, isRead: true, viewCount: currentNotice.viewCount + viewCountIncrement }
                  : currentNotice,
              ),
            }
          : current,
      );
      if (readFilter === "unread") {
        unreadReadPending.current = true;
        if (!noticeDetailOpen.current) {
          unreadReadPending.current = false;
          setReloadToken((value) => value + 1);
        }
      }
    });
  };

  const closeNotice = () => {
    noticeDetailOpen.current = false;
    setDetail(null);
    if (unreadReadPending.current) {
      unreadReadPending.current = false;
      if (readFilter === "unread") setReloadToken((value) => value + 1);
    }
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* 페이지 헤더 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">공지사항</h1>
          <p className="text-base text-[var(--color-text-secondary)]">본사와 근무 매장에서 전달한 공지사항을 확인할 수 있습니다.</p>
        </div>

        {isStoresLoading ? (
          <StateBox>
            <p className="text-base text-[var(--color-text-secondary)]" role="status">
              근무 매장을 확인하는 중...
            </p>
          </StateBox>
        ) : storesError ? (
          <StateBox tone="error">
            <p className="text-sm text-[var(--color-status-error)]">{storesError}</p>
            <button
              type="button"
              onClick={reloadStores}
              className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-bg-surface)]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <RefreshCw size={16} aria-hidden="true" /> 다시 시도
            </button>
          </StateBox>
        ) : stores.length === 0 ? (
          <StateBox>
            <StoreIcon size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <p className="text-base font-semibold text-[var(--color-text-primary)]">승인된 근무 매장이 없습니다.</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">근무 매장이 승인되면 공지사항을 확인할 수 있습니다.</p>
            <Link
              href="/staff/stores"
              className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
            >
              근무 매장 관리
            </Link>
          </StateBox>
        ) : !currentResult ? (
          <StateBox>
            <p className="text-base text-[var(--color-text-secondary)]" role="status">
              공지사항을 불러오는 중...
            </p>
          </StateBox>
        ) : currentResult.status === "error" ? (
          <StateBox tone="error">
            <p className="flex items-center justify-center gap-1.5 text-sm text-[var(--color-status-error)]">
              <AlertCircle size={16} aria-hidden="true" /> {currentResult.message}
            </p>
            <button
              type="button"
              onClick={() => setReloadToken((value) => value + 1)}
              className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-bg-surface)]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <RefreshCw size={16} aria-hidden="true" /> 다시 시도
            </button>
          </StateBox>
        ) : allNotices.length === 0 && !submittedQuery && readFilter === "all" ? (
          <StateBox>
            <Megaphone size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <p className="text-base font-semibold text-[var(--color-text-primary)]">아직 등록된 공지사항이 없습니다.</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">본사에서 공지를 등록하면 이곳에서 확인할 수 있습니다.</p>
          </StateBox>
        ) : (
          <>
            {/* 검색 영역 - 검색창 + 커스텀 정렬 드롭다운 */}
            <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center">
              {/* 검색 입력 */}
              <div className="relative flex-1">
                <Search
                  size={18}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  placeholder="공지사항 검색"
                  aria-label="공지사항 검색"
                  className="min-h-[44px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] py-2.5 pl-11 pr-4 text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
                />
                {/* 삭제 버튼 - 검색어 있을 때만 표시 */}
                {query && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                    aria-label="검색어 초기화"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                )}
              </div>

              {/* 커스텀 정렬 드롭다운 */}
              <div data-sort-dropdown className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
                  aria-label="공지 정렬"
                  aria-expanded={isSortDropdownOpen}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-primary)]/30 focus:outline-none focus:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/30"
                >
                  <span>{getSortLabel(sortOrder)}</span>
                  <ChevronDown size={16} className={`flex-shrink-0 transition-transform ${isSortDropdownOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>

                {isSortDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-md z-50 min-w-[120px] overflow-hidden">
                    {[
                      { value: "latest" as const, label: "최신순" },
                      { value: "oldest" as const, label: "오래된순" },
                      { value: "views" as const, label: "조회수순" },
                    ].map((option, index) => (
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
                            ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                            : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-default)]"
                        } border-b border-[var(--color-border)]/50`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 필터 행 - 한 줄 통합 */}
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              {/* 왼쪽: 필터 버튼들 */}
              <div className="flex flex-wrap items-center gap-2">
                {/* 공지 유형 필터 */}
                {(
                  [
                    { value: "all", label: "전체 공지" },
                    { value: "hq", label: "본사 공지" },
                    { value: "owner", label: "매장 공지" },
                  ] as const
                ).map(({ value, label }) => {
                  const isActive = sourceFilter === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => {
                        setSourceFilter(value);
                        setPage(DEFAULT_NOTICE_PAGE);
                      }}
                      className={`min-h-[36px] rounded-full border px-4 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                        isActive
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                          : "border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-text-primary)]"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}

                {/* 구분선 */}
                <div className="h-6 w-px bg-[var(--color-border)]" aria-hidden="true" />

                {/* 안 읽음 토글 버튼 */}
                <button
                  type="button"
                  aria-pressed={readFilter === "unread"}
                  onClick={() => {
                    setReadFilter(readFilter === "unread" ? "all" : "unread");
                    setPage(DEFAULT_NOTICE_PAGE);
                  }}
                  className={`min-h-[36px] rounded-full border px-4 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                    readFilter === "unread"
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                      : "border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-text-primary)]"
                  }`}
                >
                  안 읽음
                </button>
              </div>

              {/* 오른쪽: 공지 개수 */}
              <p className="text-sm text-[var(--color-text-secondary)] whitespace-nowrap">
                공지사항 <span className="font-bold text-[var(--color-text-primary)]">{currentResult?.status === "ready" ? currentResult.pagination.totalCount : visibleNotices.length}</span>개
              </p>
            </div>

            {visibleNotices.length === 0 ? (
              <StateBox>
                <Search size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {trimmedQuery ? `'${trimmedQuery}'에 대한 공지사항을 찾을 수 없습니다.` : "선택한 조건에 해당하는 공지사항이 없습니다."}
                </p>
              </StateBox>
            ) : (
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {visibleNotices.map((notice) => (
                  <li key={notice.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => openNotice(notice)}
                      className="flex h-full w-full flex-col items-start rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5 text-left shadow-sm transition-colors hover:border-[var(--color-primary)]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:p-6"
                    >
                      <div className="mb-3 flex gap-2 items-center">
                        <span className="inline-flex rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
                          {notice.sourceType === "hq" ? "본사" : "매장"}
                        </span>
                        {!notice.isRead && (
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                            안읽음
                          </span>
                        )}
                      </div>
                      <h3 className="w-full text-base font-semibold text-[var(--color-text-primary)] break-keep line-clamp-2">
                        {notice.title}
                      </h3>
                      <div className="mt-auto pt-3 text-xs text-[var(--color-text-tertiary)]">
                        {notice.createdAt.split("T")[0]} · 조회 {notice.viewCount}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {currentResult?.status === "ready" && (
              <NoticePagination page={page} totalPages={currentResult.pagination.totalPages} onPageChange={setPage} />
            )}
          </>
        )}
      </div>
      {selectedNotice && (
        <NoticeDetailDialog
          notice={{ ...selectedNotice, sourceLabel: selectedNotice.sourceLabel }}
          onClose={closeNotice}
        />
      )}
    </div>
  );
}
