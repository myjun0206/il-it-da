"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Store, ArrowRight, UploadCloud, CheckCircle2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedProfile } from "@/lib/auth/client-profile";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import Link from "next/link";
import type { ManualRecord } from "@/lib/types/manual";

interface ManualSummary {
  totalManuals: number;
  commonManuals: number;
  storeManuals: number;
  storesWithManuals: number;
}

type ManualSummaryItem = Pick<ManualRecord, "store_id"> & {
  scope_type?: string | null;
};

// 온보딩 화면(app/hq/manuals/onboarding/page.tsx)과 같은 키를 사용한다.
const MANUAL_UPLOAD_NOTICE_KEY = "ilitda:manual-upload-notice";

export default function ManualOverviewPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("메가MGC커피");
  const [isReady, setIsReady] = useState(false);
  const [summary, setSummary] = useState<ManualSummary>({
    totalManuals: 0,
    commonManuals: 0,
    storeManuals: 0,
    storesWithManuals: 0,
  });
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  // 온보딩 화면에서 업로드/승인 후 넘어온 경우, 등록 결과를 한 번만 보여준다.
  // (이 페이지는 isReady 전까지 null을 렌더하므로 서버/클라이언트 초기값이 달라도 화면 불일치가 없다.)
  const [uploadNotice, setUploadNotice] = useState<string | null>(() => {
    try {
      return typeof window === "undefined" ? null : sessionStorage.getItem(MANUAL_UPLOAD_NOTICE_KEY);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.removeItem(MANUAL_UPLOAD_NOTICE_KEY);
    } catch {
      // 저장소를 쓸 수 없는 환경이면 무시한다.
    }
  }, []);

  useLayoutEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const profile = await getAuthenticatedProfile(supabase);

        if (profile?.role !== "hq") {
          router.push("/");
          return;
        }
      } catch (e) {
        console.error("Auth check failed:", e);
        router.push("/");
      }
    };

    checkAuth();
  }, [router]);

  useEffect(() => {
    const setUserInfo = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) return;

        const name = data.session.user.user_metadata?.name;
        if (name) {
          setUserName(name);
          if (name.includes(" ")) {
            const [first] = name.split(" ");
            if (first) setFranchiseName(first);
          }
        }
      } finally {
        setIsReady(true);
      }
    };

    setUserInfo();
  }, []);

  useEffect(() => {
    const fetchManualSummary = async () => {
      try {
        setIsLoadingSummary(true);

        // 공통 매뉴얼은 /api/manuals, 지점 매뉴얼은 franchise 범위의 /api/hq/stores 기준으로 센다.
        // (/api/manuals는 HQ에게 공통 매뉴얼(store_id = null)만 돌려준다.) HQ 홈도 같은 기준을 쓴다.
        const [manualsResponse, storesResponse] = await Promise.all([
          fetch("/api/manuals"),
          fetch("/api/hq/stores"),
        ]);
        const data = (await manualsResponse.json()) as { manuals?: ManualSummaryItem[]; error?: string };
        const storesData = (await storesResponse.json()) as { stores?: { manualCount: number }[] };

        if (manualsResponse.ok && data.manuals) {
          const commonManuals = data.manuals.filter((m) => m.scope_type === "hq" || !m.store_id).length;
          const stores = storesResponse.ok ? storesData.stores ?? [] : [];
          const storeManuals = stores.reduce((sum, store) => sum + store.manualCount, 0);

          setSummary({
            totalManuals: commonManuals + storeManuals,
            commonManuals,
            storeManuals,
            storesWithManuals: stores.filter((store) => store.manualCount > 0).length,
          });
        }
      } catch (e) {
        console.error("Failed to fetch manual summary:", e);
      } finally {
        setIsLoadingSummary(false);
      }
    };

    fetchManualSummary();
  }, []);

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

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <HQSidebar
        userName={userName}
        franchiseName={franchiseName}
        onLogout={handleLogout}
        activeMenu="manual"
      />

      <div className="lg:ml-[240px]">
        <HQHeader userName={userName} franchiseName={franchiseName} onLogout={handleLogout} />

        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                매뉴얼 관리
              </h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                본사와 각 지점의 매뉴얼 현황을 확인하고 관리합니다.
              </p>
            </div>
            <Link
              href="/hq/manuals/onboarding?from=manuals"
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center self-start rounded-md bg-[var(--color-primary)] px-4 text-base font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 sm:self-auto"
            >
              <UploadCloud size={16} className="mr-2" aria-hidden="true" /> 파일로 매뉴얼 추가
            </Link>
          </div>

          {uploadNotice && (
            <div
              role="status"
              className="mb-8 flex items-center gap-3 rounded-xl border border-[var(--color-primary)]/30 bg-[var(--color-primary-light)] px-5 py-4"
            >
              <CheckCircle2 size={20} className="shrink-0 text-[var(--color-primary)]" />
              <p className="flex-1 text-sm font-medium text-[var(--color-primary)] break-keep">
                {uploadNotice}
              </p>
              <button
                type="button"
                onClick={() => setUploadNotice(null)}
                className="rounded-md p-1 text-[var(--color-primary)] hover:bg-white/60"
                aria-label="알림 닫기"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {/* Total */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                    전체 매뉴얼
                  </p>
                  {isLoadingSummary ? (
                    <p className="text-2xl font-bold text-[var(--color-text-tertiary)]">-</p>
                  ) : (
                    <p className="text-2xl font-bold text-[var(--color-text-primary)]">
                      {summary.totalManuals}
                    </p>
                  )}
                </div>
                <div className="w-12 h-12 rounded-lg bg-[var(--color-primary-light)] flex items-center justify-center">
                  <BookOpen size={24} className="text-[var(--color-primary)]" />
                </div>
              </div>
            </div>

            {/* Common */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                    공통 매뉴얼
                  </p>
                  {isLoadingSummary ? (
                    <p className="text-2xl font-bold text-[var(--color-text-tertiary)]">-</p>
                  ) : (
                    <p className="text-2xl font-bold text-[var(--color-text-primary)]">
                      {summary.commonManuals}
                    </p>
                  )}
                </div>
                <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
                  <BookOpen size={24} className="text-blue-600" />
                </div>
              </div>
            </div>

            {/* Stores */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                    지점 매뉴얼
                  </p>
                  {isLoadingSummary ? (
                    <p className="text-2xl font-bold text-[var(--color-text-tertiary)]">-</p>
                  ) : (
                    <p className="text-2xl font-bold text-[var(--color-text-primary)]">
                      {summary.storeManuals}
                    </p>
                  )}
                </div>
                <div className="w-12 h-12 rounded-lg bg-amber-100 flex items-center justify-center">
                  <Store size={24} className="text-amber-600" />
                </div>
              </div>
            </div>
          </div>

          {/* Manual management navigation cards */}
          <section aria-labelledby="manual-management-heading">
            <h2 id="manual-management-heading" className="sr-only">
              매뉴얼 관리
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[
                {
                  href: "/hq/manuals/common",
                  title: "공통 매뉴얼",
                  count: summary.commonManuals,
                  Icon: BookOpen,
                  iconClassName: "bg-[var(--color-primary-light)] text-[var(--color-primary)]",
                },
                {
                  href: "/hq/manuals/stores",
                  title: "지점 매뉴얼",
                  count: summary.storeManuals,
                  Icon: Store,
                  iconClassName: "bg-amber-100 text-amber-600",
                },
              ].map((card) => (
                <Link
                  key={card.href}
                  href={card.href}
                  className="group flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-white p-5 shadow-sm transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${card.iconClassName}`}>
                      <card.Icon size={20} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{card.title}</h3>
                      <p className="text-sm font-medium text-[var(--color-text-secondary)] mt-1">
                        {isLoadingSummary ? "-" : `${card.count}개`}
                      </p>
                    </div>
                  </div>
                  <ArrowRight size={20} aria-hidden="true" className="shrink-0 ml-2 text-[var(--color-text-tertiary)] transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
