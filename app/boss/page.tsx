"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronRight, Megaphone, RefreshCw, Store, UserCheck, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import { resolveOwnerCurrentStore } from "@/lib/owner/current-store";

interface StaffMember {
  membershipId: string;
  name: string;
  email: string;
  requestedAt: string;
  approvedAt?: string;
}

interface StoreManual {
  id: string;
  title: string | null;
  category: string | null;
  created_at: string;
  updated_at: string | null;
}

interface StoreNotice {
  id: string;
  title: string;
  createdAt: string;
}

interface StoreOverview {
  pendingStaff: StaffMember[];
  approvedStaff: StaffMember[];
  manuals: StoreManual[];
  notices: StoreNotice[];
  /** 조회 시점 기준 최근 RECENT_DAYS일 안에 받은 본사 공지 수 */
  recentNoticeCount: number;
}

type OverviewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: StoreOverview };

interface Activity {
  key: string;
  kind: string;
  title: string;
  detail: string;
  at: string;
  href: string;
  Icon: typeof UserPlus;
}

// 매장이 연결되지 않았을 때도 대시보드 구조를 유지하기 위한 "데이터 없음" 상태
const EMPTY_OVERVIEW: StoreOverview = {
  pendingStaff: [],
  approvedStaff: [],
  manuals: [],
  notices: [],
  recentNoticeCount: 0,
};

const EMPLOYEES_HREF = "/boss/employees";
const NOTICES_HREF = "/boss/notices";
const PENDING_STAFF_HREF = "/boss/employees#pending-staff";
const STORE_MANUALS_HREF = "/boss/store-manuals";
const RECENT_DAYS = 7;
const MAX_ACTIVITIES = 3;

const cardClass = "bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm";
const linkCardClass =
  "transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2";

function manualUpdatedAt(manual: StoreManual): string {
  return manual.updated_at || manual.created_at;
}

function formatRelative(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return "방금 전";
  if (diffMinutes < 60) return `${diffMinutes}분 전`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;
  if (diffHours < 48) return "어제";
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

// 직원 관리·지점 매뉴얼 화면과 같은 API로 선택 매장의 현황을 읽는다.
async function fetchStoreOverview(storeId: string): Promise<OverviewState> {
  try {
    const query = `storeId=${encodeURIComponent(storeId)}`;
    const [employeesResponse, manualsResponse, noticesResponse] = await Promise.all([
      fetch(`/api/boss/employees?${query}`, { credentials: "include" }),
      fetch(`/api/store-manuals?${query}`, { credentials: "include" }),
      fetch(`/api/boss/notices?${query}`, { credentials: "include" }),
    ]);
    const employees = (await employeesResponse.json()) as {
      success?: boolean;
      data?: { pending: StaffMember[]; approved: StaffMember[] };
    };
    const manuals = (await manualsResponse.json()) as { manuals?: StoreManual[] };
    const noticesResult = (await noticesResponse.json()) as {
      success?: boolean;
      data?: { notices: StoreNotice[] };
    };

    if (
      !employeesResponse.ok || !employees.success || !employees.data ||
      !manualsResponse.ok || !manuals.manuals ||
      !noticesResponse.ok || !noticesResult.success || !noticesResult.data
    ) {
      return { status: "error" };
    }

    const recentSince = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
    return {
      status: "ready",
      data: {
        pendingStaff: employees.data.pending,
        approvedStaff: employees.data.approved,
        manuals: manuals.manuals,
        notices: noticesResult.data.notices,
        recentNoticeCount: noticesResult.data.notices.filter(
          (notice) => new Date(notice.createdAt).getTime() >= recentSince,
        ).length,
      },
    };
  } catch (e) {
    console.error("Failed to load store overview:", e);
    return { status: "error" };
  }
}

// 통합 activity 테이블이 없으므로 실제 조회 가능한 직원 요청/승인과 매뉴얼 등록·수정 시각을 합쳐 최근순으로 보여준다.
function buildActivities(data: StoreOverview): Activity[] {
  const noticeActivities: Activity[] = data.notices.map((notice) => ({
    key: `notice-${notice.id}`,
    kind: "본사 공지",
    title: notice.title,
    detail: "",
    at: notice.createdAt,
    href: NOTICES_HREF,
    Icon: Megaphone,
  }));

  const staffActivities: Activity[] = [
    ...data.pendingStaff.map((staff) => ({
      key: `pending-${staff.membershipId}`,
      kind: "직원 가입 요청",
      title: staff.name,
      detail: "승인 대기",
      at: staff.requestedAt,
      href: PENDING_STAFF_HREF,
      Icon: UserPlus,
    })),
    ...data.approvedStaff
      .filter((staff) => staff.approvedAt)
      .map((staff) => ({
        key: `approved-${staff.membershipId}`,
        kind: "직원 승인",
        title: staff.name,
        detail: "승인 완료",
        at: staff.approvedAt as string,
        href: EMPLOYEES_HREF,
        Icon: UserCheck,
      })),
  ];

  // 같은 타이틀의 세부 항목이 여러 줄이어도 가장 최근 한 건만 보여준다.
  const latestByTitle = new Map<string, StoreManual>();
  for (const manual of data.manuals) {
    const key = manual.title || manual.category || manual.id;
    const current = latestByTitle.get(key);
    if (!current || manualUpdatedAt(manual) > manualUpdatedAt(current)) {
      latestByTitle.set(key, manual);
    }
  }
  const manualActivities: Activity[] = [...latestByTitle.values()].map((manual) => ({
    key: `manual-${manual.id}`,
    kind: manual.updated_at && manual.updated_at !== manual.created_at ? "매뉴얼 수정" : "매뉴얼 등록",
    title: manual.title || manual.category || "지점 매뉴얼",
    detail: manual.category && manual.title ? manual.category : "",
    at: manualUpdatedAt(manual),
    href: STORE_MANUALS_HREF,
    Icon: BookOpen,
  }));

  // 최근순으로 정렬하되 같은 시각이면 본사 공지 → 직원 요청 → 매뉴얼 순으로 우선한다.
  return [...noticeActivities, ...staffActivities, ...manualActivities]
    .filter((activity) => !Number.isNaN(new Date(activity.at).getTime()))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_ACTIVITIES);
}

