"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, FileText, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedProfile } from "@/lib/auth/client-profile";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import type { ManualRecord } from "@/lib/types/manual";
import { resolveOwnerCurrentStore } from "@/lib/owner/current-store";

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

type ManualView = "categories" | "titles" | "items";

const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_ID_LIKE_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

const cardButtonClass =
  "flex h-full w-full flex-col items-start rounded-xl border border-[var(--color-border)] bg-white p-5 text-left transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]";
const badgeClass =
  "mb-3 inline-flex max-w-full truncate rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]";
const stateBoxClass = "rounded-xl border border-[var(--color-border)] bg-white p-8 text-center";
const backButtonClass =
  "-ml-2 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]";

function SearchField({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div className="mb-6 relative">
      <Search
        size={18}
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        className="h-12 w-full rounded-lg border border-[var(--color-border)] bg-white pl-11 pr-4 text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
      />
    </div>
  );
}

function getManualCategory(manual: ManualRecord): string {
  return manual.category?.trim() || "미분류";
}

function getDisplayCategoryName(category: string | null | undefined): string {
  const trimmed = category?.trim();
  if (!trimmed || UUID_LIKE_PATTERN.test(trimmed) || INTERNAL_ID_LIKE_PATTERN.test(trimmed)) {
    return "카테고리";
  }
  return trimmed;
}

// 최상위 매뉴얼(타이틀)과 그 하위 항목(세부 매뉴얼)으로 그룹화한다. (HQ 대시보드와 동일한 규칙, 조회 전용)
function groupByParent(manuals: ManualRecord[]): ManualGroup[] {
  const topLevel = manuals.filter((manual) => !manual.parent_manual_id);
  const childrenByParent = new Map<string, ManualRecord[]>();

  for (const manual of manuals) {
    if (!manual.parent_manual_id) continue;
    const list = childrenByParent.get(manual.parent_manual_id) ?? [];
    list.push(manual);
    childrenByParent.set(manual.parent_manual_id, list);
  }

  return topLevel.map((parent) => {
    const children = childrenByParent.get(parent.id) ?? [];
    return {
      id: parent.id,
      category: getManualCategory(parent),
      title: parent.title,
      items: children.length > 0 ? children : [parent],
    };
  });
}

function groupByCategory(groups: ManualGroup[]): ManualCategory[] {
  const categories = new Map<string, ManualGroup[]>();

  for (const group of groups) {
    const list = categories.get(group.category) ?? [];
    list.push(group);
    categories.set(group.category, list);
  }

  return Array.from(categories.entries()).map(([category, categoryGroups]) => ({
    category,
    groups: categoryGroups,
    itemCount: categoryGroups.reduce((count, group) => count + group.items.length, 0),
  }));
}

