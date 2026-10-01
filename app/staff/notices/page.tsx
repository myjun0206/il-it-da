"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Check, ChevronDown, Megaphone, RefreshCw, Search, Store as StoreIcon } from "lucide-react";

import { useStaffShell } from "@/components/staff/StaffShellContext";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";

// 직원 공지사항: 조회·검색·필터·상세 보기만 있다 (작성/수정/삭제 없음).
// 데이터는 /api/staff/notices가 approved staff membership을 검증한 "현재 근무 매장" 범위로만 내려준다.

interface StaffNotice {
  id: string;
  targetType: "all" | "store";
  title: string;
  content: string;
  authorName: string;
  createdAt: string;
}

type LoadResult =
  | { key: string; status: "ready"; notices: StaffNotice[] }
  | { key: string; status: "error"; message: string };

// 공지 필터: "all" (전체 소속 매장) 또는 특정 storeId
type NoticeFilterValue = "all" | string; // "all" or storeId
const TARGET_LABELS: Record<StaffNotice["targetType"], string> = { all: "전체 지점", store: "현재 매장" };

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function authorLabel(notice: StaffNotice): string {
  return notice.authorName ? `${notice.authorName} 본사` : "본사";
}

function TargetBadge({ targetType }: { targetType: StaffNotice["targetType"] }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        targetType === "store"
          ? "bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]"
          : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]"
      }`}
    >
      {TARGET_LABELS[targetType]}
    </span>
  );
}

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
  // 상세 보기: 특정 매장의 공지를 선택했을 때 그 매장 ID와 공지 ID를 기억한다.
  const [detail, setDetail] = useState<{ storeId: string; noticeId: string } | null>(null);

  // 필터 선택에 따라 조회할 매장 결정
  const storeIdsToFetch: string[] = noticeFilter === "all" ? stores.map((s) => s.id) : [noticeFilter];
  const requestKey = storeIdsToFetch.length > 0 ? `${storeIdsToFetch.join(",")}:${reloadToken}` : null;

  useEffect(() => {
    if (storeIdsToFetch.length === 0 || !requestKey) return;
    const controller = new AbortController();

    // 모든 매장의 공지를 병렬로 조회
    Promise.all(
      storeIdsToFetch.map((storeId) =>
        fetch(`/api/staff/notices?storeId=${encodeURIComponent(storeId)}`, {
          credentials: "include",
          signal: controller.signal,
        })
          .then(async (response) => {
            if (response.status === 401) {
              router.push("/");
              return { storeId, notices: [] };
            }
            const payload = (await response.json()) as { notices?: StaffNotice[] };
            if (!response.ok || !Array.isArray(payload.notices)) {
              return { storeId, notices: [] };
            }
            return { storeId, notices: payload.notices };
          })
          .catch(() => ({ storeId, notices: [] })),
      ),
    )
      .then((results) => {
        // 모든 결과를 합쳐서 createdAt 기준으로 정렬
        const allNotices = results.flatMap((r) => r.notices);
        allNotices.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setResult({ key: requestKey, status: "ready", notices: allNotices });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, status: "error", message: "공지사항을 불러오지 못했습니다." });
        }
      });

    return () => controller.abort();
  }, [storeIdsToFetch, requestKey, router]);

  const currentResult = result && result.key === requestKey ? result : null;
  const notices = currentResult?.status === "ready" ? currentResult.notices : [];
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const visibleNotices = notices.filter(
    (notice) =>
      !normalizedQuery ||
      notice.title.toLowerCase().includes(normalizedQuery) ||
      notice.content.toLowerCase().includes(normalizedQuery),
  );

  // 상세 보기 시 해당 공지 찾기
  const openNotice = detail ? notices.find((notice) => notice.id === detail.noticeId) ?? null : null;

  // ── 상세 보기 ──────────────────────────────────────
  if (openNotice) {
    return (
      <div className="p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="-ml-2 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            공지사항
          </button>

          <article className="rounded-xl border border-[var(--color-border)] bg-white p-6 lg:p-8">
            <TargetBadge targetType={openNotice.targetType} />
            <h1 className="mt-3 text-2xl font-bold text-[var(--color-text-primary)] break-keep">{openNotice.title}</h1>
            <p className="mt-2 border-b border-[var(--color-border)] pb-5 text-sm text-[var(--color-text-secondary)]">
              {authorLabel(openNotice)} · {formatDate(openNotice.createdAt)}
            </p>
            <p className="mt-5 whitespace-pre-wrap break-words text-base leading-7 text-[var(--color-text-primary)]">
              {openNotice.content}
            </p>
          </article>
        </div>
      </div>
    );
  }

  // ── 목록 보기 ──────────────────────────────────────
  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">공지사항</h1>
          <p className="text-base text-[var(--color-text-secondary)]">매장 운영에 필요한 새로운 소식과 안내를 확인하세요.</p>
        </div>

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
              <FilterDropdown value={noticeFilter} onChange={setNoticeFilter} stores={stores} />
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
                  <button
                    key={notice.id}
                    type="button"
                    onClick={() => {
                      setDetail({ storeId: noticeFilter === "all" ? stores[0]?.id ?? "" : noticeFilter, noticeId: notice.id });
                      document.querySelector("main")?.scrollTo({ top: 0 });
                    }}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-white p-4 sm:p-5 text-left transition-all hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-primary-light)]/5 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <TargetBadge targetType={notice.targetType} />
                      <p className="text-xs text-[var(--color-text-tertiary)] whitespace-nowrap">
                        {formatDate(notice.createdAt)}
                      </p>
                    </div>
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)] line-clamp-2 break-keep mb-2">
                      {notice.title}
                    </h3>
                    <p className="text-xs text-[var(--color-text-secondary)] line-clamp-1 break-words mb-3">
                      {notice.content}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {authorLabel(notice)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
