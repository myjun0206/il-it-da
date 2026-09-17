"use client";

import React, { useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  Store,
  Users,
  FileText,
  BarChart3,
  MessageSquare,
  ArrowRight,
  AlertCircle,
  TrendingUp,
  CheckCircle,
} from "lucide-react";
import { Card } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { createClient } from "@/lib/supabase/client";

export default function HQHomePage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);

    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        
        if (!data.session?.user) {
          router.push("/");
          return;
        }

        const role = data.session.user.user_metadata?.role;

        // Verify user is HQ
        if (role !== "hq") {
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

  if (!mounted) {
    return null;
  }

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">
          브랜드 관리
        </h1>
        <p className="text-lg text-[var(--color-text-secondary)]">
          전체 브랜드와 매장을 효율적으로 관리하세요.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="md">
          <div>
            <p className="text-sm text-[var(--color-text-secondary)] mb-2">
              브랜드
            </p>
            <div className="flex items-end justify-between">
              <p className="text-3xl font-bold text-[var(--color-primary)]">5</p>
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div>
            <p className="text-sm text-[var(--color-text-secondary)] mb-2">
              매장
            </p>
            <div className="flex items-end justify-between">
              <p className="text-3xl font-bold text-[var(--color-primary)]">
                23
              </p>
              <TrendingUp size={16} className="text-green-600" />
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div>
            <p className="text-sm text-[var(--color-text-secondary)] mb-2">
              직원
            </p>
            <div className="flex items-end justify-between">
              <p className="text-3xl font-bold text-[var(--color-primary)]">
                156
              </p>
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div>
            <p className="text-sm text-[var(--color-text-secondary)] mb-2">
              대기 중인 승인
            </p>
            <p className="text-3xl font-bold text-orange-600">8</p>
          </div>
        </Card>
      </div>

      {/* Actions */}
      <div>
        <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-4">
          주요 기능
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Brands */}
          <Link href="/app/brands">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <div className="flex items-start justify-between mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-100">
                  <Building2 size={24} className="text-purple-600" />
                </div>
                <ArrowRight
                  size={16}
                  className="text-[var(--color-text-tertiary)]"
                />
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                브랜드 관리
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                전체 브랜드를 관리하세요
              </p>
            </Card>
          </Link>

          {/* Stores */}
          <Link href="/app/stores">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <div className="flex items-start justify-between mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--color-primary-light)]">
                  <Store
                    size={24}
                    className="text-[var(--color-primary)]"
                  />
                </div>
                <ArrowRight
                  size={16}
                  className="text-[var(--color-text-tertiary)]"
                />
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                매장 관리
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                모든 매장을 관리하세요
              </p>
            </Card>
          </Link>

          {/* Members */}
          <Link href="/app/members">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <div className="flex items-start justify-between mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
                  <Users size={24} className="text-blue-600" />
                </div>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-white text-xs font-bold">
                  8
                </span>
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                직원 관리
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                승인 대기 중인 직원 확인
              </p>
            </Card>
          </Link>

          {/* Manuals */}
          <Link href="/app/manuals">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <div className="flex items-start justify-between mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-100">
                  <FileText size={24} className="text-green-600" />
                </div>
                <ArrowRight
                  size={16}
                  className="text-[var(--color-text-tertiary)]"
                />
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                매뉴얼 관리
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                공통 매뉴얼 배포 및 관리
              </p>
            </Card>
          </Link>

          {/* Statistics */}
          <Link href="/app/stats">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <div className="flex items-start justify-between mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-cyan-100">
                  <BarChart3 size={24} className="text-cyan-600" />
                </div>
                <ArrowRight
                  size={16}
                  className="text-[var(--color-text-tertiary)]"
                />
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                통계
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                전사 운영 통계
              </p>
            </Card>
          </Link>

          {/* AI Chat */}
          <Link href="/app/chat">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <div className="flex items-start justify-between mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-rose-100">
                  <MessageSquare size={24} className="text-rose-600" />
                </div>
                <ArrowRight
                  size={16}
                  className="text-[var(--color-text-tertiary)]"
                />
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                AI 상담
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                AI와 대화하세요
              </p>
            </Card>
          </Link>
        </div>
      </div>

      {/* Pending Approvals */}
      <div className="space-y-3">
        <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
          승인 대기 중
        </h2>
        <Card padding="md" className="border-l-4 border-l-orange-500">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <AlertCircle size={20} className="text-orange-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-[var(--color-text-primary)]">
                  새로운 직원 가입 신청
                </p>
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                  8명의 직원이 승인을 기다리고 있습니다.
                </p>
              </div>
            </div>
            <Link href="/app/members">
              <Button variant="outline" size="sm">
                검토하기
              </Button>
            </Link>
          </div>
        </Card>

        <Card padding="md" className="border-l-4 border-l-green-500">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-[var(--color-text-primary)]">
                  최근 승인 완료
                </p>
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                  어제 5명의 직원 가입이 승인되었습니다.
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
