"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, BookOpen, FileText, RefreshCw, Search, Store as StoreIcon } from "lucide-react";

import StoreSwitcher from "@/components/common/StoreSwitcher";
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
  /** 하위 세부 매뉴얼이 없으면 자기 자신 1개 */
  items: ManualRecord[];
  hasChildren: boolean;
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
    description: "선택 매장의 업무 매뉴얼을 확인할 수 있습니다.",
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

// 최상위 매뉴얼(타이틀) + 하위 세부 매뉴얼로 묶는다. (HQ/Owner 매뉴얼 화면과 같은 규칙)
function groupByParent(manuals: ManualRecord[]): ManualGroup[] {
  const childrenByParent = new Map<string, ManualRecord[]>();
  for (const manual of manuals) {
    if (!manual.parent_manual_id) continue;
    const list = childrenByParent.get(manual.parent_manual_id) ?? [];
    list.push(manual);
    childrenByParent.set(manual.parent_manual_id, list);
  }

  return manuals
    .filter((manual) => !manual.parent_manual_id)
    .map((parent) => {
      const children = childrenByParent.get(parent.id) ?? [];
      return {
        id: parent.id,
        category: getDisplayCategoryName(parent.category ?? ""),
        title: parent.title,
        items: children.length > 0 ? children : [parent],
        hasChildren: children.length > 0,
      };
    });
}

function matchesSearch(group: ManualGroup, query: string): boolean {
  if (!query) return true;
  const text = [group.category, group.title, ...group.items.flatMap((item) => [item.title, item.content])]
    .join(" ")
    .toLowerCase();
  return text.includes(query);
}

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

export default function StaffManualBrowser({ scope }: { scope: Scope }) {
  const router = useRouter();
  const copy = COPY[scope];
  const { stores, pendingStores, selectedStore, isStoresLoading, storesError, reloadStores, selectStore } = useStaffShell();
  const [result, setResult] = useState<LoadResult | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // 상세 보기: 매장이 바뀌면 자동으로 목록으로 돌아가도록 매장 ID와 함께 기억한다.
  const [detail, setDetail] = useState<{ storeId: string; groupId: string } | null>(null);

  const storeId = selectedStore?.id ?? null;
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
  const groups = currentResult?.status === "ready" ? groupByParent(currentResult.manuals) : [];
  const categories = [...new Set(groups.map((group) => group.category))];
  const normalizedQuery = query.trim().toLowerCase();
  // 매장 전환 등으로 사라진 카테고리가 선택돼 있으면 전체로 본다.
  const effectiveCategory = activeCategory && categories.includes(activeCategory) ? activeCategory : null;
  const visibleGroups = groups.filter(
    (group) => (!effectiveCategory || group.category === effectiveCategory) && matchesSearch(group, normalizedQuery),
  );
  const openGroup = detail && detail.storeId === storeId ? groups.find((group) => group.id === detail.groupId) ?? null : null;

  const handleSelectStore = (nextStoreId: string) => {
    if (selectStore(nextStoreId)) {
      setActiveCategory(null);
      setDetail(null);
    }
  };

  // ── 상세 ─────────────────────────────────────────
  if (openGroup) {
    return (
      <div className="p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="-ml-2 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {copy.backLabel}
          </button>

          <div className="mb-6">
            <span className="mb-3 inline-flex rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
              {openGroup.category}
            </span>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] break-keep">{openGroup.title}</h1>
            {scope === "store" && selectedStore && (
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{formatStoreDisplayName(selectedStore.name)}</p>
            )}
          </div>

          <div className="space-y-4">
            {openGroup.items.map((item, index) => (
              <article key={item.id} className="rounded-xl border border-[var(--color-border)] bg-white p-5 lg:p-6">
                {openGroup.hasChildren && (
                  <h2 className="mb-2 text-base font-semibold text-[var(--color-text-primary)] break-keep">
                    {item.title && item.title !== openGroup.title ? item.title : `세부 매뉴얼 ${index + 1}`}
                  </h2>
                )}
                <p className="whitespace-pre-wrap break-words text-base leading-7 text-[var(--color-text-primary)]">{item.content}</p>
              </article>
            ))}
          </div>
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
          {scope === "common" && selectedStore && (
            <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
              선택 매장({formatStoreDisplayName(selectedStore.name)})의 브랜드 공통 매뉴얼입니다.
            </p>
          )}
        </div>

        {/* 지점 매뉴얼: 어떤 매장 기준인지 + 승인 매장 간 빠른 전환 (AI 챗봇과 같은 선택 매장) */}
        {scope === "store" && stores.length > 0 && (
          <div className="mb-6 w-full max-w-sm">
            <p className="mb-1.5 text-sm font-medium text-[var(--color-text-secondary)]">선택 매장</p>
            <StoreSwitcher
              compact
              label="선택 매장"
              manageLabel="근무 매장 관리"
              stores={stores}
              pendingCount={pendingStores.length}
              selectedStoreId={storeId}
              isLoading={isStoresLoading}
              onSelect={handleSelectStore}
              onManageStores={() => router.push("/staff/stores")}
            />
          </div>
        )}

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
            {/* 검색 (제목·카테고리·본문) */}
            <div className="relative mb-4">
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
                className="h-12 w-full rounded-lg border border-[var(--color-border)] bg-white pl-11 pr-4 text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
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
                          ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]"
                          : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-text-primary)]"
                      }`}
                    >
                      {category ?? "전체"}
                    </button>
                  );
                })}
              </div>
            )}

            <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
              매뉴얼 <span className="font-bold text-[var(--color-text-primary)]">{visibleGroups.length}</span>개
            </p>

            {visibleGroups.length === 0 ? (
              <StateBox>
                <FileText size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                <p className="text-base text-[var(--color-text-secondary)]">검색 결과가 없습니다.</p>
              </StateBox>
            ) : (
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleGroups.map((group) => (
                  <li key={group.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (!storeId) return;
                        setDetail({ storeId, groupId: group.id });
                        document.querySelector("main")?.scrollTo({ top: 0 });
                      }}
                      className="flex h-full w-full flex-col items-start rounded-xl border border-[var(--color-border)] bg-white p-5 text-left transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                    >
                      <span className="mb-3 inline-flex max-w-full truncate rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
                        {group.category}
                      </span>
                      <span className="w-full text-base font-semibold text-[var(--color-text-primary)] break-keep line-clamp-2">
                        {group.title}
                      </span>
                      <span className="mt-1.5 w-full text-sm text-[var(--color-text-secondary)] line-clamp-2 break-words">
                        {group.items[0]?.content}
                      </span>
                      <span className="mt-auto pt-3 text-xs text-[var(--color-text-tertiary)]">세부 매뉴얼 {group.items.length}개</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
