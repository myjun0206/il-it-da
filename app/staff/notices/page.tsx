"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Megaphone, RefreshCw } from "lucide-react";

import { useStaffShell } from "@/components/staff/StaffShellContext";
import { NoticeCard } from "@/components/notices/NoticeCard";
import { NoticeDetailDialog } from "@/components/notices/NoticeDetailDialog";
import { NoticeFilter, type NoticeFilterOption } from "@/components/notices/NoticeFilter";
import { NoticePageHeader } from "@/components/notices/NoticePageHeader";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";
import { getNoticeViewCountIncrement, markNoticeAsRead } from "@/lib/notices/mark-notice-read";

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
  createdAt: string;
}

type StaffNoticeResponse = Omit<StaffNotice, "sourceType">;
type StaffSourceFilter = "all" | "hq" | "owner";

const ALL_TARGETS = "all";
const FRANCHISE_TARGETS = "franchise";
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

export default function StaffNoticesPage() {
  const { stores } = useStaffShell();
  const [notices, setNotices] = useState<StaffNotice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [sourceFilter, setSourceFilter] = useState<StaffSourceFilter>("all");
  const [targetFilter, setTargetFilter] = useState<string>(ALL_TARGETS);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNotice, setSelectedNotice] = useState<StaffNotice | null>(null);

  const targetFilterOptions: readonly NoticeFilterOption<string>[] = [
    { value: ALL_TARGETS, label: "전체 대상" },
    { value: FRANCHISE_TARGETS, label: "전체 지점" },
    ...stores.map((store) => ({
      value: store.id,
      label: formatStoreDisplayName(store.name),
    })),
  ];

  useEffect(() => {
    const fetchNotices = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch("/api/staff/notices");
        const result = (await response.json()) as { notices?: StaffNoticeResponse[]; error?: string };

        if (!response.ok || result.error) {
          setError(result.error || "공지사항을 불러오지 못했습니다.");
          setNotices([]);
          return;
        }

        setNotices((result.notices ?? []).map(toStaffNotice));
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
    if (sourceFilter !== "all" && notice.sourceType !== sourceFilter) return false;

    // 대상 범위와 개별 매장 필터는 출처 필터와 독립적으로 적용한다.
    if (targetFilter === FRANCHISE_TARGETS) {
      if (notice.targetType !== "all" && notice.targetType !== "franchise") return false;
    } else if (targetFilter !== ALL_TARGETS) {
      const selectedStore = stores.find((store) => store.id === targetFilter);
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
        const result = (await response.json()) as { notices?: StaffNoticeResponse[]; error?: string };
        if (!response.ok || result.error) {
          setError(result.error || "공지사항을 불러오지 못했습니다.");
          setNotices([]);
        } else {
          setNotices((result.notices ?? []).map(toStaffNotice));
        }
      } catch {
        setError("공지사항을 불러오지 못했습니다.");
      } finally {
        setIsLoading(false);
      }
    })();
  };

  const openNotice = (notice: StaffNotice) => {
    setSelectedNotice(notice);
    if (notice.isRead) return;

    void markNoticeAsRead(notice.id).then((result) => {
      if (!result.succeeded) return;
      const viewCountIncrement = getNoticeViewCountIncrement(result);
      setNotices((current) => current.map((currentNotice) =>
        currentNotice.id === notice.id
          ? { ...currentNotice, isRead: true, viewCount: currentNotice.viewCount + viewCountIncrement }
          : currentNotice,
      ));
      setSelectedNotice((current) => current?.id === notice.id
        ? { ...current, isRead: true, viewCount: current.viewCount + viewCountIncrement }
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
            <div className="mb-6 space-y-3">
              <NoticeFilter
                ariaLabel="공지 출처"
                value={sourceFilter}
                options={STAFF_SOURCE_FILTERS}
                onChange={setSourceFilter}
              />
              <NoticeFilter
                ariaLabel="공지 대상"
                value={targetFilter}
                options={targetFilterOptions}
                onChange={setTargetFilter}
              />
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
                <NoticeCard
                  key={notice.id}
                  title={notice.title}
                  content={notice.content}
                  sourceLabel={`${notice.sourceLabel} · ${notice.targetStoreName ?? "대상 지점"}`}
                  createdAt={notice.createdAt}
                  viewCount={notice.viewCount}
                  isRead={notice.isRead}
                  onOpen={() => openNotice(notice)}
                />
              ))}
            </div>
          )}

          {/* 필터된 결과 없음 */}
          {!isLoading && !error && notices.length > 0 && filteredNotices.length === 0 && (
            <div className="rounded-lg border border-[var(--color-border)] bg-white p-8 text-center">
              <p className="text-base text-[var(--color-text-secondary)]">
                선택한 조건에 해당하는 공지가 없습니다.
              </p>
            </div>
          )}
        </div>
        {selectedNotice && (
          <NoticeDetailDialog
            notice={{
              ...selectedNotice,
              sourceLabel: `${selectedNotice.sourceLabel} · ${selectedNotice.targetStoreName ?? "대상 지점"}`,
            }}
            onClose={() => setSelectedNotice(null)}
          />
        )}
      </div>
  );
}
