"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedProfile } from "@/lib/auth/client-profile";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import { Input } from "@/components/common/Input";
import type { ManualRecord } from "@/lib/types/manual";

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

  // 매뉴얼 조회 - /api/manuals는 owner role일 때 이미 storeId=null(본사 공통 매뉴얼)만,
  // 로그인 계정의 franchise_id(또는 legacy brand_name)로 스코핑해서 내려준다.
  useEffect(() => {
    if (!isReady) return;

    const fetchManuals = async () => {
      setIsLoadingManuals(true);
      setError("");
      try {
        const response = await fetch("/api/manuals");
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
  }, [isReady]);

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
        <OwnerHeader userName={userName} storeName={storeName} />

        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
              공통 매뉴얼
            </h1>
            <p className="text-base text-[var(--color-text-secondary)]">
              본사에서 배포한 카테고리 → 타이틀 → 세부 매뉴얼 순서로 확인할 수 있습니다. (조회 전용)
            </p>
          </div>

          {error && !isLoadingManuals && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {isLoadingManuals ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-8 h-8 border-3 border-[var(--color-border)] border-t-[var(--color-primary)] rounded-full animate-spin" />
              <p className="mt-4 text-[var(--color-text-secondary)]">매뉴얼 로딩 중...</p>
            </div>
          ) : view === "categories" ? (
            <section>
              <div className="mb-6 w-full lg:max-w-md">
                <Input
                  label="검색"
                  placeholder="카테고리 검색하기"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>

              {!error && (
                <div className="mb-4 text-sm text-[var(--color-text-secondary)]">
                  카테고리 <span className="font-bold text-[var(--color-text-primary)]">{categories.length}</span>개 · 타이틀{" "}
                  <span className="font-bold text-[var(--color-text-primary)]">{groups.length}</span>개
                </div>
              )}

              {visibleCategories.length === 0 ? (
                <div className="rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-12 text-center shadow-md">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-primary-light)]">
                    <BookOpen size={32} className="text-[var(--color-primary)]" />
                  </div>
                  <p className="mb-2 text-base text-[var(--color-text-secondary)]">
                    {categories.length === 0 ? "등록된 공통 매뉴얼이 없습니다." : "검색 결과가 없습니다."}
                  </p>
                  <p className="text-sm text-[var(--color-text-tertiary)]">
                    본사에서 매뉴얼을 배포하면 이곳에서 확인할 수 있습니다.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visibleCategories.map((category, index) => (
                    <button
                      key={category.category}
                      type="button"
                      onClick={() => {
                        setSelectedCategoryName(category.category);
                        setSelectedTitleId(null);
                        setTitleSearchQuery("");
                        setView("titles");
                      }}
                      className="rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 text-left shadow-md transition-all hover:border-[var(--color-primary)] hover:bg-white hover:shadow-lg"
                    >
                      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-sm font-bold text-[var(--color-primary)]">
                        {index + 1}
                      </div>
                      <p className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">
                        {getDisplayCategoryName(category.category)}
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        타이틀 {category.groups.length}개 · 세부 매뉴얼 {category.itemCount}개
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ) : view === "titles" ? (
            <section>
              <div className="mb-6 w-full lg:max-w-md">
                <Input
                  label="검색"
                  placeholder="타이틀 검색하기"
                  value={titleSearchQuery}
                  onChange={(event) => setTitleSearchQuery(event.target.value)}
                />
              </div>

              {!selectedCategory || visibleTitleGroups.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] p-12 text-center text-sm text-[var(--color-text-secondary)] shadow-sm">
                  검색 결과가 없습니다.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visibleTitleGroups.map((group, index) => (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => {
                        setSelectedTitleId(group.id);
                        setItemSearchQuery("");
                        setView("items");
                      }}
                      className="rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 text-left shadow-md transition-all hover:border-[var(--color-primary)] hover:bg-white hover:shadow-lg"
                    >
                      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-sm font-bold text-[var(--color-primary)]">
                        {index + 1}
                      </div>
                      <p className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">{group.title}</p>
                      <p className="text-sm text-[var(--color-text-secondary)]">세부 매뉴얼 {group.items.length}개</p>
                    </button>
                  ))}
                </div>
              )}

              <div className="fixed bottom-6 right-6 z-40 rounded-full border border-[var(--color-border)] bg-white p-2 shadow-lg lg:right-8">
                <button
                  type="button"
                  onClick={() => {
                    setTitleSearchQuery("");
                    setView("categories");
                  }}
                  className="rounded-full bg-[var(--color-primary)] px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[var(--color-primary-hover)]"
                >
                  ← 카테고리 목록
                </button>
              </div>
            </section>
          ) : (
            <section>
              <div className="mb-6 w-full lg:max-w-md">
                <Input
                  label="검색"
                  placeholder="매뉴얼 검색하기"
                  value={itemSearchQuery}
                  onChange={(event) => setItemSearchQuery(event.target.value)}
                />
              </div>

              {selectedTitle ? (
                <div className="space-y-4">
                  {visibleManualItems.map((item, index) => (
                    <article
                      key={item.id}
                      className="rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5 shadow-md"
                    >
                      <div className="mb-3 flex items-center gap-3">
                        <p className="text-sm font-bold text-[var(--color-primary)]">매뉴얼 {index + 1}</p>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-primary)]">
                        {item.content}
                      </p>
                    </article>
                  ))}
                  {visibleManualItems.length === 0 && (
                    <div className="rounded-xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] p-12 text-center text-sm text-[var(--color-text-secondary)] shadow-sm">
                      <FileText size={32} className="mx-auto mb-3 text-[var(--color-border)]" />
                      검색 결과가 없습니다.
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] p-12 text-center text-sm text-[var(--color-text-secondary)] shadow-sm">
                  타이틀을 선택하면 세부 매뉴얼이 표시됩니다.
                </div>
              )}

              <div className="fixed bottom-6 right-6 z-40 rounded-full border border-[var(--color-border)] bg-white p-2 shadow-lg lg:right-8">
                <button
                  type="button"
                  onClick={() => {
                    setItemSearchQuery("");
                    setView("titles");
                  }}
                  className="rounded-full bg-[var(--color-primary)] px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[var(--color-primary-hover)]"
                >
                  ← 타이틀 목록
                </button>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
