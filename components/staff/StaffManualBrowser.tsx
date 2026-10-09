"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, BookOpen, ChevronRight, FileText, RefreshCw, Search, Store as StoreIcon } from "lucide-react";

import { useStaffShell } from "@/components/staff/StaffShellContext";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";
import type { ManualRecord } from "@/lib/types/manual";

// 직원 매뉴얼 화면(공통/지점) 공통 UI. 조회·검색·상세 보기만 있다 — 생성/수정/삭제/업로드 Action 없음.
// 데이터는 /api/staff/manuals가 approved staff membership을 검증한 매장 범위로만 내려준다.

type Scope = "common" | "store";

type ManualGroup = {
  id: string;
  category: string;
  title: string;
  items: ManualRecord[];
};

type LoadResult =
  | { key: string; status: "ready"; manuals: ManualRecord[] }
  | { key: string; status: "error"; message: string };

const COPY: Record<Scope, { title: string; description: string; empty: string; backLabel: string }> = {
  common: {
    title: "공통 매뉴얼",
    description: "매장 운영에 필요한 공통 업무 매뉴얼을 확인할 수 있습니다.",
    empty: "등록된 공통 매뉴얼이 없습니다.",
    backLabel: "공통 매뉴얼",
  },
  store: {
    title: "지점 매뉴얼",
    description: "기본 매장의 업무 매뉴얼을 확인할 수 있습니다.",
    empty: "현재 매장에 등록된 지점 매뉴얼이 없습니다.",
    backLabel: "지점 매뉴얼",
  },
};

const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_ID_LIKE_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

function getDisplayCategoryName(category: string): string {
  const trimmed = category.trim();
  if (!trimmed) return "미분류";
  if (UUID_LIKE_PATTERN.test(trimmed) || INTERNAL_ID_LIKE_PATTERN.test(trimmed)) return "카테고리";
  return trimmed;
}

// 검색어가 포함된 짧은 구절 추출 (최대 60자, 단어 경계 존중)
function extractMatchedPreview(text: string, query: string, maxLength: number = 60): string {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);
  
  if (matchIndex === -1) return "";
  
  // 검색어를 중심으로 앞뒤 30자씩 추출하되, 단어 경계 존중
  const start = Math.max(0, matchIndex - 15);
  const end = Math.min(text.length, matchIndex + query.length + 30);
  
  let preview = text.substring(start, end).trim();
  
  // 너무 길면 말줄임
  if (preview.length > maxLength) {
    preview = preview.substring(0, maxLength).trim() + "…";
  }
  
  return preview;
}

function groupByCategory(manuals: ManualRecord[]): ManualGroup[] {
  const manualsById = new Map(manuals.map((manual) => [manual.id, manual]));
  const parentIds = new Set(manuals.flatMap((manual) => manual.parent_manual_id ? [manual.parent_manual_id] : []));
  const groupsByCategory = new Map<string, ManualGroup>();

  for (const manual of manuals) {
    if (parentIds.has(manual.id)) continue;
    const parent = manual.parent_manual_id ? manualsById.get(manual.parent_manual_id) : undefined;
    const category = getDisplayCategoryName(manual.category?.trim() || parent?.category || "");
    const existing = groupsByCategory.get(category);
    if (existing) {
      existing.items.push(manual);
    } else {
      groupsByCategory.set(category, {
        id: `category:${category}`,
        category,
        title: category,
        items: [manual],
      });
    }
  }

  return [...groupsByCategory.values()];
}

function groupByTitle(manuals: ManualRecord[]): Array<Pick<ManualGroup, "id" | "title" | "items">> {
  const groupsByTitle = new Map<string, Pick<ManualGroup, "id" | "title" | "items">>();
  const seenIds = new Set<string>();

  for (const manual of manuals) {
    if (seenIds.has(manual.id)) continue;
    seenIds.add(manual.id);
    const title = manual.title.normalize("NFC").trim().replace(/\s+/g, " ");
    const key = title ? `title:${title}` : `id:${manual.id}`;
    const existing = groupsByTitle.get(key);
    if (existing) {
      existing.items.push(manual);
    } else {
      groupsByTitle.set(key, {
        id: manual.id,
        title: title || `세부 매뉴얼 ${groupsByTitle.size + 1}`,
        items: [manual],
      });
    }
  }

  return [...groupsByTitle.values()];
}