export default function OwnerManualsPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [userName, setUserName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [manuals, setManuals] = useState<ManualRecord[]>([]);
  const [isLoadingManuals, setIsLoadingManuals] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<ManualView>("categories");
  const [searchQuery, setSearchQuery] = useState("");
  const [titleSearchQuery, setTitleSearchQuery] = useState("");
  const [itemSearchQuery, setItemSearchQuery] = useState("");
  const [selectedCategoryName, setSelectedCategoryName] = useState<string | null>(null);
  const [selectedTitleId, setSelectedTitleId] = useState<string | null>(null);

  // Auth 확인 (점주 + 승인 완료 계정만 접근 가능)
  useLayoutEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const profile = await getAuthenticatedProfile(supabase);

        if (profile?.role !== "owner") {
          router.push("/");
          return;
        }
        if (profile.approvalStatus !== "approved") {
          router.push("/signup/approval-status");
          return;
        }

        const storeResolution = await resolveOwnerCurrentStore();
        if (storeResolution.status !== "ready") {
          setError("운영 매장 정보를 확인하지 못했습니다.");
          setIsLoadingManuals(false);
          setIsReady(true);
          return;
        }
        if (!storeResolution.current) {
          setError("승인된 운영 매장이 없습니다.");
          setIsLoadingManuals(false);
          setIsReady(true);
          return;
        }

        setSelectedStoreId(storeResolution.current.storeId);
        setStoreName(storeResolution.current.storeName);

        setIsReady(true);
      } catch (e) {
        console.error("Auth check failed:", e);
        router.push("/");
      }
    };

    checkAuth();
  }, [router]);

  // 사용자 정보 로드
  useEffect(() => {
    const setUserInfo = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) return;

        const name = data.session.user.user_metadata?.name || "점주";
        setUserName(name);

        // sessionStorage에서 선택된 지점 정보 가져오기
        const storedStoreName = sessionStorage.getItem("selectedStoreName") || "선택된 지점";
        setStoreName(storedStoreName);
      } catch (e) {
        console.error("Failed to set user info:", e);
      }
    };

    setUserInfo();
  }, []);

  // 현재 선택된 점주 매장의 franchise에 해당하는 본사 공통 매뉴얼만 조회한다.
  useEffect(() => {
    if (!isReady || !selectedStoreId) return;

    const fetchManuals = async () => {
      setIsLoadingManuals(true);
      setError("");
      try {
        const response = await fetch(`/api/manuals?storeId=${encodeURIComponent(selectedStoreId)}`);
        const data = (await response.json()) as { manuals?: ManualRecord[]; error?: string };

        if (!response.ok || !data.manuals) {
          throw new Error(data.error || "매뉴얼 목록을 불러오지 못했습니다.");
        }

        setManuals(data.manuals);
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : "매뉴얼 목록을 불러오지 못했습니다.";
        setError(errorMsg);
        console.error("Failed to fetch manuals:", e);
      } finally {
        setIsLoadingManuals(false);
      }
    };

    void fetchManuals();
  }, [isReady, selectedStoreId]);

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  const groups = groupByParent(manuals);
  const categories = groupByCategory(groups);
  const selectedCategory = selectedCategoryName
    ? categories.find((category) => category.category === selectedCategoryName) ?? null
    : null;
  const selectedTitle = selectedTitleId
    ? selectedCategory?.groups.find((group) => group.id === selectedTitleId) ?? null
    : null;

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleCategories = normalizedSearch
    ? categories.filter((category) => {
        const categoryText = getDisplayCategoryName(category.category).toLowerCase();
        const groupText = category.groups
          .flatMap((group) => [group.title, ...group.items.map((item) => item.content)])
          .join(" ")
          .toLowerCase();
        return categoryText.includes(normalizedSearch) || groupText.includes(normalizedSearch);
      })
    : categories;

  const normalizedTitleSearch = titleSearchQuery.trim().toLowerCase();
  const visibleTitleGroups = selectedCategory
    ? normalizedTitleSearch
      ? selectedCategory.groups.filter((group) => {
          const groupText = [group.title, ...group.items.map((item) => item.content)].join(" ").toLowerCase();
          return groupText.includes(normalizedTitleSearch);
        })
      : selectedCategory.groups
    : [];

  const normalizedItemSearch = itemSearchQuery.trim().toLowerCase();
  const visibleManualItems = selectedTitle
    ? normalizedItemSearch
      ? selectedTitle.items.filter((item) => item.content.toLowerCase().includes(normalizedItemSearch))
      : selectedTitle.items
    : [];

  if (!isReady) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <OwnerSidebar activeMenu="manual-common" onLogout={handleLogout} />

      <div className="lg:ml-[240px]">
        <OwnerHeader userName={userName} storeName={storeName} onLogout={handleLogout} />

        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
              공통 매뉴얼 관리
            </h1>
            <p className="text-base text-[var(--color-text-secondary)]">
              본사에서 배포한 카테고리 → 타이틀 → 세부 매뉴얼 순서로 확인할 수 있습니다. (조회 전용)
            </p>
          </div>

          {error && !isLoadingManuals && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {isLoadingManuals ? (
            <div className={stateBoxClass}>
              <p className="text-base text-[var(--color-text-secondary)]" role="status">매뉴얼을 불러오는 중...</p>
            </div>
          ) : view === "categories" ? (
            <section aria-label="카테고리">
              <SearchField value={searchQuery} onChange={setSearchQuery} label="카테고리 검색" />

              {!error && (
                <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
                  카테고리 <span className="font-bold text-[var(--color-text-primary)]">{categories.length}</span>개 · 타이틀{" "}
                  <span className="font-bold text-[var(--color-text-primary)]">{groups.length}</span>개
                </p>
              )}

              {visibleCategories.length === 0 ? (
                <div className={stateBoxClass}>
                  <BookOpen size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                  <p className="text-base font-semibold text-[var(--color-text-primary)]">
                    {categories.length === 0 ? "등록된 공통 매뉴얼이 없습니다." : "검색 결과가 없습니다."}
                  </p>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    본사에서 매뉴얼을 배포하면 이곳에서 확인할 수 있습니다.
                  </p>
                </div>
              ) : (
                <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visibleCategories.map((category) => (
                    <li key={category.category} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCategoryName(category.category);
                          setSelectedTitleId(null);
                          setTitleSearchQuery("");
                          setView("titles");
                        }}
                        className={cardButtonClass}
                      >
                        <span className={badgeClass}>카테고리</span>
                        <span className="w-full text-base font-semibold text-[var(--color-text-primary)] break-keep line-clamp-2">
                          {getDisplayCategoryName(category.category)}
                        </span>
                        <span className="mt-auto pt-3 text-xs text-[var(--color-text-tertiary)]">
                          타이틀 {category.groups.length}개 · 세부 매뉴얼 {category.itemCount}개
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : view === "titles" ? (
            <section aria-label="타이틀">
              <button
                type="button"
                onClick={() => {
                  setTitleSearchQuery("");
                  setView("categories");
                }}
                className={backButtonClass}
              >
                <ArrowLeft size={16} aria-hidden="true" /> 카테고리 목록
              </button>
              {selectedCategory && (
                <h2 className="mb-4 text-lg font-bold text-[var(--color-text-primary)] break-keep">
                  {getDisplayCategoryName(selectedCategory.category)}
                </h2>
              )}
              <SearchField value={titleSearchQuery} onChange={setTitleSearchQuery} label="타이틀 검색" />

              {!selectedCategory || visibleTitleGroups.length === 0 ? (
                <div className={stateBoxClass}>
                  <FileText size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                  <p className="text-base text-[var(--color-text-secondary)]">검색 결과가 없습니다.</p>
                </div>
              ) : (
                <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visibleTitleGroups.map((group) => (
                    <li key={group.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTitleId(group.id);
                          setItemSearchQuery("");
                          setView("items");
                        }}
                        className={cardButtonClass}
                      >
                        <span className={badgeClass}>{getDisplayCategoryName(group.category)}</span>
                        <span className="w-full text-base font-semibold text-[var(--color-text-primary)] break-keep line-clamp-2">{group.title}</span>
                        <span className="mt-auto pt-3 text-xs text-[var(--color-text-tertiary)]">세부 매뉴얼 {group.items.length}개</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <section aria-label="세부 매뉴얼">
              <button
                type="button"
                onClick={() => {
                  setItemSearchQuery("");
                  setView("titles");
                }}
                className={backButtonClass}
              >
                <ArrowLeft size={16} aria-hidden="true" /> 타이틀 목록
              </button>
              {selectedTitle && (
                <div className="mb-4">
                  <span className={badgeClass}>{getDisplayCategoryName(selectedTitle.category)}</span>
                  <h2 className="text-lg font-bold text-[var(--color-text-primary)] break-keep">{selectedTitle.title}</h2>
                </div>
              )}
              <SearchField value={itemSearchQuery} onChange={setItemSearchQuery} label="세부 매뉴얼 검색" />

              {selectedTitle ? (
                <div className="space-y-4">
                  {visibleManualItems.map((item, index) => (
                    <article
                      key={item.id}
                      className="rounded-xl border border-[var(--color-border)] bg-white p-5 lg:p-6"
                    >
                      <h3 className="mb-2 text-base font-semibold text-[var(--color-text-primary)]">세부 매뉴얼 {index + 1}</h3>
                      <p className="whitespace-pre-wrap break-words text-base leading-7 text-[var(--color-text-primary)]">
                        {item.content}
                      </p>
                    </article>
                  ))}
                  {visibleManualItems.length === 0 && (
                    <div className={stateBoxClass}>
                      <FileText size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                      <p className="text-base text-[var(--color-text-secondary)]">검색 결과가 없습니다.</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className={stateBoxClass}>
                  <p className="text-base text-[var(--color-text-secondary)]">타이틀을 선택하면 세부 매뉴얼이 표시됩니다.</p>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
