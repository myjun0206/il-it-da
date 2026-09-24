"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { createClient } from "@/lib/supabase/client";

type ApprovalStatus = "pending" | "approved" | "rejected";

type StatusResult = {
  found: boolean;
  status?: ApprovalStatus;
  role?: string;
  fullName?: string | null;
  memberships?: Array<{
    membershipId: string;
    storeName: string;
    brandName: string | null;
    status: ApprovalStatus;
    requestedAt: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
  }>;
  error?: string;
};

const statusView = {
  pending: {
    title: "승인 대기 중",
    className: "border-orange-200 bg-orange-50 text-orange-700",
  },
  approved: {
    title: "승인 완료",
    className: "border-green-200 bg-green-50 text-green-700",
  },
  rejected: {
    title: "승인 거절",
    className: "border-red-200 bg-red-50 text-red-700",
  },
} as const;

function formatDate(value: string | null): string {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "-";
  }
}

export default function SignupApprovalStatusPage() {
  return (
    <Suspense fallback={null}>
      <SignupApprovalStatusContent />
    </Suspense>
  );
}

function SignupApprovalStatusContent() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<StatusResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadSessionEmail = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const sessionEmail = data.session?.user.email;
      if (sessionEmail) {
        setEmail(sessionEmail);
      }
    };

    loadSessionEmail();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setResult(null);

    if (!email.trim()) {
      setError("이메일을 입력해주세요.");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/approval-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as StatusResult;

      if (!response.ok) {
        throw new Error(data.error || "승인 상태를 확인하지 못했습니다.");
      }

      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "승인 상태를 확인하지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToLogin = async () => {
    setIsSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (e) {
      console.error("Sign out failed:", e);
    } finally {
      router.push("/");
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg rounded-lg border border-[var(--color-border)] bg-white p-6 sm:p-8">
        <div className="mb-6 text-center">
          <img src="/logo/ilitda-wordmark.png" alt="일잇다" className="mx-auto mb-6 h-9 w-auto object-contain" />
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">승인 확인하기</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            가입 시 입력한 이메일로 점포별 승인 상태를 확인할 수 있습니다.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="이메일"
            type="email"
            placeholder="example@email.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={error}
          />
          <Button type="submit" variant="primary" size="md" isLoading={isLoading} className="w-full">
            승인 상태 확인
          </Button>
        </form>

        {result && !result.found && (
          <div className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 text-sm text-[var(--color-text-primary)]">
            해당 이메일로 가입 신청 내역을 찾지 못했습니다.
          </div>
        )}

        {result?.found && result.memberships && result.memberships.length > 0 && (
          <div className="mt-6 space-y-3">
            <h2 className="text-sm font-bold text-[var(--color-text-primary)]">점포별 신청 상태</h2>
            {result.memberships.map((membership) => {
              const view = statusView[membership.status];
              return (
                <div key={membership.membershipId} className="rounded-lg border border-[var(--color-border)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--color-text-primary)]">{membership.storeName}</p>
                      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                        {membership.brandName || "브랜드 미지정"}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${view.className}`}>
                      {view.title}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
                    신청: {formatDate(membership.requestedAt)}
                    {membership.status === "approved" ? ` · 승인: ${formatDate(membership.approvedAt)}` : ""}
                    {membership.status === "rejected" ? ` · 취소/거절: ${formatDate(membership.rejectedAt)}` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {result?.found && result.memberships && result.memberships.length === 0 && (
          <div className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 text-sm text-[var(--color-text-primary)]">
            이 이메일로 등록된 점포별 가입 신청 내역이 없습니다.
          </div>
        )}

        <div className="mt-6 flex justify-center gap-4 text-sm">
          <button
            type="button"
            onClick={handleBackToLogin}
            disabled={isSigningOut}
            className="font-semibold text-[var(--color-primary)] hover:underline disabled:opacity-60"
          >
            {isSigningOut ? "로그아웃 중..." : "로그인으로 돌아가기"}
          </button>
          <Link href="/signup/role" className="text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]">
            회원가입
          </Link>
        </div>
      </div>
    </div>
  );
}