function uniqueManualContents(manuals: ManualRecord[]): ManualRecord[] {
  const seenContents = new Set<string>();
  return manuals.filter((manual) => {
    const content = manual.content.replace(/\r\n/g, "\n").trim();
    if (seenContents.has(content)) return false;
    seenContents.add(content);
    return true;
  });
}

const MANUAL_GRID_CLASS_NAME = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3";

function ManualNavigationCard({
  category,
  title,
  description,
  onClick,
}: {
  category: string;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full w-full flex-col items-start rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5 text-left transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
    >
      <span className="mb-3 inline-flex max-w-full truncate rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
        {category}
      </span>
      <span className="w-full text-base font-semibold text-[var(--color-text-primary)] break-keep line-clamp-2">
        {title}
      </span>
      <span className="mt-auto pt-3 text-xs text-[var(--color-text-tertiary)]">{description}</span>
    </button>
  );
}

// 검색어가 있을 때 일치하는 세부 매뉴얼을 각각 반환 (상위 매뉴얼 + 세부 매뉴얼 정보 포함)
function searchSubManuals(
  groups: ManualGroup[],
  query: string,
  filterCategory: string | null,
): Array<{ parentGroup: ManualGroup; subManual: ManualRecord; matchedPreview: string }> {
  if (!query) return [];

  const normalizedQuery = query.trim().toLowerCase();
  const results: Array<{ parentGroup: ManualGroup; subManual: ManualRecord; matchedPreview: string }> = [];
  const seenSubManualIds = new Set<string>(); // 중복 제거

  for (const group of groups) {
    // 카테고리 필터가 있으면 적용
    if (filterCategory && group.category !== filterCategory) continue;

    for (const item of group.items) {
      // 중복 제거: 같은 세부 매뉴얼이 여러 번 검색되지 않도록
      if (seenSubManualIds.has(item.id)) continue;

      // 검색 대상 텍스트: 상위 매뉴얼 제목 + 세부 매뉴얼 제목 + 세부 매뉴얼 전체 본문
      const searchableText = [
        group.title,           // 상위 매뉴얼 제목
        item.title,            // 세부 매뉴얼 제목
        item.content ?? "",    // 세부 매뉴얼 전체 본문 (null/undefined 처리)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (searchableText.includes(normalizedQuery)) {
        // 매칭된 구절 추출: 우선순위는 content > title > group.title
        let matchedPreview = extractMatchedPreview(item.content ?? "", normalizedQuery);
        if (!matchedPreview) {
          matchedPreview = extractMatchedPreview(item.title, normalizedQuery);
        }
        if (!matchedPreview) {
          matchedPreview = extractMatchedPreview(group.title, normalizedQuery);
        }

        results.push({ parentGroup: group, subManual: item, matchedPreview });
        seenSubManualIds.add(item.id);
      }
    }
  }

  return results;
}

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