export default function OwnerDashboardPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [userName, setUserName] = useState("");
  const [franchiseName, setFranchiseName] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [selectedStoreName, setSelectedStoreName] = useState("");
  const [storesError, setStoresError] = useState(false);
  const [overview, setOverview] = useState<OverviewState>({ status: "loading" });

  // Authorization & Data Loading
  useLayoutEffect(() => {
    const checkAuthAndInit = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          router.push("/");
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role, approval_status, full_name, brand_id")
          .eq("id", data.user.id)
          .maybeSingle<{
            role: string;
            approval_status: string | null;
            full_name: string | null;
            brand_id: string | null;
          }>();
        if (profile?.role !== "owner") {
          router.push("/");
          return;
        }
        if (profile.approval_status !== "approved") {
          router.push("/signup/approval-status");
          return;
        }

        // 이름: profiles.full_name 우선, 없으면 가입 시 저장한 metadata 이름
        setUserName(profile.full_name || data.user.user_metadata?.name || data.user.email || "점주");

        // 소속 프랜차이즈명: profiles.brand_id와 기존 franchises 목록 API로만 확인한다.
        if (profile.brand_id) {
          const franchiseResponse = await fetch("/api/franchises");
          if (franchiseResponse.ok) {
            const franchiseResult = (await franchiseResponse.json()) as { franchises?: { id: string; name: string }[] };
            setFranchiseName(franchiseResult.franchises?.find((item) => item.id === profile.brand_id)?.name ?? "");
          }
        }

        // 현재 매장: 점주 공통 결정 로직 (approved owner membership → store)
        const resolution = await resolveOwnerCurrentStore();
        if (resolution.status === "error") {
          setStoresError(true);
        } else {
          if (resolution.current) {
            setSelectedStoreId(resolution.current.storeId);
            setSelectedStoreName(resolution.current.storeName);
          }
        }

        setIsReady(true);
      } catch (e) {
        console.error("Auth initialization failed:", e);
        router.push("/");
      }
    };

    checkAuthAndInit();
  }, [router]);

  useEffect(() => {
    if (!selectedStoreId) return;
    let isCancelled = false;
    void fetchStoreOverview(selectedStoreId).then((next) => {
      if (!isCancelled) setOverview(next);
    });
    return () => {
      isCancelled = true;
    };
  }, [selectedStoreId]);

  const handleRetry = () => {
    if (!selectedStoreId) return;
    setOverview({ status: "loading" });
    void fetchStoreOverview(selectedStoreId).then(setOverview);
  };

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
    } catch (e) {
      console.error("Logout failed:", e);
      router.push("/");
    }
  };

  if (!isReady) {
    return null;
  }

  const hasStore = Boolean(selectedStoreId);
  // 매장이 없으면 조회할 데이터가 없는 정상 상태(0건)로 같은 대시보드를 보여준다.
  const viewState: OverviewState = hasStore ? overview : { status: "ready", data: EMPTY_OVERVIEW };
  const data = viewState.status === "ready" ? viewState.data : null;

  const activities = data ? buildActivities(data) : [];

  const skeleton = (className: string) => (
    <span className={`inline-block animate-pulse rounded bg-[var(--color-bg-default)] align-middle ${className}`} aria-hidden="true" />
  );

  const errorBlock = (message: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm text-red-700" role="alert">{message}</p>
      <button
        type="button"
        onClick={handleRetry}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <RefreshCw size={16} aria-hidden="true" /> 다시 시도
      </button>
    </div>
  );

  // 오늘 확인할 업무: 실제 API에서 계산 가능한 상태만 둔다.
  // (공지 읽음 여부·매뉴얼 "확인 필요" 상태는 저장 구조가 없어 최근 7일 기준 지표로 대체)
  const taskCards = [
    {
      label: "직원 승인 대기",
      value: `${data?.pendingStaff.length ?? 0}`,
      unit: "건",
      description: "새로운 직원 가입 요청",
      href: PENDING_STAFF_HREF,
      Icon: UserPlus,
    },
    {
      label: `최근 ${RECENT_DAYS}일 본사 공지`,
      value: `${data?.recentNoticeCount ?? 0}`,
      unit: "건",
      description: "최근 일주일간 받은 본사 공지",
      href: NOTICES_HREF,
      Icon: Megaphone,
    },
    {
      label: "매뉴얼 현황",
      value: `${data?.manuals.length ?? 0}`,
      unit: "개",
      description: "현재 매장에서 등록한 매뉴얼",
      href: STORE_MANUALS_HREF,
      Icon: BookOpen,
    },
  ];

  const statusMetrics = [
    { label: "등록 직원", value: data ? `${data.approvedStaff.length}명` : null },
    { label: "승인 대기", value: data ? `${data.pendingStaff.length}명` : null },
    { label: "지점 매뉴얼", value: data ? `${data.manuals.length}개` : null },
    { label: "받은 공지", value: data ? `${data.notices.length}건` : null },
  ];

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex">
      {/* Sidebar */}
      <OwnerSidebar activeMenu="home" onLogout={handleLogout} />

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col lg:ml-[240px]">
        {/* Header */}
        <OwnerHeader userName={userName} storeName={selectedStoreName} onLogout={handleLogout} />

        {/* Page Content: 모든 section이 같은 content boundary(max-w-7xl + p-6/lg:p-8)를 쓴다. */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
            {/* Welcome */}
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                안녕하세요, {userName}님
              </h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                {hasStore
                  ? `${franchiseName && !selectedStoreName.startsWith(franchiseName) ? `${franchiseName} · ` : ""}${selectedStoreName}의 오늘 운영 현황을 확인해보세요.`
                  : "오늘의 매장 운영 현황을 확인해보세요."}
              </p>
            </div>

            {/* Current Store */}
            <section aria-labelledby="current-store-heading" className={`${cardClass} py-5`}>
              <p id="current-store-heading" className="text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                현재 매장
              </p>
              {storesError ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base text-red-700" role="alert">매장 정보를 불러오지 못했습니다.</p>
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                  >
                    <RefreshCw size={16} aria-hidden="true" /> 다시 시도
                  </button>
                </div>
              ) : !hasStore ? (
                <div className="flex items-start gap-3">
                  <Store size={20} className="mt-0.5 shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                  <div>
                    <p className="text-base font-semibold text-[var(--color-text-primary)]">아직 연결된 매장이 없습니다.</p>
                    <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
                      매장 승인 또는 등록이 완료되면 이곳에 표시됩니다.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-xl font-bold text-[var(--color-text-primary)]">{selectedStoreName}</p>
                    {/* 매장 자체의 운영 상태 컬럼은 없으므로 실제 membership 상태를 표시한다. */}
                    <span className="inline-flex items-center rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-sm font-medium text-[var(--color-primary)]">
                      승인 완료
                    </span>
                  </div>
                  {/* 여러 운영 매장 간 전환은 상단 헤더의 "현재 운영 매장"에서 한다. */}
                </div>
              )}
            </section>

            {/* 오늘 확인할 업무 */}
                <section aria-labelledby="tasks-heading">
                  <h2 id="tasks-heading" className="text-lg font-bold text-[var(--color-text-primary)] mb-4">
                    오늘 확인할 업무
                  </h2>
                  {viewState.status === "error" ? (
                    <div className={cardClass}>{errorBlock("업무 현황을 불러오지 못했습니다.")}</div>
                  ) : (
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                      {taskCards.map((task) => (
                        <Link key={task.label} href={task.href} className={`group flex items-start gap-4 ${cardClass} ${linkCardClass}`}>
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary)]">
                            <task.Icon size={20} aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-[var(--color-text-secondary)]">{task.label}</span>
                            <span className="mt-1 block text-2xl font-bold text-[var(--color-text-primary)]">
                              {viewState.status === "loading" ? (
                                skeleton("h-7 w-14")
                              ) : (
                                <>
                                  {task.value}
                                  <span className="ml-0.5 text-base font-medium text-[var(--color-text-secondary)]">{task.unit}</span>
                                </>
                              )}
                            </span>
                            <span className="mt-1 block text-sm text-[var(--color-text-secondary)]">
                              {task.description}
                            </span>
                          </span>
                          <ChevronRight size={18} className="mt-1 shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                        </Link>
                      ))}
                    </div>
                  )}
                </section>

                {/* 매장 운영 현황 */}
                <section aria-labelledby="status-heading">
                  <h2 id="status-heading" className="text-lg font-bold text-[var(--color-text-primary)] mb-4">
                    운영 현황
                  </h2>
                  <div className={`${cardClass} p-0`}>
                    {viewState.status === "error" ? (
                      <div className="p-6">{errorBlock("운영 현황을 불러오지 못했습니다.")}</div>
                    ) : (
                      <dl className="grid grid-cols-2 md:grid-cols-4">
                        {statusMetrics.map((metric, index) => (
                          <div
                            key={metric.label}
                            className={`flex flex-col items-center justify-center py-6 px-4 text-center ${
                              index % 2 === 0 ? "border-r border-[var(--color-border)]" : ""
                            } ${index < 3 ? "md:border-r md:border-[var(--color-border)]" : ""} ${
                              index < 2 ? "border-b border-[var(--color-border)] md:border-b-0" : ""
                            }`}
                          >
                            <dd className="order-1 text-2xl font-bold text-[var(--color-text-primary)] mb-1">
                              {metric.value ?? skeleton("h-7 w-16")}
                            </dd>
                            <dt className="order-2 text-sm text-[var(--color-text-secondary)]">{metric.label}</dt>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                </section>

                {/* 최근 활동 */}
                <section aria-labelledby="activity-heading">
                  <h2 id="activity-heading" className="text-lg font-bold text-[var(--color-text-primary)] mb-4">
                    최근 소식
                  </h2>
                  <div className={`${cardClass} py-2`}>
                    {viewState.status === "loading" ? (
                      <div className="space-y-3 py-4" role="status" aria-label="최근 소식을 불러오는 중">
                        <div className="h-10 animate-pulse rounded-lg bg-[var(--color-bg-default)]" />
                        <div className="h-10 animate-pulse rounded-lg bg-[var(--color-bg-default)]" />
                      </div>
                    ) : viewState.status === "error" ? (
                      <div className="py-4">{errorBlock("최근 소식을 불러오지 못했습니다.")}</div>
                    ) : activities.length === 0 ? (
                      <div className="py-5 text-center">
                        <p className="text-base text-[var(--color-text-secondary)]">아직 새로운 소식이 없습니다.</p>
                        <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
                          본사 공지와 매장 관련 업데이트가 이곳에 표시됩니다.
                        </p>
                      </div>
                    ) : (
                      <ul className="divide-y divide-[var(--color-border)]">
                        {activities.map((activity) => (
                          <li key={activity.key}>
                            <Link
                              href={activity.href}
                              className="-mx-3 flex min-h-[56px] items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                            >
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)]/50 text-[var(--color-primary)]">
                                <activity.Icon size={18} aria-hidden="true" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm text-[var(--color-text-secondary)]">{activity.kind}</span>
                                <span className="block truncate text-base font-medium text-[var(--color-text-primary)]">
                                  {activity.title}
                                  {activity.detail && (
                                    <span className="font-normal text-[var(--color-text-secondary)]"> · {activity.detail}</span>
                                  )}
                                </span>
                              </span>
                              <time dateTime={activity.at} className="shrink-0 text-sm text-[var(--color-text-tertiary)]">
                                {formatRelative(activity.at)}
                              </time>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
          </div>
        </main>
      </div>
    </div>
  );
}
