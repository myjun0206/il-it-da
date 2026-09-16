"use client";

import React from "react";
import Link from "next/link";
import {
  Store,
  Users,
  FileText,
  BarChart3,
  MessageSquare,
  ArrowRight,
  AlertCircle,
  TrendingUp,
} from "lucide-react";
import { Card } from "@/components/common/Card";
import { Button } from "@/components/common/Button";

export default function OwnerHomePage() {
  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">
          매장 관리
        </h1>
        <p className="text-lg text-[var(--color-text-secondary)]">
          매장 운영에 필요한 모든 것을 한 곳에서 관리하세요.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="md">
          <div>
            <p className="text-sm text-[var(--color-text-secondary)] mb-2">
              직원
            </p>
            <div className="flex items-end justify-between">
              <p className="text-3xl font-bold text-[var(--color-primary)]">8</p>
              <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
                +1명
              </span>
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div>
            <p className="text-sm text-[var(--color-text-secondary)] mb-2">
              매뉴얼
            </p>
            <div className="flex items-end justify-between">
              <p className="text-3xl font-bold text-[var(--color-primary)]">
                12
              </p>
              <TrendingUp size={16} className="text-green-600" />
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div>
            <p className="text-sm text-[var(--color-text-secondary)] mb-2">
              대기 중인 승인
            </p>
            <p className="text-3xl font-bold text-orange-600">2</p>
          </div>
        </Card>

        <Card padding="md">
          <div>
            <p className="text-sm text-[var(--color-text-secondary)] mb-2">
              미완료 작업
            </p>
            <p className="text-3xl font-bold text-blue-600">3</p>
          </div>
        </Card>
      </div>

      {/* Actions */}
      <div>
        <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-4">
          주요 기능
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Store Management */}
          <Link href="/app/store">
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
                매장 정보
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                매장 정보를 관리하세요
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
                  2
                </span>
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                직원 관리
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                직원을 관리하고 초대하세요
              </p>
            </Card>
          </Link>

          {/* Manuals */}
          <Link href="/app/manuals">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <div className="flex items-start justify-between mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-100">
                  <FileText size={24} className="text-purple-600" />
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
                직원용 매뉴얼을 관리하세요
              </p>
            </Card>
          </Link>

          {/* Statistics */}
          <Link href="/app/stats">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <div className="flex items-start justify-between mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-100">
                  <BarChart3 size={24} className="text-green-600" />
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
                운영 통계를 확인하세요
              </p>
            </Card>
          </Link>

          {/* AI Chat */}
          <Link href="/app/chat">
            <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
              <div className="flex items-start justify-between mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-cyan-100">
                  <MessageSquare size={24} className="text-cyan-600" />
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

      {/* Alerts */}
      <div className="space-y-3">
        <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
          알림
        </h2>
        <Card padding="md" className="border-l-4 border-l-orange-500">
          <div className="flex gap-3">
            <AlertCircle size={20} className="text-orange-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-[var(--color-text-primary)]">
                새로운 직원 초대 요청 2건
              </p>
              <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                직원 관리 페이지에서 확인하세요.
              </p>
            </div>
          </div>
        </Card>

        <Card padding="md" className="border-l-4 border-l-blue-500">
          <div className="flex gap-3">
            <AlertCircle size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-[var(--color-text-primary)]">
                매뉴얼 업데이트
              </p>
              <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                본사에서 새로운 매뉴얼을 배포했습니다.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
