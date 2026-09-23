"use client";

import React, { useLayoutEffect, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Clock, Mail, Check, ChevronLeft } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types/user";

export default function SignupCompletePage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [franchiseName, setFranchiseName] = useState<string | null>(null);

  useLayoutEffect(() => {
    const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
    
    if (!savedRole) {
      router.push("/signup/role");
    }
  }, [router]);

  useEffect(() => {
    const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
    const savedFranchiseName = sessionStorage.getItem("signupFranchiseName");
    
    if (savedRole) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRole(savedRole);
      setFranchiseName(savedFranchiseName);
    }
  }, []);

  // 로그인 화면으로 이동 - 임시 회원가입 상태 초기화
  const handleGoToLogin = useCallback(async () => {
    try {
      // Signup 과정에서 생성된 Auth session 종료
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (e) {
      console.error("SignOut failed:", e);
    }

    // 회원가입 진행 임시 상태 모두 삭제
    // 실제 계정 정보는 Supabase Auth와 public.profiles에서 관리
    sessionStorage.removeItem("signupRole");
    sessionStorage.removeItem("signupHQProfile");
    sessionStorage.removeItem("signupFranchise");
    sessionStorage.removeItem("signupFranchiseConfirmed");
    sessionStorage.removeItem("signupFranchiseName");
    sessionStorage.removeItem("signupStores");
    sessionStorage.removeItem("signupSelectedStores");
    sessionStorage.removeItem("signupApprovalStatus");
    sessionStorage.removeItem("signupApprovalSubmittedAt");
    sessionStorage.removeItem("signupPassword");
    sessionStorage.removeItem("signupAuthAttemptEmail");
    sessionStorage.removeItem("signupAuthAttemptAt");
    
    // 로그인 페이지로 이동
    router.push("/");
  }, [router]);

  if (!role) {
    return null;
  }

  const isHQ = role === "hq";

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <div className="flex flex-col min-h-screen">
        {/* Header */}
        {!isHQ && (
          <header className="relative border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
            <div className="flex items-center justify-between px-5 sm:px-8 lg:px-12 xl:px-16 h-16 lg:h-[68px]">
              <button
                onClick={() => router.push("/signup/profile")}
                className="flex items-center gap-2 text-[var(--color-text-primary)] hover:text-[var(--color-primary)] transition-colors"
              >
                <ChevronLeft size={24} />
                <span className="hidden sm:inline text-base font-semibold">이전</span>
              </button>
              <img src="/logo.svg" alt="일잇다" className="h-8 lg:h-9" />
              <div className="text-sm sm:text-base font-semibold text-[var(--color-text-secondary)]">
                3 / 3
              </div>
            </div>
          </header>
        )}

        {/* Main Content */}
        <div className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
          <div className="w-full max-w-2xl">
            {isHQ ? (
              // 본사 관리자 완료 화면
              <div className="text-center">
                {/* Check Icon */}
                <div className="flex justify-center mb-6">
                  <div className="p-3 bg-[var(--color-primary)] rounded-full">
                    <Check size={40} className="text-white" strokeWidth={3} />
                  </div>
                </div>

                {/* Main Title */}
                <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text-primary)] mb-3">
                  회원가입이 완료되었습니다.
                </h1>

                {/* Franchise Info */}
                <p className="text-base sm:text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                  {franchiseName ? `${franchiseName} 본사 관리자로 가입되었습니다.` : "본사 관리자로 가입되었습니다."}
                </p>

                {/* Description */}
                <p className="text-sm sm:text-base text-[var(--color-text-secondary)] mb-8">
                  로그인 후 일잇다의 본사 관리 기능을 이용할 수 있어요.
                </p>

                {/* Login Button */}
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={handleGoToLogin}
                >
                  로그인하러 가기
                </Button>
              </div>
            ) : (
              // Owner/Staff 대기 상태
              <Card className="text-center" padding="lg">
                <div className="flex justify-center mb-6">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100">
                    <Clock size={40} className="text-orange-600" />
                  </div>
                </div>

                <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">
                  가입 신청이 완료되었습니다.
                </h1>
                <p className="text-lg text-[var(--color-text-secondary)] mb-8">
                  관리자의 승인을 기다리고 있습니다.
                </p>

                <div className="bg-orange-50 p-6 rounded-lg mb-8 text-left border border-orange-200">
                  <div className="flex gap-3 mb-4">
                    <Mail size={20} className="text-orange-600 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-[var(--color-text-primary)]">
                        승인 대기 중
                      </h3>
                      <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                        본사 관리자가 귀하의 가입 신청을 검토 중입니다.
                        <br />
                        보통 1-2일 소요되며, 결과는 이메일로 알려드립니다.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                <div className="space-y-4 mb-8 text-left">
                  <div className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-primary)]">
                        <CheckCircle
                          size={20}
                          className="text-white"
                        />
                      </div>
                      <div className="w-1 h-8 bg-[var(--color-border)]" />
                    </div>
                    <div className="pb-4">
                      <p className="font-semibold text-[var(--color-text-primary)]">
                        가입 신청 완료
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        이미 완료되었습니다.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)]">
                        <Clock size={16} className="text-[var(--color-text-tertiary)]" />
                      </div>
                      <div className="w-1 h-8 bg-[var(--color-border)]" />
                    </div>
                    <div className="pb-4">
                      <p className="font-semibold text-[var(--color-text-primary)]">
                        관리자 검토
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        진행 중...
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)]">
                        <CheckCircle
                          size={16}
                          className="text-[var(--color-text-tertiary)]"
                        />
                      </div>
                    </div>
                    <div>
                      <p className="font-semibold text-[var(--color-text-primary)]">
                        승인 완료
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        승인되면 시작할 수 있습니다.
                      </p>
                    </div>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  className="w-full"
                  onClick={handleGoToLogin}
                >
                  홈으로 돌아가기
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  className="w-full mt-3"
                  onClick={handleGoToLogin}
                >
                  다시 로그인하기
                </Button>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
