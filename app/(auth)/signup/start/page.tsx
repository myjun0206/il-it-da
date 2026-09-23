"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /signup/start
 * 
 * 새로운 회원가입 진입점.
 * 회원가입 외부(로그인 페이지, 랜딩 등)에서 "회원가입" 버튼을 클릭하면
 * 이 페이지로 진입한다.
 * 
 * 목적: 기존 회원가입 draft 상태를 모두 초기화한 후
 * /signup/role로 리다이렉트하는 것.
 * 
 * 이를 통해 "새로운 회원가입 시작"과 "signup 내부 navigation"을
 * 명확하게 구분한다.
 */

function clearSignupSessionStorage() {
  // signup-related draft keys
  sessionStorage.removeItem("signupRole");
  sessionStorage.removeItem("signupTerms");
  sessionStorage.removeItem("signupHQProfile");
  sessionStorage.removeItem("signupProfile");
  sessionStorage.removeItem("signupFranchise");
  sessionStorage.removeItem("signupFranchiseConfirmed");
  sessionStorage.removeItem("signupFranchiseName");
  sessionStorage.removeItem("signupBrand");
  sessionStorage.removeItem("signupStores");
  sessionStorage.removeItem("signupSelectedStores");
  sessionStorage.removeItem("signupStoreApprovals");
  sessionStorage.removeItem("signupApprovalStatus");
  sessionStorage.removeItem("signupApprovalSubmittedAt");
  sessionStorage.removeItem("signupPassword");
  sessionStorage.removeItem("signupAuthAttemptEmail");
  sessionStorage.removeItem("signupAuthAttemptAt");
  sessionStorage.removeItem("signupVerified");
}

export default function SignupStartPage() {
  const router = useRouter();

  useEffect(() => {
    // 새 회원가입 시작: 모든 draft 초기화
    clearSignupSessionStorage();

    // /signup/role로 리다이렉트
    router.push("/signup/role");
  }, [router]);

  // 로딩 중 표시
  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex items-center justify-center">
      <div className="text-center">
        <div className="mb-4 animate-spin">
          <div className="w-8 h-8 border-4 border-[var(--color-border-light)] border-t-[var(--color-primary)] rounded-full" />
        </div>
        <p className="text-[var(--color-text-secondary)]">로딩 중...</p>
      </div>
    </div>
  );
}
