"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Store, ArrowRight } from "lucide-react";
import { Button } from "@/components/common/Button";
import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedProfile } from "@/lib/auth/client-profile";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import Link from "next/link";

interface ManualSummary {
  totalManuals: number;
  commonManuals: number;
  storeManuals: number;
}

export default function ManualOverviewPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("메가MGC커피");
  const [isReady, setIsReady] = useState(false);
  const [summary, setSummary] = useState<ManualSummary>({
    totalManuals: 0,
    commonManuals: 0,
    storeManuals: 0,
  });
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);

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

        // Fetch all manuals
        const response = await fetch("/api/manuals");
        const data = (await response.json()) as { manuals?: any[]; error?: string };

        if (response.ok && data.manuals) {
          const manuals = data.manuals;

          // Count by scope_type
          const commonManuals = manuals.filter((m) => m.scope_type === "hq" || !m.store_id).length;
          const storeManuals = manuals.filter((m) => m.store_id).length;
          const totalManuals = manuals.length;

          setSummary({
            totalManuals,
            commonManuals,
            storeManuals,
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
        <HQHeader userName={userName} franchiseName={franchiseName} />

        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
              매뉴얼 관리
            </h1>
            <p className="text-base text-[var(--color-text-secondary)]">
              {franchiseName}의 공통 매뉴얼과 지점 매뉴얼을 한곳에서 확인하세요.
            </p>
          </div>

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

          {/* Common Manuals Section */}
          <div className="mb-8">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-1">
                공통 매뉴얼
              </h2>
              <p className="text-sm text-[var(--color-text-secondary)]">
                모든 지점에서 공통으로 사용하는 본사 매뉴얼입니다.
              </p>
            </div>

            <div className="bg-white border border-[var(--color-border)] rounded-xl p-8 shadow-sm text-center">
              {isLoadingSummary ? (
                <p className="text-sm text-[var(--color-text-secondary)]">로드 중...</p>
              ) : summary.commonManuals === 0 ? (
                <div className="py-6">
                  <div className="w-16 h-16 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center mx-auto mb-4">
                    <BookOpen size={32} className="text-[var(--color-primary)]" />
                  </div>
                  <p className="text-base text-[var(--color-text-secondary)] mb-6">
                    아직 등록된 공통 매뉴얼이 없습니다.
                  </p>
                  <Link href="/hq/manuals/common">
                    <Button variant="primary" className="mx-auto">
                      공통 매뉴얼 관리 <ArrowRight size={16} className="ml-2" />
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="py-6">
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary-light)]">
                    <BookOpen size={20} className="text-[var(--color-primary)]" />
                    <span className="font-medium text-[var(--color-primary)]">
                      {summary.commonManuals}개 매뉴얼 등록됨
                    </span>
                  </div>
                  <div className="mt-6">
                    <Link href="/hq/manuals/common">
                      <Button variant="outline">
                        공통 매뉴얼 관리 <ArrowRight size={16} className="ml-2" />
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Store Manuals Section */}
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-1">
                지점 매뉴얼
              </h2>
              <p className="text-sm text-[var(--color-text-secondary)]">
                각 지점에서 등록한 매뉴얼을 확인할 수 있습니다.
              </p>
            </div>

            <div className="bg-white border border-[var(--color-border)] rounded-xl p-8 shadow-sm text-center">
              {isLoadingSummary ? (
                <p className="text-sm text-[var(--color-text-secondary)]">로드 중...</p>
              ) : summary.storeManuals === 0 ? (
                <div className="py-6">
                  <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                    <Store size={32} className="text-amber-600" />
                  </div>
                  <p className="text-base text-[var(--color-text-secondary)] mb-6">
                    아직 등록된 지점 매뉴얼이 없습니다.
                  </p>
                  <Link href="/hq/manuals/stores">
                    <Button variant="primary" className="mx-auto">
                      지점 매뉴얼 보기 <ArrowRight size={16} className="ml-2" />
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="py-6">
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-100">
                    <Store size={20} className="text-amber-600" />
                    <span className="font-medium text-amber-600">
                      {summary.storeManuals}개 매뉴얼 등록됨
                    </span>
                  </div>
                  <div className="mt-6">
                    <Link href="/hq/manuals/stores">
                      <Button variant="outline">
                        지점 매뉴얼 보기 <ArrowRight size={16} className="ml-2" />
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
