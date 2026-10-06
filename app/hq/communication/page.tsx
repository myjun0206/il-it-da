"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Megaphone, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { NoticeDetailDialog } from "@/components/notices/NoticeDetailDialog";
import { NoticeEditDialog } from "@/components/notices/NoticeEditDialog";
import { NoticeFilter, type NoticeFilterOption } from "@/components/notices/NoticeFilter";
import type { HqNoticeItem } from "@/lib/types/notice";

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

const ALL_TARGETS = "all";
const HQ_NOTICE_FILTERS: readonly NoticeFilterOption<HqNoticeFilter>[] = [
  { value: "all", label: "전체" },
  { value: "franchise", label: "전체 지점" },
  { value: "store", label: "특정 지점" },
];

const NEW_NOTICE_HREF = "/hq/communication/new";

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
  const [isReady, setIsReady] = useState(false);
  const [notices, setNotices] = useState<HqNotice[]>([]);
  const [isLoadingNotices, setIsLoadingNotices] = useState(true);
  const [noticesError, setNoticesError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<HqNoticeFilter>("all");
  const [targetFilter, setTargetFilter] = useState(ALL_TARGETS);
  const [editingNotice, setEditingNotice] = useState<HqNotice | null>(null);
  const [deletingNotice, setDeletingNotice] = useState<HqNotice | null>(null);
  const [selectedNotice, setSelectedNotice] = useState<HqNotice | null>(null);
  const [isDeletingNotice, setIsDeletingNotice] = useState(false);

  useEffect(() => {
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) return;

    const loadNotices = async () => {
      try {
        const response = await fetch("/api/hq/notices");
        const result = (await response.json()) as { notices?: HqNoticeItem[]; error?: string };
        if (!response.ok) {
          throw new Error(result.error || "공지사항을 불러오지 못했습니다.");
        }
        setNotices((result.notices ?? []).map(toNoticeRow));
      } catch (error) {
        console.error("Failed to load notices:", error);
        setNoticesError(error instanceof Error ? error.message : "공지사항을 불러오지 못했습니다.");
      } finally {
        setIsLoadingNotices(false);
      }
    };

    void loadNotices();
  }, [isReady]);



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

  // 대상 필터 값은 실제로 불러온 공지의 대상에서만 만든다.
  const targetOptions = useMemo(() => {
    const scopedNotices = notices.filter((notice) => {
      if (scopeFilter === "franchise") return false;
      return scopeFilter === "all" || notice.targetType === "store";
    });
    return [...new Set(scopedNotices.map((notice) => notice.target))].sort((a, b) => a.localeCompare(b));
  }, [notices, scopeFilter]);

  const filteredNotices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return notices
      .filter((notice) => scopeFilter === "all"
        || (scopeFilter === "franchise"
          ? notice.targetType === "all" || notice.targetType === "franchise"
          : notice.targetType === "store"))
      .filter((notice) => targetFilter === ALL_TARGETS || notice.target === targetFilter)
      .filter((notice) => !query || notice.title.toLowerCase().includes(query))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [notices, scopeFilter, searchQuery, targetFilter]);

  const changeScopeFilter = (value: HqNoticeFilter) => {
    setScopeFilter(value);
    setTargetFilter(ALL_TARGETS);
  };

  if (!isReady) {
    return null;
  }

  return (
    <>
    <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {/* 페이지 헤더 */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">공지사항</h1>
              <p className="text-base text-[var(--color-text-secondary)]">전체 또는 특정 지점에 전달할 공지를 작성하고 관리합니다.</p>
            </div>
            <CreateNoticeButton label="새 공지 작성" />
          </div>

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
            ) : notices.length === 0 ? (
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
                {/* 범위 필터 (chip 스타일) */}
                <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="공지 범위">
                  {HQ_NOTICE_FILTERS.map(({ value, label }) => {
                    const isActive = scopeFilter === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => changeScopeFilter(value)}
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

                {/* 검색 & 대상 필터 */}
                <div className="mb-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-3">
                    <div className="relative flex-1">
                      <Search
                        size={18}
                        aria-hidden="true"
                        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                      />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="공지사항 검색"
                        aria-label="공지사항 검색"
                        className="min-h-[44px] w-full rounded-lg border border-[var(--color-border)] bg-white pl-11 pr-4 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                      />
                    </div>
                    {scopeFilter !== "franchise" && targetOptions.length > 0 && (
                      <select
                        value={targetFilter}
                        onChange={(event) => setTargetFilter(event.target.value)}
                        aria-label="공지 대상 지점 필터"
                        className="min-h-[44px] rounded-lg border border-[var(--color-border)] bg-white px-4 text-sm font-medium text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                      >
                        <option value={ALL_TARGETS}>{scopeFilter === "store" ? "모든 특정 지점" : "전체 대상"}</option>
                        {targetOptions.map((target) => (
                          <option key={target} value={target}>
                            {target}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* 공지사항 개수 */}
                <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
                  공지사항 <span className="font-bold text-[var(--color-text-primary)]">{filteredNotices.length}</span>개
                </p>

                {filteredNotices.length === 0 ? (
                  <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                    <Search size={28} className="mx-auto mb-3 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                    <p className="text-base text-[var(--color-text-secondary)]">선택한 조건에 맞는 공지사항이 없습니다.</p>
                  </div>
                ) : (
                  <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {filteredNotices.map((notice) => (
                      <li key={notice.id} className="min-w-0">
                        <button
                          type="button"
                          onClick={() => setSelectedNotice(notice)}
                          className="flex h-full w-full flex-col items-start rounded-xl border border-[var(--color-border)] bg-white p-5 text-left transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                        >
                          <div className="mb-3 flex gap-2 items-center">
                            <span className="inline-flex rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
                              본사
                            </span>
                          </div>
                          <h3 className="w-full text-base font-semibold text-[var(--color-text-primary)] break-keep line-clamp-2">
                            {notice.title}
                          </h3>
                          <p className="mt-2 w-full text-sm text-[var(--color-text-secondary)] line-clamp-2">
                            {notice.content}
                          </p>
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
          </section>
        </main>

      {/* 상세 보기 다이얼로그 */}
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

      {/* 수정 다이얼로그 */}
      {editingNotice && (
        <NoticeEditDialog
          key={editingNotice.id}
          notice={editingNotice}
          onClose={() => setEditingNotice(null)}
          onSave={updateNotice}
        />
      )}

      {/* 삭제 확인 다이얼로그 */}
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