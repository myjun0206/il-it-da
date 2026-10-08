"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Megaphone, RefreshCw, Search, Store as StoreIcon } from "lucide-react";

import { useStaffShell } from "@/components/staff/StaffShellContext";
import { NoticeDetailDialog } from "@/components/notices/NoticeDetailDialog";
import { getNoticeViewCountIncrement, markNoticeAsRead } from "@/lib/notices/mark-notice-read";
import { filterStaffNotices, toStaffNotice, type NoticeSourceFilter } from "@/lib/notices/notice-filters";
import type { NoticeTargetType } from "@/lib/notices/notice-authorization";

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

type LoadResult =
  | { key: string; status: "ready"; notices: StaffNotice[] }
  | { key: string; status: "error"; message: string };

class UnauthorizedError extends Error {}
class NoticeLoadError extends Error {}

function StateBox({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`rounded-xl border p-8 text-center ${
        tone === "error" ? "border-red-200 bg-red-50" : "border-[var(--color-border)] bg-white"
      }`}
    >
      {children}
    </div>
  );
}

export default function StaffNoticesPage() {
  const router = useRouter();
  const { selectedStore, stores, isStoresLoading, storesError, reloadStores } = useStaffShell();
  const [result, setResult] = useState<LoadResult | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<NoticeSourceFilter>("all");
  // 상세 보기: 선택한 공지 ID를 기억한다.
  const [detail, setDetail] = useState<string | null>(null);

  const storeId = selectedStore?.id ?? null;
  const requestKey = storeId ? `${storeId}:${reloadToken}` : null;

  // 단일 기본 매장 기준 공지 조회
  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();

    fetch(`/api/staff/notices?storeId=${encodeURIComponent(storeId!)}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          router.push("/");
          return;
        }
        const payload = (await response.json()) as { notices?: StaffNoticeResponse[]; error?: string };
        if (!response.ok || !Array.isArray(payload.notices)) {
          throw new NoticeLoadError(payload.error || DEFAULT_LOAD_ERROR);
        }
        const sortedNotices = [...payload.notices]
          .map(toStaffNotice)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setResult({ key: requestKey, status: "ready", notices: sortedNotices });
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
  }, [storeId, requestKey, router]);

  const currentResult = result && result.key === requestKey ? result : null;
  const allNotices = currentResult?.status === "ready" ? currentResult.notices : [];
  const trimmedQuery = query.trim();
  const visibleNotices = filterStaffNotices(allNotices, { source: sourceFilter, target: "all", query });

  // 상세 보기 시 해당 공지 찾기
  const selectedNotice = detail ? allNotices.find((notice) => notice.id === detail) ?? null : null;

  const openNotice = (notice: StaffNotice) => {
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
    });
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
            <p className="text-base text-[var(--color-text-secondary)]" role="status">
              공지사항을 불러오는 중...
            </p>
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
        ) : allNotices.length === 0 ? (
          <StateBox>
            <Megaphone size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <p className="text-base font-semibold text-[var(--color-text-primary)]">아직 등록된 공지사항이 없습니다.</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">본사에서 공지를 등록하면 이곳에서 확인할 수 있습니다.</p>
          </StateBox>
        ) : (
          <>
            {/* 검색 영역 */}
            <div className="mb-6">
              <div className="relative">
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
                  className="h-12 w-full rounded-lg border border-[var(--color-border)] bg-white pl-11 pr-4 text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                />
              </div>
            </div>

            {/* 공지 유형 필터 (카테고리 스타일) */}
            <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="공지 유형">
              {(
                [
                  { value: "all", label: "전체" },
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
                    onClick={() => setSourceFilter(value)}
                    className={`min-h-[36px] rounded-full border px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                      isActive
                        ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]"
                        : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-text-primary)]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* 공지 개수 */}
            <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
              공지사항 <span className="font-bold text-[var(--color-text-primary)]">{visibleNotices.length}</span>개
            </p>

            {visibleNotices.length === 0 ? (
              <StateBox>
                <Search size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {trimmedQuery ? `'${trimmedQuery}'에 대한 공지사항을 찾을 수 없습니다.` : "선택한 조건에 해당하는 공지사항이 없습니다."}
                </p>
              </StateBox>
            ) : (
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleNotices.map((notice) => (
                  <li key={notice.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => openNotice(notice)}
                      className="flex h-full w-full flex-col items-start rounded-xl border border-[var(--color-border)] bg-white p-5 text-left transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
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
          </>
        )}
      </div>
      {selectedNotice && (
        <NoticeDetailDialog
          notice={{ ...selectedNotice, sourceLabel: selectedNotice.sourceLabel }}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
