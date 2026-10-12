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
type ManualView = "categories" | "titles" | "items";
type FilterType = "all" | "category" | "manual";

type ManualGroup = {
  id: string;
  category: string;
  title: string;
  items: ManualRecord[];
};

type ManualCategory = {
  category: string;
  groups: ManualGroup[];
  itemCount: number;
};

type ManualNavigation = {
  scope: Scope;
  storeId: string;
  category: string;
  titleId?: string;
  subId?: string;
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

function groupByParent(manuals: ManualRecord[]): ManualGroup[] {
  const topLevel = manuals.filter((manual) => !manual.parent_manual_id);
  const childrenByParent = new Map<string, ManualRecord[]>();
  for (const manual of manuals) {
    if (!manual.parent_manual_id) continue;
    const children = childrenByParent.get(manual.parent_manual_id) ?? [];
    children.push(manual);
    childrenByParent.set(manual.parent_manual_id, children);
  }

  return topLevel.map((parent) => {
    const children = childrenByParent.get(parent.id) ?? [];
    return {
      id: parent.id,
      category: parent.category?.trim() || "미분류",
      title: parent.title,
      items: children.length > 0 ? children : [parent],
    };
  });
}

function groupByCategory(groups: ManualGroup[]): ManualCategory[] {
  const categories = new Map<string, ManualGroup[]>();
  for (const group of groups) {
    const categoryGroups = categories.get(group.category) ?? [];
    categoryGroups.push(group);
    categories.set(group.category, categoryGroups);
  }

  return Array.from(categories.entries()).map(([category, categoryGroups]) => ({
    category,
    groups: categoryGroups,
    itemCount: categoryGroups.reduce((count, group) => count + group.items.length, 0),
  }));
}

const MANUAL_GRID_CLASS_NAME = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3";

function ManualNavigationCard({
  scope = "common",
  category,
  title,
  description,
  onClick,
}: {
  scope?: Scope;
  category?: string;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={scope === "common"
        ? "min-h-[110px] flex h-full w-full flex-col items-start justify-between rounded-lg border border-(--color-border) bg-(--color-bg-surface) px-5 py-4 text-left transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-light)/10 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
        : "relative h-full w-full cursor-pointer rounded-xl border border-(--color-border) bg-(--color-bg-surface) p-5 text-left transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-light)/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"}
    >
      {category && (
        <span className="mb-3 inline-flex max-w-full truncate rounded-full bg-(--color-primary-light)/40 px-2.5 py-0.5 text-xs font-semibold text-(--color-primary)">
          {category}
        </span>
      )}
      <span className="flex w-full items-start gap-3">
        <span className={`min-w-0 flex-1 text-(--color-text-primary) wrap-anywhere line-clamp-2 ${scope === "store" && category ? "text-base font-semibold" : "text-lg font-bold"}`}>{title}</span>
        {scope === "common" && <ChevronRight size={20} className="mt-0.5 shrink-0 text-(--color-primary)" aria-hidden="true" />}
      </span>
      <span className="mt-auto block pt-3 text-xs text-(--color-text-tertiary) wrap-anywhere">{description}</span>
    </button>
  );
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
  const { selectedStore, defaultStoreId, stores, isStoresLoading, storesError, reloadStores } = useStaffShell();
  const [result, setResult] = useState<LoadResult | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("category");
  const [detail, setDetail] = useState<ManualNavigation | null>(null);
  const [titleSearchQuery, setTitleSearchQuery] = useState("");
  const [itemSearchQuery, setItemSearchQuery] = useState("");

  // 지점 매뉴얼: 기본 매장 사용 | 공통 매뉴얼: 선택 매장 사용
  const effectiveStoreId = scope === "store" ? defaultStoreId : selectedStore?.id;
  const storeId = effectiveStoreId ?? null;
  const manualStore = stores.find((store) => store.id === storeId) ?? null;
  const requestKey = storeId ? `${scope}:${storeId}:${reloadToken}` : null;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
      document.querySelector("main")?.scrollTo({ top: 0, behavior: "instant" });
      if (detail?.scope === scope && detail.storeId === storeId && detail.subId) {
        document.getElementById(`sub-manual-${detail.subId}`)?.scrollIntoView({ block: "start", behavior: "instant" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [detail, scope, storeId]);

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
    ? groupByParent(currentResult.manuals)
    : [];
  const categories = groupByCategory(groups);
  const normalizedQuery = query.trim().toLowerCase();
  const matchesGroup = (group: ManualGroup) =>
    [group.title, ...group.items.flatMap((item) => [item.title, item.content])]
      .join(" ").toLowerCase().includes(normalizedQuery);
  const visibleCategories = categories.filter((category) =>
    getDisplayCategoryName(category.category).toLowerCase().includes(normalizedQuery) || category.groups.some(matchesGroup),
  );
  const filteredCategories = filterType === "manual" ? [] : visibleCategories;
  const filteredManuals = filterType === "category" ? [] : visibleCategories.flatMap((category) => category.groups);

  const openCategory = detail?.scope === scope && detail.storeId === storeId
    ? categories.find((category) => category.category === detail.category) ?? null
    : null;
  const openTitle = openCategory && detail?.titleId
    ? openCategory.groups.find((group) => group.id === detail.titleId) ?? null
    : null;
  const view: ManualView = openTitle ? "items" : openCategory ? "titles" : "categories";
  const normalizedTitleSearch = titleSearchQuery.trim().toLowerCase();
  const visibleTitles = openCategory?.groups.filter((group) =>
    [group.title, ...group.items.flatMap((item) => [item.title, item.content])]
      .join(" ").toLowerCase().includes(normalizedTitleSearch),
  ) ?? [];
  const normalizedItemSearch = itemSearchQuery.trim().toLowerCase();
  const visibleItems = openTitle?.items.filter((item) =>
    [item.title, item.content].join(" ").toLowerCase().includes(normalizedItemSearch),
  ) ?? [];

  const navigateDetail = (nextDetail: typeof detail) => {
    setDetail(nextDetail);
    setTitleSearchQuery("");
    setItemSearchQuery("");
  };

  // ── 상세 ─────────────────────────────────────────
  if (view !== "categories" && openCategory && storeId) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <nav aria-label="매뉴얼 탐색 경로" className="mb-5 text-sm text-(--color-text-secondary)">
              <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 wrap-anywhere">
                <li>
                  <button type="button" onClick={() => navigateDetail(null)} className="min-h-11 text-(--color-primary) hover:underline">
                    {copy.title}
                  </button>
                </li>
                <li aria-hidden="true"><ChevronRight size={16} /></li>
                <li className="min-w-0 wrap-anywhere">
                  {openTitle ? (
                    <button type="button" onClick={() => navigateDetail({ scope, storeId, category: openCategory.category })} className="min-h-11 text-left text-(--color-primary) hover:underline">
                      {getDisplayCategoryName(openCategory.category)}
                    </button>
                  ) : (
                    <span aria-current="page">{getDisplayCategoryName(openCategory.category)}</span>
                  )}
                </li>
                {openTitle && (
                  <>
                    <li aria-hidden="true"><ChevronRight size={16} /></li>
                    <li aria-current="page" className="min-w-0 wrap-anywhere">{openTitle.title}</li>
                  </>
                )}
              </ol>
          </nav>

          <div className="mb-6 flex items-start gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => navigateDetail(openTitle ? { scope, storeId, category: openCategory.category } : null)}
              aria-label={openTitle ? "타이틀 목록으로 돌아가기" : `${copy.backLabel} 카테고리 목록으로 돌아가기`}
              title={openTitle ? "타이틀 목록으로 돌아가기" : "카테고리 목록으로 돌아가기"}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-(--color-border) bg-(--color-bg-surface) text-(--color-primary) transition-colors hover:bg-(--color-primary-light) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)"
            >
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold text-(--color-text-primary) wrap-anywhere sm:text-3xl">
                {openTitle?.title || getDisplayCategoryName(openCategory.category)}
              </h1>
              <p className="mt-2 text-sm text-(--color-text-secondary)">
                {openTitle ? `세부 매뉴얼 ${openTitle.items.length}개` : `타이틀 ${openCategory.groups.length}개 · 세부 매뉴얼 ${openCategory.itemCount}개`}
              </p>
              {scope === "store" && manualStore && (
                <p className="mt-2 text-sm text-[var(--color-text-secondary)] break-words">{formatStoreDisplayName(manualStore.name)}</p>
              )}
            </div>
          </div>

          <div className="relative mb-6">
            <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-(--color-text-tertiary)" aria-hidden="true" />
            <input
              type="search"
              value={openTitle ? itemSearchQuery : titleSearchQuery}
              onChange={(event) => openTitle ? setItemSearchQuery(event.target.value) : setTitleSearchQuery(event.target.value)}
              placeholder={openTitle ? "세부 매뉴얼 검색" : "타이틀 검색"}
              aria-label={openTitle ? "세부 매뉴얼 검색" : "타이틀 검색"}
              className="h-12 w-full rounded-lg border border-(--color-border) bg-(--color-bg-surface) pl-11 pr-4 text-base text-(--color-text-primary) focus:border-(--color-primary) focus:outline-none focus:ring-2 focus:ring-(--color-primary)/20"
            />
          </div>

          {view === "items" && openTitle ? (
            <section aria-label="세부 매뉴얼" className="space-y-4">
              {visibleItems.map((item, index) => (
                <article
                  key={item.id}
                  id={`sub-manual-${item.id}`}
                  className={`rounded-lg border bg-(--color-bg-surface) p-5 lg:p-6 scroll-mt-24 ${detail?.subId === item.id ? "border-(--color-primary)" : "border-(--color-border)"}`}
                >
                  <h2 className="mb-3 text-base font-semibold text-(--color-text-primary) wrap-anywhere">
                    {scope === "common" ? "세부 매뉴얼" : "매뉴얼"} {index + 1}
                  </h2>
                  <p className="whitespace-pre-wrap wrap-anywhere text-base leading-7 text-(--color-text-primary)">{item.content}</p>
                </article>
              ))}
              {visibleItems.length === 0 && <StateBox>검색 결과가 없습니다.</StateBox>}
            </section>
          ) : (
            <section aria-label="타이틀">
              <ul className={scope === "common" ? "space-y-3" : MANUAL_GRID_CLASS_NAME}>
                {visibleTitles.map((group, index) => (
                  <li key={group.id} className="min-w-0">
                    {scope === "common" ? (
                      <button
                        type="button"
                        onClick={() => navigateDetail({ scope, storeId, category: openCategory.category, titleId: group.id })}
                        className="flex w-full items-center justify-between gap-4 rounded-xl border border-(--color-border) bg-(--color-bg-surface) p-4 text-left transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-light)/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary) lg:p-5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="mb-1 block text-xs font-medium text-(--color-text-secondary)">타이틀 {index + 1}</span>
                          <span className="mb-2 block text-base font-semibold text-(--color-text-primary) wrap-anywhere">{group.title}</span>
                          <span className="block text-xs text-(--color-text-tertiary)">세부 매뉴얼 {group.items.length}개</span>
                        </span>
                        <ChevronRight size={20} className="shrink-0 text-(--color-primary)" aria-hidden="true" />
                      </button>
                    ) : (
                      <ManualNavigationCard
                        scope="store"
                        category={getDisplayCategoryName(openCategory.category)}
                        title={group.title}
                        description={`세부 매뉴얼 ${group.items.length}개`}
                        onClick={() => navigateDetail({ scope, storeId, category: openCategory.category, titleId: group.id })}
                      />
                    )}
                  </li>
                ))}
              </ul>
              {visibleTitles.length === 0 && <StateBox>검색 결과가 없습니다.</StateBox>}
            </section>
          )}
        </div>
      </div>
    );
  }

  // ── 목록 ─────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 lg:p-8">
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
        ) : !manualStore ? (
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
                placeholder="카테고리 검색"
                aria-label="카테고리 검색"
                className="h-12 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] pl-11 pr-4 text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
              />
            </div>

              <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="검색 필터">
                {(["all", "category", "manual"] as const).map((filter) => {
                  const isActive = filterType === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setFilterType(filter)}
                      className={`min-h-[36px] rounded-full border px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                        isActive
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                          : "border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-bg-surface)]/50 hover:text-[var(--color-text-primary)]"
                      }`}
                    >
                      {filter === "all" ? "전체" : filter === "category" ? "카테고리" : "매뉴얼"}
                    </button>
                  );
                })}
              </div>

            <section aria-label="카테고리">
                <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
                  검색 결과 <span className="font-bold text-[var(--color-text-primary)]">{filteredCategories.length + filteredManuals.length}</span>개
                </p>

                {filteredCategories.length === 0 && filteredManuals.length === 0 ? (
                  <StateBox>
                    <FileText size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                    <p className="text-base text-[var(--color-text-secondary)]">검색 결과가 없습니다.</p>
                  </StateBox>
                ) : (
                  <ul className={MANUAL_GRID_CLASS_NAME}>
                    {filteredCategories.map((category) => (
                      <li key={category.category} className="min-w-0">
                        <ManualNavigationCard
                          scope={scope}
                          title={getDisplayCategoryName(category.category)}
                          description={`타이틀 ${category.groups.length}개 · 세부 매뉴얼 ${category.itemCount}개`}
                          onClick={() => {
                            if (!storeId) return;
                            navigateDetail({ scope, storeId, category: category.category });
                          }}
                        />
                      </li>
                    ))}
                    {filteredManuals.map((group) => (
                      <li key={group.id} className="min-w-0">
                        <ManualNavigationCard
                          scope={scope}
                          category={scope === "store" ? getDisplayCategoryName(group.category) : undefined}
                          title={group.title}
                          description={`세부 매뉴얼 ${group.items.length}개`}
                          onClick={() => {
                            if (!storeId) return;
                            navigateDetail({ scope, storeId, category: group.category, titleId: group.id });
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