export default function StaffManualBrowser({ scope }: { scope: Scope }) {
  const router = useRouter();
  const copy = COPY[scope];
  const { selectedStore, defaultStoreId, isStoresLoading, storesError, reloadStores } = useStaffShell();
  const [result, setResult] = useState<LoadResult | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // 상세 보기: 매장이 바뀌면 자동으로 목록으로 돌아가도록 매장 ID와 함께 기억한다.
  // subId는 선택한 매뉴얼 ID이다.
  const [detail, setDetail] = useState<{ storeId: string; groupId: string; subId?: string } | null>(null);

  // 지점 매뉴얼: 기본 매장 사용 | 공통 매뉴얼: 선택 매장 사용
  const effectiveStoreId = scope === "store" ? defaultStoreId : selectedStore?.id;
  const storeId = effectiveStoreId ?? null;
  const requestKey = storeId ? `${scope}:${storeId}:${reloadToken}` : null;

  useEffect(() => {
    if (!storeId || !requestKey) return;
    const controller = new AbortController();

    fetch(`/api/staff/manuals?scope=${scope}&storeId=${encodeURIComponent(storeId)}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          router.push("/");
          return;
        }
        const payload = (await response.json()) as { manuals?: ManualRecord[] };
        if (!response.ok || !Array.isArray(payload.manuals)) {
          setResult({
            key: requestKey,
            status: "error",
            message:
              response.status === 403
                ? "이 매장의 매뉴얼을 볼 권한이 확인되지 않았습니다. 근무 매장을 확인해 주세요."
                : "매뉴얼을 불러오지 못했습니다.",
          });
          return;
        }
        setResult({ key: requestKey, status: "ready", manuals: payload.manuals });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, status: "error", message: "매뉴얼을 불러오지 못했습니다." });
        }
      });

    return () => controller.abort();
  }, [scope, storeId, requestKey, router]);

  const currentResult = result && result.key === requestKey ? result : null;
  const groups = currentResult?.status === "ready"
    ? groupByCategory(currentResult.manuals)
    : [];
  const categories = [...new Set(groups.map((group) => group.category))];
  const normalizedQuery = query.trim().toLowerCase();
  // 매장 전환 등으로 사라진 카테고리가 선택돼 있으면 전체로 본다.
  const effectiveCategory = activeCategory && categories.includes(activeCategory) ? activeCategory : null;

  // 검색 모드 여부
  const isSearchMode = normalizedQuery.length > 0;

  // 검색 모드: 세부 매뉴얼 검색 결과
  const searchResults = isSearchMode ? searchSubManuals(groups, normalizedQuery, effectiveCategory) : [];

  // 비검색 모드: 기존 상위 매뉴얼 필터링
  const visibleGroups = !isSearchMode
    ? groups.filter((group) => !effectiveCategory || group.category === effectiveCategory)
    : [];

  const openGroup = detail && detail.storeId === storeId ? groups.find((group) => group.id === detail.groupId) ?? null : null;
  const titleGroups = openGroup ? groupByTitle(openGroup.items) : [];
  const selectedManual = openGroup && detail?.subId
    ? openGroup.items.find((item) => item.id === detail.subId) ?? null
    : null;
  const selectedTitleGroup = selectedManual
    ? titleGroups.find((group) => group.items.some((item) => item.id === selectedManual.id)) ?? null
    : null;

  const navigateDetail = (nextDetail: typeof detail) => {
    setDetail(nextDetail);
    document.querySelector("main")?.scrollTo({ top: 0 });
  };

  // ── 상세 ─────────────────────────────────────────
  if (openGroup) {
    return (
      <div className="p-6 lg:p-8 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <div className="max-w-7xl mx-auto">
          <button
            type="button"
            onClick={() => navigateDetail(selectedManual && storeId ? { storeId, groupId: openGroup.id } : null)}
            aria-label={`${selectedManual ? openGroup.title : copy.backLabel} 목록으로 돌아가기`}
            className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-6 lg:left-[calc(240px+1.5rem)] z-10 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-(--color-border) bg-(--color-bg-surface) px-4 text-sm font-semibold text-(--color-primary) shadow-md transition-colors hover:bg-(--color-primary-light) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary) focus-visible:ring-offset-2"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {selectedManual ? "세부 매뉴얼 목록" : copy.backLabel}
          </button>

          <nav aria-label="매뉴얼 탐색 경로" className="mb-5 text-sm text-(--color-text-secondary)">
              <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <li>
                  <button type="button" onClick={() => navigateDetail(null)} className="min-h-11 text-(--color-primary) hover:underline">
                    {copy.title}
                  </button>
                </li>
                <li aria-hidden="true"><ChevronRight size={16} /></li>
                <li className="min-w-0 break-words">
                  {selectedManual && storeId ? (
                    <button type="button" onClick={() => navigateDetail({ storeId, groupId: openGroup.id })} className="min-h-11 text-left text-(--color-primary) hover:underline">
                      {openGroup.title}
                    </button>
                  ) : (
                    <span aria-current="page">{openGroup.title}</span>
                  )}
                </li>
                {selectedManual && (
                  <>
                    <li aria-hidden="true"><ChevronRight size={16} /></li>
                    <li aria-current="page" className="min-w-0 break-words">{selectedTitleGroup?.title || selectedManual.title || openGroup.title}</li>
                  </>
                )}
              </ol>
          </nav>

          <div className="mb-6">
            <span className="mb-3 inline-flex rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
              {openGroup.category}
            </span>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] break-words">{selectedTitleGroup?.title || selectedManual?.title || openGroup.title}</h1>
            {scope === "store" && selectedStore && (
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{formatStoreDisplayName(selectedStore.name)}</p>
            )}
          </div>

          {!selectedManual ? (
            // selectedManual이 없을 때: 모든 매뉴얼 항목의 content 표시 또는 안내
            openGroup.items && openGroup.items.length > 0 ? (
              <div className="space-y-4">
                {uniqueManualContents(openGroup.items).map((item) => {
                  return (
                    <article
                      key={item.id}
                      id={`sub-manual-${item.id}`}
                      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5 lg:p-6 scroll-mt-24"
                    >
                      {item.title && (
                        <h2 className="mb-3 text-lg font-semibold text-[var(--color-text-primary)]">{item.title}</h2>
                      )}
                      <p className="whitespace-pre-wrap break-words text-base leading-7 text-[var(--color-text-primary)]">{item.content}</p>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-8 text-center">
                <p className="text-base text-[var(--color-text-secondary)]">등록된 매뉴얼 내용이 없습니다.</p>
              </div>
            )
          ) : (
          <div className="space-y-4">
            {(selectedTitleGroup ? uniqueManualContents(selectedTitleGroup.items) : [selectedManual]).map((item) => {
              const isHighlighted = detail?.subId === item.id;
              return (
                <article
                  key={item.id}
                  id={`sub-manual-${item.id}`}
                  className={`rounded-xl border bg-[var(--color-bg-surface)] p-5 lg:p-6 scroll-mt-24 transition-colors ${
                    isHighlighted
                      ? "border-[var(--color-primary)]/50"
                      : "border-[var(--color-border)]"
                  }`}
                >
                  {item.title && (
                    <h2 className="mb-3 text-lg font-semibold text-[var(--color-text-primary)]">{item.title}</h2>
                  )}
                  <p className="whitespace-pre-wrap break-words text-base leading-7 text-[var(--color-text-primary)]">{item.content}</p>
                </article>
              );
            })}
          </div>
          )}
        </div>
      </div>
    );
  }

  // ── 목록 ─────────────────────────────────────────
  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">{copy.title}</h1>
          <p className="text-base text-[var(--color-text-secondary)]">{copy.description}</p>
        </div>

        {isStoresLoading ? (
          <StateBox>
            <p className="text-base text-[var(--color-text-secondary)]" role="status">근무 매장을 확인하는 중...</p>
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
        ) : !selectedStore ? (
          <StateBox>
            <StoreIcon size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <p className="text-base font-semibold text-[var(--color-text-primary)]">승인된 근무 매장이 없습니다.</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">근무 매장이 승인되면 매뉴얼을 확인할 수 있습니다.</p>
            <Link
              href="/staff/stores"
              className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
            >
              근무 매장 관리
            </Link>
          </StateBox>
        ) : !currentResult ? (
          <StateBox>
            <p className="text-base text-[var(--color-text-secondary)]" role="status">매뉴얼을 불러오는 중...</p>
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
        ) : groups.length === 0 ? (
          <StateBox>
            <BookOpen size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <p className="text-base font-semibold text-[var(--color-text-primary)]">{copy.empty}</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {scope === "common" ? "본사에서 매뉴얼을 등록하면 이곳에서 확인할 수 있습니다." : "점주가 매뉴얼을 등록하면 이곳에서 확인할 수 있습니다."}
            </p>
          </StateBox>
        ) : (
          <>
            {/* 검색 */}
            <div className="mb-6 relative">
              <Search
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="매뉴얼 검색"
                aria-label="매뉴얼 검색"
                className="h-12 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] pl-11 pr-4 text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
              />
            </div>

            {/* 카테고리: 실제 매뉴얼 데이터에 있는 카테고리만 */}
            {categories.length > 1 && (
              <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="카테고리">
                {[null, ...categories].map((category) => {
                  const isActive = effectiveCategory === category;
                  return (
                    <button
                      key={category ?? "__all"}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setActiveCategory(category)}
                      className={`min-h-[36px] rounded-full border px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                        isActive
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                          : "border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-bg-surface)]/50 hover:text-[var(--color-text-primary)]"
                      }`}
                    >
                      {category ?? "전체"}
                    </button>
                  );
                })}
              </div>
            )}

            {isSearchMode ? (
              // 검색 모드: 세부 매뉴얼 검색 결과
              <>
                <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
                  검색 결과 <span className="font-bold text-[var(--color-text-primary)]">{searchResults.length}</span>개
                </p>

                {searchResults.length === 0 ? (
                  <StateBox>
                    <FileText size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                    <p className="text-base text-[var(--color-text-secondary)]">검색 결과가 없습니다.</p>
                  </StateBox>
                ) : (
                  <ul className="space-y-3">
                    {searchResults.map(({ parentGroup, subManual, matchedPreview }) => (
                      <li key={`${parentGroup.id}-${subManual.id}`}>
                        <button
                          type="button"
                          onClick={() => {
                            if (!storeId) return;
                            navigateDetail({ storeId, groupId: parentGroup.id });
                          }}
                          className="flex w-full flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-5 py-4 text-left transition-colors hover:border-[var(--color-border)]/70 hover:bg-[var(--color-primary)]/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                        >
                          <div className="flex w-full items-start justify-between gap-3">
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              <span className="inline-flex flex-shrink-0 rounded-full bg-[var(--color-primary-light)]/40 px-2 py-0.5 text-xs font-medium text-[var(--color-primary)]">
                                {parentGroup.category}
                              </span>
                              <span className="text-base font-semibold text-[var(--color-text-primary)] truncate">
                                {subManual.title}
                              </span>
                            </div>
                            <ChevronRight size={20} className="flex-shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                          </div>
                          {matchedPreview && (
                            <p className="mt-2.5 text-sm text-[var(--color-text-secondary)] line-clamp-1 break-keep">
                              {matchedPreview}
                            </p>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              // 비검색 모드: 상위 매뉴얼 카드 그리드
              <>
                <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
                  카테고리 <span className="font-bold text-[var(--color-text-primary)]">{visibleGroups.length}</span>개
                </p>

                {visibleGroups.length === 0 ? (
                  <StateBox>
                    <FileText size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                    <p className="text-base text-[var(--color-text-secondary)]">검색 결과가 없습니다.</p>
                  </StateBox>
                ) : (
                  <ul className={MANUAL_GRID_CLASS_NAME}>
                    {visibleGroups.map((group) => (
                      <li key={group.id} className="min-w-0">
                        <ManualNavigationCard
                          category={copy.title}
                          title={group.title}
                          description={`매뉴얼 ${groupByTitle(group.items).length}개`}
                          onClick={() => {
                            if (!storeId) return;
                            navigateDetail({ storeId, groupId: group.id });
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
