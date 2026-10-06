"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ChevronRight, CircleAlert, CircleCheck, Loader2, Search, Store, Users, X } from "lucide-react";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import BackToHomeLink from "@/components/hq/BackToHomeLink";
import { createClient } from "@/lib/supabase/client";
import type { HqStoreSummary } from "@/lib/types/store";

type OwnerFilter = "all" | "registered" | "unregistered";

const FILTER_OPTIONS: { value: OwnerFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "registered", label: "점주 등록" },
  { value: "unregistered", label: "점주 미등록" },
];

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("ko-KR");
}

function OwnerStatusBadge({ hasOwner }: { hasOwner: boolean }) {
  return hasOwner ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary-light)]/40 px-3 py-1 text-sm font-medium text-[var(--color-primary)]">
      <CircleCheck size={16} aria-hidden="true" />
      점주 등록
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
      <CircleAlert size={16} aria-hidden="true" />
      점주 미등록
    </span>
  );
}

interface StoreMember {
  id: string;
  userId: string;
  role: "owner" | "staff";
  status: string;
  requestedAt: string;
  approvedAt: string | null;
  name: string;
  email: string | null;
}

// 홈 "점주 미등록 지점" 카드에서 진입하는 업무 화면 모드. 지점 현황의 "점주 미등록" 필터와 같은 기준이다.
const NO_OWNER_VIEW = "no-owner";

export default function HqStoresPage() {
  return (
    <Suspense fallback={null}>
      <HqStoresContent />
    </Suspense>
  );
}

