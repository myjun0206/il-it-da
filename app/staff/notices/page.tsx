"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Megaphone, Plus, RefreshCw } from "lucide-react";

import { useStaffShell } from "@/components/staff/StaffShellContext";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";

interface StaffNotice {
  id: string;
  targetType: "all" | "store";
  targetStoreName: string | null;
  title: string;
  content: string;
  createdAt: string;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}.${month}.${day}`;
}

export default function StaffNoticesPage() {
  const { stores } = useStaffShell();
  const [notices, setNotices] = useState<StaffNotice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<"all" | "hq" | string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const fetchNotices = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch("/api/staff/notices");
        const result = (await response.json()) as { notices?: StaffNotice[]; error?: string };

        if (!response.ok || result.error) {
          setError(result.error || "공지사항을 불러오지 못했습니다.");
          setNotices([]);
          return;
        }

        setNotices(result.notices ?? []);
      } catch {
        setError("공지사항을 불러오지 못했습니다.");
        setNotices([]);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchNotices();
  }, []);

  // 필터링된 공지 목록
  const filteredNotices = notices.filter((notice) => {
    // 범위 필터
    if (selectedFilter === "hq") {
      if (notice.targetType !== "all") return false;
    } else if (selectedFilter !== "all") {
      // 특정 매장
      const selectedStore = stores.find((s) => s.id === selectedFilter);
      if (!selectedStore) return false;
      if (notice.targetStoreName !== formatStoreDisplayName(selectedStore.name)) return false;
    }

    // 검색 필터
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (
        !notice.title.toLowerCase().includes(query) &&
        !notice.content.toLowerCase().includes(query)
      ) {
        return false;
      }
    }

    return true;
  });

  const reload = () => {
    void (async () => {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch("/api/staff/notices");
        const result = (await response.json()) as { notices?: StaffNotice[]; error?: string };
        if (!response.ok || result.error) {
          setError(result.error || "공지사항을 불러오지 못했습니다.");
          setNotices([]);
        } else {
          setNotices(result.notices ?? []);
        }
      } catch {
        setError("공지사항을 불러오지 못했습니다.");
      } finally {
        setIsLoading(false);
      }
    })();
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
          {/* 페이지 상단 */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">공지사항</h1>
            <p className="text-base text-[var(--color-text-secondary)]">
              본사와 근무 매장에서 전달한 공지사항을 확인할 수 있습니다.
            </p>
          </div>

          {/* 공지 요약 */}
          {!isLoading && !error && (
            <div className="mb-6 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary-light)]/40 px-3 py-1 text-sm font-semibold text-[var(--color-primary)]">
                전체 {notices.length}건
              </span>
            </div>
          )}

          {/* 에러 상태 */}
          {error && (
            <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-5">
              <AlertCircle size={20} className="shrink-0 text-red-700" aria-hidden="true" />
              <p className="flex-1 text-sm text-red-700">{error}</p>
              <button
                type="button"
                onClick={reload}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                <RefreshCw size={16} aria-hidden="true" /> 다시 시도
              </button>
            </div>
          )}

          {/* 로딩 상태 */}
          {isLoading && (
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
              <p className="text-base text-[var(--color-text-secondary)]" role="status">
                공지사항을 불러오는 중...
              </p>
            </div>
          )}

          {/* 빈 상태 */}
          {!isLoading && !error && notices.length === 0 && (
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
              <Megaphone size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
              <p className="text-base font-semibold text-[var(--color-text-primary)]">
                새로운 공지사항이 없습니다.
              </p>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                본사 또는 근무 매장에서 등록한 공지가 여기에 표시됩니다.
              </p>
            </div>
          )}

          {/* 필터 */}
          {!isLoading && !error && notices.length > 0 && (
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedFilter("all")}
                  className={`inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                    selectedFilter === "all"
                      ? "bg-[var(--color-primary)] text-white focus-visible:ring-[var(--color-primary)]"
                      : "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-border)] focus-visible:ring-[var(--color-primary)]"
                  }`}
                >
                  전체 공지
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFilter("hq")}
                  className={`inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                    selectedFilter === "hq"
                      ? "bg-[var(--color-primary)] text-white focus-visible:ring-[var(--color-primary)]"
                      : "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-border)] focus-visible:ring-[var(--color-primary)]"
                  }`}
                >
                  본사
                </button>
                {stores.map((store) => (
                  <button
                    key={store.id}
                    type="button"
                    onClick={() => setSelectedFilter(store.id)}
                    className={`inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                      selectedFilter === store.id
                        ? "bg-[var(--color-primary)] text-white focus-visible:ring-[var(--color-primary)]"
                        : "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-border)] focus-visible:ring-[var(--color-primary)]"
                    }`}
                  >
                    {formatStoreDisplayName(store.name)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 검색 */}
          {!isLoading && !error && notices.length > 0 && (
            <div className="mb-6">
              <input
                type="text"
                placeholder="공지사항 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="공지사항 검색"
                className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              />
            </div>
          )}

          {/* 공지 목록 */}
          {!isLoading && !error && filteredNotices.length > 0 && (
            <div className="space-y-3">
              {filteredNotices.map((notice) => (
                <Link
                  key={notice.id}
                  href={`/staff/notices/${notice.id}`}
                  className="block rounded-lg border border-[var(--color-border)] bg-white p-4 transition-colors hover:bg-[var(--color-bg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-[var(--color-primary-light)]/30 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
                          {notice.targetStoreName}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1 truncate">
                        {notice.title}
                      </h3>
                      <p className="text-sm text-[var(--color-text-secondary)] line-clamp-2">
                        {notice.content}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        {formatDate(notice.createdAt)}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* 필터된 결과 없음 */}
          {!isLoading && !error && notices.length > 0 && filteredNotices.length === 0 && (
            <div className="rounded-lg border border-[var(--color-border)] bg-white p-8 text-center">
              <p className="text-base text-[var(--color-text-secondary)]">
                검색 결과가 없습니다.
              </p>
            </div>
          )}
        </div>
      </div>
  );
}
