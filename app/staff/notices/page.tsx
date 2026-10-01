"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, ChevronDown, Megaphone, RefreshCw, Search, Store as StoreIcon } from "lucide-react";

import { useStaffShell } from "@/components/staff/StaffShellContext";
import { NoticeCard } from "@/components/notices/NoticeCard";
import { NoticeDetailDialog } from "@/components/notices/NoticeDetailDialog";
import { NoticeFilter, type NoticeFilterOption } from "@/components/notices/NoticeFilter";
import { NoticePageHeader } from "@/components/notices/NoticePageHeader";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";
import { getNoticeViewCountIncrement, markNoticeAsRead } from "@/lib/notices/mark-notice-read";

// 직원 공지사항: 조회·검색·필터·상세 보기만 있다 (작성/수정/삭제 없음).
// 데이터는 /api/staff/notices가 approved staff membership을 검증한 "현재 근무 매장" 범위로만 내려준다.

interface StaffNotice {
  id: string;
  isRead: boolean;
  viewCount: number;
  sourceType: "hq" | "owner";
  targetType: "all" | "franchise" | "store";
  sourceLabel: string;
  targetStoreName: string | null;
  title: string;
  content: string;
  authorName: string;
  createdAt: string;
}

type StaffNoticeResponse = Omit<StaffNotice, "sourceType">;
type StaffSourceFilter = "all" | "hq" | "owner";

const ALL_TARGETS = "all";
const FRANCHISE_TARGETS = "franchise";
const DEFAULT_LOAD_ERROR = "공지사항을 불러오지 못했습니다.";
const STAFF_SOURCE_FILTERS: readonly NoticeFilterOption<StaffSourceFilter>[] = [
  { value: "all", label: "전체" },
  { value: "hq", label: "본사 공지" },
  { value: "owner", label: "점주 공지" },
];

function toStaffNotice(notice: StaffNoticeResponse): StaffNotice {
  return {
    ...notice,
    sourceType: notice.sourceLabel === "점주 공지" ? "owner" : "hq",
  };
}

function formatNoticeSource(notice: StaffNotice): string {
  return `${notice.sourceLabel} · ${notice.targetStoreName ?? "대상 지점"}`;
}

function isSameStoreName(targetStoreName: string | null, storeName: string): boolean {
  return targetStoreName !== null && formatStoreDisplayName(targetStoreName) === formatStoreDisplayName(storeName);
}

type LoadResult =
  | { key: string; status: "ready"; notices: StaffNotice[]; storeIdsByNoticeId: Record<string, string[]> }
  | { key: string; status: "error"; message: string };

// 공지 필터: "all" (전체 소속 매장) 또는 특정 storeId
type NoticeFilterValue = "all" | string; // "all" or storeId

class UnauthorizedError extends Error {}
class NoticeLoadError extends Error {}

function StateBox({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`rounded-lg border p-8 text-center ${
        tone === "error" ? "border-red-200 bg-red-50" : "border-[var(--color-border)] bg-white"
      }`}
    >
      {children}
    </div>
  );
}

type FilterDropdownProps = {
  value: NoticeFilterValue;
  onChange: (value: NoticeFilterValue) => void;
  stores: Array<{ id: string; name: string }>;
};