function HqStoresContent() {
  const router = useRouter();
  const isNoOwnerView = useSearchParams().get("view") === NO_OWNER_VIEW;
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("메가MGC커피");
  const [stores, setStores] = useState<HqStoreSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedStore, setSelectedStore] = useState<HqStoreSummary | null>(null);
  const [storeMembers, setStoreMembers] = useState<StoreMember[]>([]);
  const [isMembersLoading, setIsMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");

  useEffect(() => {
    const loadPage = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const user = data.session?.user;
        if (user?.user_metadata?.name) {
          setUserName(user.user_metadata.name);
          const firstName = user.user_metadata.name.split(" ")[0];
          if (firstName) setFranchiseName(firstName);
        }

        const response = await fetch("/api/hq/stores");
        const result = (await response.json()) as { stores?: HqStoreSummary[]; error?: string };
        if (!response.ok) {
          throw new Error(result.error || "지점 목록을 불러오지 못했습니다.");
        }

        setStores(result.stores ?? []);
      } catch (error) {
        console.error("Failed to load HQ stores:", error);
        setErrorMessage(error instanceof Error ? error.message : "지점 목록을 불러오지 못했습니다.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadPage();
  }, []);

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      router.push("/");
    }
  };

  const handleOpenMembers = async (store: HqStoreSummary) => {
    setSelectedStore(store);
    setStoreMembers([]);
    setMembersError("");
    setIsMembersLoading(true);

    try {
      const response = await fetch(`/api/hq/stores/${encodeURIComponent(store.id)}/members`);
      const data = (await response.json()) as { members?: StoreMember[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "지점 소속 사용자를 불러오지 못했습니다.");
      }
      setStoreMembers(data.members ?? []);
    } catch (error) {
      setMembersError(error instanceof Error ? error.message : "지점 소속 사용자를 불러오지 못했습니다.");
    } finally {
      setIsMembersLoading(false);
    }
  };

  const stats = useMemo(
    () => ({
      totalStores: stores.length,
      storesWithOwner: stores.filter((store) => store.ownerNames.length > 0).length,
      totalOwners: stores.reduce((sum, store) => sum + store.ownerNames.length, 0),
    }),
    [stores],
  );

  const filteredStores = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (isNoOwnerView) {
      return stores.filter((store) => store.ownerNames.length === 0);
    }
    return stores.filter((store) => {
      if (query && !store.name.toLowerCase().includes(query)) return false;
      if (ownerFilter === "registered") return store.ownerNames.length > 0;
      if (ownerFilter === "unregistered") return store.ownerNames.length === 0;
      return true;
    });
  }, [stores, searchQuery, ownerFilter, isNoOwnerView]);

  const statCards = [
    { label: "전체 지점", value: `${stats.totalStores}개` },
    { label: "점주 등록 지점", value: `${stats.storesWithOwner}개` },
    { label: "등록된 점주", value: `${stats.totalOwners}명` },
  ];

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <HQSidebar
        userName={userName}
        franchiseName={franchiseName}
        onLogout={handleLogout}
        activeMenu={isNoOwnerView ? "home" : "store-status"}
      />

      <div className="lg:ml-[240px]">
        <HQHeader userName={userName} franchiseName={franchiseName} onLogout={handleLogout} />

        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {isNoOwnerView ? (
            <>
              <BackToHomeLink />
              <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">점주 미등록 지점</h1>
                  <p className="text-base text-[var(--color-text-secondary)]">
                    담당 점주가 등록되지 않은 지점을 확인합니다.
                  </p>
                </div>
                <Link
                  href="/hq/stores"
                  className="inline-flex min-h-[44px] items-center gap-1 self-start rounded-lg px-2 text-sm font-medium text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:self-auto"
                >
                  전체 지점 보기 <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
            </>
          ) : (
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">지점 관리</h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                등록된 지점과 점주 현황을 확인하고 관리할 수 있습니다.
              </p>
            </div>
          )}

          {isLoading ? (
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-8 shadow-sm text-center">
              <p className="text-base text-[var(--color-text-secondary)]" role="status">
                지점 목록을 불러오는 중...
              </p>
            </div>
          ) : errorMessage ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-base text-red-700" role="alert">
              {errorMessage}
            </div>
          ) : (
            <>
              {/* Stats Cards */}
              <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 ${isNoOwnerView ? "hidden" : ""}`}>
                {statCards.map((card) => (
                  <div key={card.label} className="bg-white border border-[var(--color-border)] rounded-lg p-4 shadow-sm">
                    <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">{card.label}</p>
                    <p className="text-xl font-bold text-[var(--color-text-primary)]">{card.value}</p>
                  </div>
                ))}
              </div>

              {isNoOwnerView && filteredStores.length === 0 ? (
                <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                  <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                    <Store size={32} className="text-amber-600" aria-hidden="true" />
                  </div>
                  <p className="text-base text-[var(--color-text-secondary)]">점주가 미등록된 지점이 없습니다.</p>
                </div>
              ) : stores.length === 0 ? (
                <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                  <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                    <Store size={32} className="text-amber-600" aria-hidden="true" />
                  </div>
                  <p className="text-base text-[var(--color-text-secondary)]">등록된 지점이 없습니다.</p>
                </div>
              ) : (
                <>
                  {/* Toolbar */}
                  <div className={`mb-6 flex flex-col gap-3 md:flex-row md:items-center ${isNoOwnerView ? "hidden" : ""}`}>
                    <div className="relative flex-1 min-w-0">
                      <Search
                        size={18}
                        aria-hidden="true"
                        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                      />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="지점명으로 검색"
                        aria-label="지점명으로 검색"
                        className="min-h-[44px] w-full rounded-lg border-2 border-[var(--color-border)] bg-white py-2.5 pl-11 pr-4 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30"
                      />
                    </div>

                    <div role="group" aria-label="점주 등록 상태 필터" className="flex flex-wrap gap-2 shrink-0">
                      {FILTER_OPTIONS.map((option) => {
                        const isSelected = ownerFilter === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => setOwnerFilter(option.value)}
                            className={`min-h-[44px] rounded-lg border-2 px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ${
                              isSelected
                                ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/30 text-[var(--color-primary)]"
                                : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {filteredStores.length === 0 ? (
                    <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                      <Search size={28} className="mx-auto mb-3 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                      <p className="text-base text-[var(--color-text-secondary)]">검색 결과가 없습니다.</p>
                    </div>
                  ) : (
                    <>
                      {/* Desktop Table */}
                      <div className="hidden md:block bg-white border border-[var(--color-border)] rounded-xl shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <caption className="sr-only">지점 목록</caption>
                            <thead className="bg-[var(--color-bg-default)] border-b border-[var(--color-border)]">
                              <tr>
                                <th scope="col" className="px-6 py-3 text-left text-sm font-bold text-[var(--color-text-primary)]">지점명</th>
                                <th scope="col" className="px-6 py-3 text-left text-sm font-bold text-[var(--color-text-primary)]">상태</th>
                                <th scope="col" className="px-6 py-3 text-left text-sm font-bold text-[var(--color-text-primary)]">점주</th>
                                <th scope="col" className="px-6 py-3 text-right text-sm font-bold text-[var(--color-text-primary)]">직원</th>
                                <th scope="col" className="px-6 py-3 text-center text-sm font-bold text-[var(--color-text-primary)]">관리</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredStores.map((store) => (
                                <tr
                                  key={store.id}
                                  className="border-t border-[var(--color-border)] hover:bg-[var(--color-bg-default)] transition-colors"
                                >
                                  <td className="px-6 py-4 text-base font-medium text-[var(--color-text-primary)]">{store.name}</td>
                                  <td className="px-6 py-4">
                                    <OwnerStatusBadge hasOwner={store.ownerNames.length > 0} />
                                  </td>
                                  <td className="px-6 py-4 text-base text-[var(--color-text-primary)]">
                                    {store.ownerNames.length > 0 ? (
                                      store.ownerNames.join(", ")
                                    ) : (
                                      <span className="text-[var(--color-text-secondary)]">미지정</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 text-base text-right text-[var(--color-text-secondary)]">{store.staffCount}명</td>
                                  <td className="px-6 py-4 text-center">
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => void handleOpenMembers(store)}
                                        aria-label={`${store.name} 소속 사용자 보기`}
                                        className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-default)] hover:text-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                                      >
                                        <Users size={16} aria-hidden="true" /> 보기
                                      </button>
                                      <Link
                                        href={`/hq/stores/${store.id}`}
                                        aria-label={`${store.name} 상세 보기`}
                                        className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                                      >
                                        <ChevronRight size={16} aria-hidden="true" />
                                      </Link>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Mobile Cards */}
                      <ul className="md:hidden space-y-3" aria-label="지점 목록">
                        {filteredStores.map((store) => (
                          <li key={store.id}>
                            <Link
                              href={`/hq/stores/${store.id}`}
                              aria-label={`${store.name} 상세 보기`}
                              className="block bg-white border border-[var(--color-border)] rounded-lg p-4 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                            >
                              <div className="mb-2 flex items-start justify-between gap-3">
                                <p className="text-base font-bold text-[var(--color-text-primary)]">{store.name}</p>
                                <ChevronRight size={20} className="mt-0.5 shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                              </div>
                              <div className="mb-3">
                                <OwnerStatusBadge hasOwner={store.ownerNames.length > 0} />
                              </div>
                              <dl className="grid grid-cols-2 gap-3 text-xs">
                                <div>
                                  <dt className="text-[var(--color-text-secondary)]">점주</dt>
                                  <dd className="font-medium text-[var(--color-text-primary)]">
                                    {store.ownerNames.length > 0 ? store.ownerNames.join(", ") : "미지정"}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-[var(--color-text-secondary)]">직원</dt>
                                  <dd className="font-medium text-[var(--color-text-primary)]">{store.staffCount}명</dd>
                                </div>
                              </dl>
                            </Link>
                            <button
                              type="button"
                              onClick={() => void handleOpenMembers(store)}
                              aria-label={`${store.name} 소속 사용자 보기`}
                              className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm font-medium text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                            >
                              <Users size={16} aria-hidden="true" /> 소속 사용자
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>

      {selectedStore && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="store-members-dialog-title"
          onClick={() => setSelectedStore(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="mb-1 text-sm text-[var(--color-text-secondary)]">지점 소속 사용자</p>
                <h2 id="store-members-dialog-title" className="text-xl font-bold text-[var(--color-text-primary)]">
                  {selectedStore.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStore(null)}
                aria-label="지점 소속 사용자 모달 닫기"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-default)]"
              >
                <X size={20} />
              </button>
            </div>

            {isMembersLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--color-text-secondary)]">
                <Loader2 size={18} className="animate-spin" /> 소속 사용자를 불러오는 중...
              </div>
            ) : membersError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{membersError}</div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                {(["owner", "staff"] as const).map((role) => {
                  const members = storeMembers.filter((member) => member.role === role);
                  return (
                    <section key={role}>
                      <h3 className="mb-3 text-base font-bold text-[var(--color-text-primary)]">
                        {role === "owner" ? "지점 소속 사장" : "지점 소속 알바"}
                        <span className="ml-2 text-sm font-medium text-[var(--color-text-secondary)]">{members.length}명</span>
                      </h3>
                      {members.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-5 text-center text-sm text-[var(--color-text-secondary)]">
                          {role === "owner" ? "등록된 사장이 없습니다." : "등록된 알바가 없습니다."}
                        </div>
                      ) : (
                        <ul className="space-y-2">
                          {members.map((member) => (
                            <li key={member.id} className="rounded-lg border border-[var(--color-border)] p-3">
                              <p className="font-semibold text-[var(--color-text-primary)]">{member.name}</p>
                              <p className="mt-1 break-all text-sm text-[var(--color-text-secondary)]">
                                {member.email || "이메일 미등록"}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
