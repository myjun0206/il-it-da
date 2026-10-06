"use client";

import React, { useLayoutEffect, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/common/Button";
import ResultPanel from "@/components/common/ResultPanel";
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
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex-shrink-0">
                <img src="/logo/ilitda-wordmark.png" alt="일잇다" className="h-8 sm:h-9 w-auto object-contain" />
              </div>
            </div>
          </header>
        )}

        {/* Main Content: 신청·승인 결과 화면 공통 구조(아이콘 → 제목 → 설명 → 다음 행동) */}
        <div className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
          <div className="w-full max-w-xl">
            {isHQ ? (
              // 본사 관리자: 가입 즉시 이용 가능
              <ResultPanel
                tone="success"
                title="회원가입이 완료되었습니다."
                description={
                  <>
                    <p className="font-semibold text-[var(--color-text-primary)]">
                      {franchiseName ? `${franchiseName} 본사 관리자로 가입되었습니다.` : "본사 관리자로 가입되었습니다."}
                    </p>
                    <p className="mt-1">로그인 후 일잇다의 본사 관리 기능을 이용할 수 있어요.</p>
                  </>
                }
                actions={
                  <Button type="button" variant="primary" size="lg" className="w-full" onClick={handleGoToLogin}>
                    로그인하러 가기
                  </Button>
                }
              />
            ) : (
              // 점주/직원: 승인 대기 (점주는 본사, 직원은 신청한 매장의 점주가 승인한다)
              <ResultPanel
                tone="pending"
                title="가입 신청이 완료되었습니다."
                description={
                  role === "owner"
                    ? "본사에서 승인하면 일잇다를 이용할 수 있습니다."
                    : "신청한 매장의 점주가 승인하면 일잇다를 이용할 수 있습니다."
                }
                actions={
                  <div className="flex flex-col gap-3">
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      className="w-full"
                      onClick={() => router.push("/signup/approval-status")}
                    >
                      승인 현황 확인
                    </Button>
                    <Button type="button" variant="outline" size="md" className="w-full" onClick={handleGoToLogin}>
                      로그인 화면으로 돌아가기
                    </Button>
                  </div>
                }
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