function FilterDropdown({ value, onChange, stores }: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 현재 선택된 라벨 구성
  let currentLabel = "전체";
  if (value !== "all") {
    const selectedStore = stores.find((s) => s.id === value);
    if (selectedStore) {
      currentLabel = formatStoreDisplayName(selectedStore.name);
    }
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className="relative shrink-0 sm:w-48">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="근무 매장 필터"
        className="flex h-12 w-full items-center justify-between rounded-lg border border-[var(--color-border)] bg-white px-4 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-primary)]/50 focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown
          size={16}
          className={`ml-2 shrink-0 transition-transform text-[var(--color-text-tertiary)] ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-md">
          <div className="max-h-64 overflow-y-auto">
            {/* "전체" 옵션 */}
            <button
              type="button"
              onClick={() => {
                onChange("all");
                setIsOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors ${
                value === "all"
                  ? "bg-[var(--color-primary-light)]/20 font-medium text-[var(--color-primary)]"
                  : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]"
              }`}
            >
              {value === "all" && <Check size={14} className="text-[var(--color-primary)]" aria-hidden="true" />}
              <span>전체</span>
            </button>

            {/* 소속 매장 옵션들 */}
            {stores.map((store) => (
              <button
                key={store.id}
                type="button"
                onClick={() => {
                  onChange(store.id);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors ${
                  value === store.id
                    ? "bg-[var(--color-primary-light)]/20 font-medium text-[var(--color-primary)]"
                    : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]"
                }`}
              >
                {value === store.id && <Check size={14} className="text-[var(--color-primary)]" aria-hidden="true" />}
                <span className="truncate">{formatStoreDisplayName(store.name)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StaffNoticesPage() {
  const router = useRouter();
  const { selectedStore, stores, isStoresLoading, storesError, reloadStores } = useStaffShell();
  const [result, setResult] = useState<LoadResult | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState("");
  const [noticeFilter, setNoticeFilter] = useState<NoticeFilterValue>("all");
  const [sourceFilter, setSourceFilter] = useState<StaffSourceFilter>("all");
  const [targetFilter, setTargetFilter] = useState<string>(ALL_TARGETS);
  // 상세 보기: 특정 매장의 공지를 선택했을 때 그 매장 ID와 공지 ID를 기억한다.
  const [detail, setDetail] = useState<{ storeId: string; noticeId: string } | null>(null);

  // 승인 매장 목록에서 빠진 매장이 선택돼 있으면 전체로 되돌린다.
  const activeStoreFilter: NoticeFilterValue =
    noticeFilter !== "all" && stores.some((store) => store.id === noticeFilter) ? noticeFilter : "all";
  // 매 렌더마다 새 배열이 생기면 effect가 무한 재실행되므로 memo로 고정한다.
  const storeIdsToFetch = useMemo(
    () => (activeStoreFilter === "all" ? stores.map((store) => store.id) : [activeStoreFilter]),
    [activeStoreFilter, stores],
  );
  const requestKey = storeIdsToFetch.length > 0 ? `${storeIdsToFetch.join(",")}:${reloadToken}` : null;

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();

    // 선택된 매장(전체면 승인된 모든 매장)의 공지를 병렬로 조회
    Promise.all(
      storeIdsToFetch.map(async (storeId) => {
        const response = await fetch(`/api/staff/notices?storeId=${encodeURIComponent(storeId)}`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (response.status === 401) throw new UnauthorizedError();
        const payload = (await response.json()) as { notices?: StaffNoticeResponse[]; error?: string };
        if (!response.ok || !Array.isArray(payload.notices)) {
          throw new NoticeLoadError(payload.error || DEFAULT_LOAD_ERROR);
        }
        return { storeId, notices: payload.notices };
      }),
    )
      .then((results) => {
        // 전체 지점 공지는 여러 매장 응답에 중복으로 포함되므로 id 기준으로 합친다.
        const noticesById = new Map<string, StaffNotice>();
        const storeIdsByNoticeId: Record<string, string[]> = {};
        for (const { storeId, notices } of results) {
          for (const notice of notices) {
            if (!noticesById.has(notice.id)) noticesById.set(notice.id, toStaffNotice(notice));
            if (!storeIdsByNoticeId[notice.id]) storeIdsByNoticeId[notice.id] = [];
            storeIdsByNoticeId[notice.id].push(storeId);
          }
        }
        const mergedNotices = [...noticesById.values()].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setResult({ key: requestKey, status: "ready", notices: mergedNotices, storeIdsByNoticeId });
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
  }, [storeIdsToFetch, requestKey, router]);

  const currentResult = result && result.key === requestKey ? result : null;
  const notices = currentResult?.status === "ready" ? currentResult.notices : [];
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();

  // 대상 필터의 개별 매장 옵션은 현재 조회 범위의 매장으로 제한한다.
  const scopeStores = activeStoreFilter === "all" ? stores : stores.filter((store) => store.id === activeStoreFilter);
  const activeTargetFilter =
    targetFilter === ALL_TARGETS || targetFilter === FRANCHISE_TARGETS || scopeStores.some((store) => store.id === targetFilter)
      ? targetFilter
      : ALL_TARGETS;
  const targetFilterOptions: readonly NoticeFilterOption<string>[] = [
    { value: ALL_TARGETS, label: "전체 대상" },
    { value: FRANCHISE_TARGETS, label: "전체 지점" },
    ...scopeStores.map((store) => ({
      value: store.id,
      label: formatStoreDisplayName(store.name),
    })),
  ];

  // 출처·대상·검색 필터를 함께 적용한 공지 목록
  const visibleNotices = notices.filter((notice) => {
    if (sourceFilter !== "all" && notice.sourceType !== sourceFilter) return false;

    // 대상 범위와 개별 매장 필터는 출처 필터와 독립적으로 적용한다.
    if (activeTargetFilter === FRANCHISE_TARGETS) {
      if (notice.targetType !== "all" && notice.targetType !== "franchise") return false;
    } else if (activeTargetFilter !== ALL_TARGETS) {
      const targetStore = stores.find((store) => store.id === activeTargetFilter);
      if (!targetStore) return false;
      if (!isSameStoreName(notice.targetStoreName, targetStore.name)) return false;
    }

    if (
      normalizedQuery &&
      !notice.title.toLowerCase().includes(normalizedQuery) &&
      !notice.content.toLowerCase().includes(normalizedQuery)
    ) {
      return false;
    }

    return true;
  });

  // 상세 보기 시 해당 공지 찾기 (읽음/조회수 갱신이 그대로 반영된다)
  const selectedNotice = detail ? notices.find((notice) => notice.id === detail.noticeId) ?? null : null;

  const openNotice = (notice: StaffNotice) => {
    const noticeStoreIds = currentResult?.status === "ready" ? currentResult.storeIdsByNoticeId[notice.id] ?? [] : [];
    const detailStoreId =
      activeStoreFilter !== "all"
        ? activeStoreFilter
        : selectedStore && noticeStoreIds.includes(selectedStore.id)
          ? selectedStore.id
          : noticeStoreIds[0] ?? selectedStore?.id ?? "";
    setDetail({ storeId: detailStoreId, noticeId: notice.id });
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
    });
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <NoticePageHeader
          title="공지사항"
          description="본사와 근무 매장에서 전달한 공지사항을 확인할 수 있습니다."
        />

        {isStoresLoading ? (
          <StateBox>
            <p className="text-base text-[var(--color-text-secondary)]" role="status">근무 매장을 확인하는 중...</p>
          </StateBox>
        ) : storesError ? (
          <StateBox tone="error">
            <p className="text-sm text-red-700">{storesError}</p>
            <button
              type="button"
              onClick={reloadStores}
              className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
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
            <p className="text-base text-[var(--color-text-secondary)]" role="status">공지사항을 불러오는 중...</p>
          </StateBox>
        ) : currentResult.status === "error" ? (
          <StateBox tone="error">
            <p className="flex items-center justify-center gap-1.5 text-sm text-red-700">
              <AlertCircle size={16} aria-hidden="true" /> {currentResult.message}
            </p>
            <button
              type="button"
              onClick={() => setReloadToken((value) => value + 1)}
              className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <RefreshCw size={16} aria-hidden="true" /> 다시 시도
            </button>
          </StateBox>
        ) : notices.length === 0 ? (
          <StateBox>
            <Megaphone size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <p className="text-base font-semibold text-[var(--color-text-primary)]">아직 등록된 공지사항이 없습니다.</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">본사에서 공지를 등록하면 이곳에서 확인할 수 있습니다.</p>
          </StateBox>
        ) : (
          <>
            {/* 검색 + 매장 필터 */}
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search
                  size={18}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="공지사항 검색"
                  aria-label="공지사항 검색"
                  className="h-12 w-full rounded-lg border border-[var(--color-border)] bg-white pl-11 pr-4 text-sm font-normal text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 transition-colors"
                />
              </div>
              <FilterDropdown value={activeStoreFilter} onChange={setNoticeFilter} stores={stores} />
            </div>

            {/* 출처 + 대상 필터 */}
            <div className="mb-6 space-y-3">
              <NoticeFilter
                ariaLabel="공지 출처"
                value={sourceFilter}
                options={STAFF_SOURCE_FILTERS}
                onChange={setSourceFilter}
              />
              <NoticeFilter
                ariaLabel="공지 대상"
                value={activeTargetFilter}
                options={targetFilterOptions}
                onChange={setTargetFilter}
              />
            </div>

            {/* 공지 목록 헤더 */}
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-medium text-[var(--color-text-secondary)]">
                공지사항
                <span className="ml-1 font-bold text-[var(--color-text-primary)]">{visibleNotices.length}</span>
              </p>
            </div>

            {visibleNotices.length === 0 ? (
              <StateBox>
                <Search size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {trimmedQuery
                    ? `'${trimmedQuery}'에 대한 공지사항을 찾을 수 없습니다.`
                    : "선택한 조건에 해당하는 공지사항이 없습니다."}
                </p>
              </StateBox>
            ) : (
              <div className="space-y-3">
                {visibleNotices.map((notice) => (
                  <NoticeCard
                    key={notice.id}
                    title={notice.title}
                    content={notice.content}
                    sourceLabel={formatNoticeSource(notice)}
                    createdAt={notice.createdAt}
                    viewCount={notice.viewCount}
                    isRead={notice.isRead}
                    onOpen={() => openNotice(notice)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {selectedNotice && (
        <NoticeDetailDialog
          notice={{ ...selectedNotice, sourceLabel: formatNoticeSource(selectedNotice) }}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
