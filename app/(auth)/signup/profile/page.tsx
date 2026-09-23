"use client";

import React, { useState, useEffect, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Check, Building2 } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input, PasswordInput } from "@/components/common/Input";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types/user";
import {
  DEV_TEST_EMAILS,
  DEV_TEST_VERIFICATION_CODE,
  DEV_TEST_EMAIL_FRANCHISE_MAP,
  DEV_TEST_EMAIL_ROLE_MAP,
  DEV_TEST_PASSWORD,
} from "@/lib/data/mockFranchises";

// 이메일 정규화: 앞뒤 공백 제거 + 소문자 변환(테스트 이메일/도메인 비교에 공통 사용)
const normalizeEmail = (value: string) => value.trim().toLowerCase();

// public.franchises 테이블에 이메일 도메인을 조회해 프랜차이즈 정보를 가져온다 (app/api/franchises/lookup).
async function getFranchiseByEmail(
  email: string,
): Promise<{ domain: string; franchise?: { id: string; name: string } }> {
  const domain = email.split("@")[1]?.toLowerCase();

  if (!domain) {
    return { domain: "", franchise: undefined };
  }

  try {
    const response = await fetch(`/api/franchises/lookup?domain=${encodeURIComponent(domain)}`);
    if (!response.ok) {
      return { domain, franchise: undefined };
    }

    const data = (await response.json()) as { franchise?: { id: string; name: string } };
    return { domain, franchise: data.franchise };
  } catch {
    return { domain, franchise: undefined };
  }
}

function clearSignupSessionStorage() {
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
  sessionStorage.removeItem("signupVerified");
}

function isOAuthUser(user: {
  identities?: Array<{ provider?: string }> | null;
  app_metadata?: Record<string, unknown>;
}): boolean {
  const identityProvider = user.identities?.some(
    (identity) => identity.provider === "google" || identity.provider === "kakao",
  );
  const primaryProvider = user.app_metadata?.provider;
  return Boolean(identityProvider || primaryProvider === "google" || primaryProvider === "kakao");
}

function getOAuthDisplayName(metadata: Record<string, unknown>): string {
  const name = metadata.full_name ?? metadata.name ?? metadata.user_name;
  return typeof name === "string" ? name : "";
}
// ============= HQ 전용 기본정보 화면 =============
function HQSignupProfile() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    companyEmail: "",
    name: "",
    phone: "",
  });
  // 비밀번호는 sessionStorage에 저장하지 않음 (보안상 이유로 React state에서만 유지)
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [role, setRole] = useState<"hq" | "owner" | "staff" | null>(null);
  const [emailAlreadyRegistered, setEmailAlreadyRegistered] = useState(false);

  // owner/staff 전용: 간단한 프로필 폼
  const [ownerStaffFormData, setOwnerStaffFormData] = useState({
    email: "",
    name: "",
    phone: "",
  });
  // 비밀번호는 sessionStorage에 저장하지 않음 (React state에서만 유지)
  const [ownerStaffPassword, setOwnerStaffPassword] = useState("");
  const [ownerStaffPasswordConfirm, setOwnerStaffPasswordConfirm] = useState("");

  // HQ 전용: 회사 이메일 인증
  const [emailVerificationSent, setEmailVerificationSent] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);

  // HQ 전용: 프랜차이즈 확인
  const [franchiseConfirmation, setFranchiseConfirmation] = useState<{
    domain: string;
    name: string;
    id: string;
  } | null>(null);
  const [franchiseConfirmed, setFranchiseConfirmed] = useState(false);
  const [franchiseNotFound, setFranchiseNotFound] = useState(false);
  const [isOAuthSignup, setIsOAuthSignup] = useState(false);

  // 역할 확인 (role 없으면 리다이렉트, 있으면 계속)
  useLayoutEffect(() => {
    const savedRole = sessionStorage.getItem("signupRole");
    if (!savedRole || !["hq", "owner", "staff"].includes(savedRole)) {
      router.push("/signup/role");
      return;
    }
  }, [router]);

  // 페이지 로드 시 sessionStorage에서 저장된 상태 복구 (state update)
  useLayoutEffect(() => {
    // role 확인
    const savedRole = sessionStorage.getItem("signupRole") as "hq" | "owner" | "staff" | null;
    if (savedRole) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRole(savedRole);
    }

    if (savedRole === "hq") {
      // HQ: 이전에 입력한 개인정보 복구 (password 제외)
      const savedProfile = sessionStorage.getItem("signupHQProfile");
      if (savedProfile) {
        try {
          const profile = JSON.parse(savedProfile);
          // password와 passwordConfirm은 복구하지 않음
          const { password: _, passwordConfirm: __, ...profileData } = profile;
          setFormData(profileData);
          // 이메일이 있으면 인증 완료 상태로 표시
          if (profileData.companyEmail) {
            setEmailVerified(true);
          }
        } catch (e) {
          console.error("프로필 데이터 로드 실패:", e);
        }
      }

      // 이전에 확인한 프랜차이즈 정보 복구
      const savedFranchise = sessionStorage.getItem("signupFranchise");
      const savedConfirmed = sessionStorage.getItem("signupFranchiseConfirmed");
      if (savedFranchise) {
        try {
          const franchise = JSON.parse(savedFranchise);
          setFranchiseConfirmation(franchise);
          // 이전에 확인된 프랜차이즈라면 상태 복구
          if (savedConfirmed === "true") {
            setFranchiseConfirmed(true);
          }
        } catch (e) {
          console.error("프랜차이즈 정보 로드 실패:", e);
        }
      }
    } else if (savedRole === "owner" || savedRole === "staff") {
      // owner/staff: 이전에 입력한 개인정보 복구 (password 제외)
      const savedProfile = sessionStorage.getItem("signupProfile");
      if (savedProfile) {
        try {
          const profile = JSON.parse(savedProfile);
          // password와 passwordConfirm은 복구하지 않음
          const { password: _, passwordConfirm: __, ...profileData } = profile;
          setOwnerStaffFormData(profileData);
        } catch (e) {
          console.error("프로필 데이터 로드 실패:", e);
        }
      }
    }
  }, []);

  // HQ 폼데이터 변경 시 sessionStorage에 저장 (password 제외)
  useEffect(() => {
    if (formData.name || formData.phone) {
      sessionStorage.setItem("signupHQProfile", JSON.stringify(formData));
    }
  }, [formData]);

  // OAuth 사용자 자동 채우기
  useEffect(() => {
    const loadOAuthUser = async () => {
      const supabase = createClient();
      const { data, error } = await supabase.auth.getUser();
      const user = data.user;

      if (error || !user || !isOAuthUser(user) || !user.email) return;

      const name = getOAuthDisplayName(user.user_metadata);
      setIsOAuthSignup(true);
      setEmailVerified(true);
      setFormData((current) => ({
        ...current,
        companyEmail: user.email ?? current.companyEmail,
        name: current.name || name,
        password: "",
        passwordConfirm: "",
      }));

      const { domain, franchise } = await getFranchiseByEmail(user.email);
      if (franchise) {
        setFranchiseConfirmation({ domain, name: franchise.name, id: franchise.id });
        setFranchiseNotFound(false);
      } else {
        setFranchiseConfirmation(null);
        setFranchiseNotFound(true);
      }
    };

    void loadOAuthUser();
  }, []);

  // Owner/Staff 폼데이터 변경 시 sessionStorage에 저장 (password 제외)
  useEffect(() => {
    if (ownerStaffFormData.name || ownerStaffFormData.phone) {
      sessionStorage.setItem("signupProfile", JSON.stringify(ownerStaffFormData));
    }
  }, [ownerStaffFormData]);

  const isValidEmail = (email: string): boolean => {
    return email.includes("@") && email.length > 0;
  };

  const handleCompanyEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, companyEmail: e.target.value });
    setEmailVerificationSent(false);
    setVerificationCode("");
    setVerificationError("");
    setEmailVerified(false);
    setFranchiseConfirmation(null);
    setFranchiseConfirmed(false);
    setFranchiseNotFound(false);
    setErrors({ ...errors, companyEmail: "" });

    // 이전 이메일의 인증 정보도 sessionStorage에서 제거
    sessionStorage.removeItem("signupVerified");
    sessionStorage.removeItem("signupFranchise");
    sessionStorage.removeItem("signupFranchiseConfirmed");
  };

  const handleSendVerificationCode = async () => {
    if (!isValidEmail(formData.companyEmail)) {
      setVerificationError("올바른 이메일 주소를 입력해주세요.");
      return;
    }

    const normalizedEmail = normalizeEmail(formData.companyEmail);

    // 개발 환경: 등록된 테스트 이메일만 mock 발송 허용
    if (typeof window !== "undefined" && process.env.NODE_ENV === "development" && DEV_TEST_EMAILS.some((email) => normalizeEmail(email) === normalizedEmail)) {
      setIsSendingVerification(true);
      setVerificationError("");
      setTimeout(() => {
        setEmailVerificationSent(true);
        setIsSendingVerification(false);
      }, 600);
      return;
    }

    // 실제 이메일 발송 API 사용
    setIsSendingVerification(true);
    setVerificationError("");

    try {
      const response = await fetch("/api/auth/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.companyEmail }),
      });
      const data = (await response.json()) as { sent?: boolean; error?: string };

      if (!response.ok || !data.sent) {
        throw new Error(data.error || "인증번호 발송 중 오류가 발생했습니다.");
      }

      setEmailVerificationSent(true);
      setEmailVerified(false);
      setVerificationCode("");
    } catch {
      setVerificationError("인증번호 발송 중 오류가 발생했습니다.");
    } finally {
      setIsSendingVerification(false);
    }
  };

  const handleVerifyCode = async () => {
    const normalizedCode = verificationCode.trim();
    const normalizedEmail = normalizeEmail(formData.companyEmail);
    setEmailVerified(false);

    if (!normalizedCode || normalizedCode.length < 6) {
      setVerificationError("인증번호를 정확히 입력해주세요.");
      return;
    }

    // 개발 환경 + 등록된 테스트 이메일일 때만 테스트 인증번호를 허용
    const isDevTestEmail =
      typeof window !== "undefined" && process.env.NODE_ENV === "development" && DEV_TEST_EMAILS.some((email) => normalizeEmail(email) === normalizedEmail);

    // 등록된 테스트 이메일은 오직 지정된 테스트 인증번호로만 통과될 수 있다(일반 경로로 폴백하지 않음)
    if (isDevTestEmail) {
      if (normalizedCode !== DEV_TEST_VERIFICATION_CODE) {
        setVerificationError("인증번호가 일치하지 않습니다.");
        return;
      }

      setIsVerifying(true);
      setVerificationError("");

      setTimeout(() => {
        setEmailVerified(true);
        sessionStorage.setItem("signupVerified", "true");

        // DEV 테스트 이메일 인증 성공
        // 이메일 인증과 본사 직원 확인은 별개의 절차
        // 인증 성공 직후에는 franchiseConfirmation을 설정하지만
        // 사용자 확인을 거쳐야 franchiseConfirmed=true가 된다
        const franchise = DEV_TEST_EMAIL_FRANCHISE_MAP[normalizedEmail];
        if (franchise) {
          setFranchiseConfirmation({
            domain: franchise.name.toLowerCase().replace(/\s+/g, "-"),
            name: franchise.name,
            id: franchise.id,
          });
          // 이메일 인증 성공 ≠ 본사 직원 확인
          // 사용자가 "맞습니다"를 클릭할 때까지 franchiseConfirmed = false
          setFranchiseConfirmed(false);
          // 이전 confirmation 상태 제거 (반복 가입 시 자동 통과 방지)
          sessionStorage.removeItem("signupFranchiseConfirmed");
          setFranchiseNotFound(false);
        } else {
          setFranchiseNotFound(true);
          setFranchiseConfirmation(null);
        }

        setIsVerifying(false);
      }, 600);
      return;
    }

    // 테스트 인증번호는 등록된 테스트 이메일에서만 유효하다(미등록 이메일의 우회 방지, fail closed)
    if (normalizedCode === DEV_TEST_VERIFICATION_CODE) {
      setVerificationError("인증번호가 일치하지 않습니다.");
      return;
    }

    // 일반 이메일: /api/auth/verify-code 호출
    setIsVerifying(true);
    setVerificationError("");

    try {
      const response = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.companyEmail, code: verificationCode }),
      });
      const data = (await response.json()) as { verified?: boolean; error?: string };

      if (!response.ok || !data.verified) {
        throw new Error(data.error || "인증번호가 일치하지 않습니다.");
      }

      setEmailVerified(true);
      sessionStorage.setItem("signupVerified", "true");

      const { domain, franchise } = await getFranchiseByEmail(formData.companyEmail);

      if (franchise) {
        setFranchiseConfirmation({
          domain,
          name: franchise.name,
          id: franchise.id,
        });
        setFranchiseNotFound(false);
      } else {
        setFranchiseNotFound(true);
        setFranchiseConfirmation(null);
      }
    } catch {
      setVerificationError("인증번호가 일치하지 않거나 만료되었습니다.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleConfirmFranchise = () => {
    if (franchiseConfirmation) {
      setFranchiseConfirmed(true);
      sessionStorage.setItem(
        "signupFranchise",
        JSON.stringify(franchiseConfirmation)
      );
      // 다른 필드 입력 시에도 프랜차이즈 정보가 유지되도록 보장
      sessionStorage.setItem("signupFranchiseConfirmed", "true");
    }
  };

  const handleRetryFranchise = () => {
    setEmailVerified(false);
    setFranchiseConfirmation(null);
    setFranchiseConfirmed(false);
    setFranchiseNotFound(false);
    setVerificationCode("");
    setVerificationError("");
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.companyEmail) {
      newErrors.companyEmail = "회사 이메일을 입력해주세요";
    } else if (!formData.companyEmail.includes("@")) {
      newErrors.companyEmail = "올바른 이메일 형식이 아닙니다";
    }

    if (!emailVerified) {
      newErrors.companyEmail =
        newErrors.companyEmail || "이메일 인증이 필요합니다";
    }

    // franchiseConfirmation이 있으면 프랜차이즈가 이미 확인된 것
    // state 동기화 문제를 피하기 위해 sessionStorage에서 직접 확인
    const savedFranchiseConfirmed = sessionStorage.getItem("signupFranchiseConfirmed");
    if (!savedFranchiseConfirmed || savedFranchiseConfirmed !== "true") {
      newErrors.franchise = "프랜차이즈 확인이 필요합니다";
    }

    if (!formData.name) {
      newErrors.name = "이름을 입력해주세요";
    } else if (formData.name.length < 2) {
      newErrors.name = "이름은 2글자 이상이어야 합니다";
    }

    if (!formData.phone) {
      newErrors.phone = "연락처를 입력해주세요";
    } else if (formData.phone.replace(/[^0-9]/g, "").length < 10) {
      newErrors.phone = "올바른 연락처 형식이 아닙니다";
    }

    if (!isOAuthSignup && !password) {
      newErrors.password = "비밀번호를 입력해주세요";
    } else if (!isOAuthSignup && password.length < 8) {
      newErrors.password = "비밀번호는 8글자 이상이어야 합니다";
    }

    if (!isOAuthSignup && password !== passwordConfirm) {
      newErrors.passwordConfirm = "비밀번호가 일치하지 않습니다";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // HQ 폼 완성 여부를 판단 (state 변경 없이 사용 가능)
  const isHQFormComplete = () => {
    // 1. 이메일 인증 확인
    if (!emailVerified) {
      return false;
    }

    // 2. 프랜차이즈 확인 (React state 사용)
    if (!franchiseConfirmed) {
      return false;
    }

    // 3. 이름 검증 (2글자 이상)
    if (!formData.name || formData.name.trim().length < 2) {
      return false;
    }

    // 4. 연락처 검증 (비숫자 제거 후 10자 이상)
    if (!formData.phone || formData.phone.replace(/[^0-9]/g, "").length < 10) {
      return false;
    }

    // 5. 비밀번호 검증 (8글자 이상)
    if (!password || password.length < 8) {
      return false;
    }

    // 6. 비밀번호 확인 검증
    if (password !== passwordConfirm) {
      return false;
    }

    return true;
  };

  const handleContinue = async () => {
    // 기본 validation
    if (!validateForm()) return;

    // sessionStorage 데이터 확인 - state 비동기 업데이트 문제 해결
    const savedFranchise = sessionStorage.getItem("signupFranchise");
    const savedFranchiseConfirmed = sessionStorage.getItem("signupFranchiseConfirmed");

    if (!savedFranchise || savedFranchiseConfirmed !== "true") {
      setErrors({ franchise: "프랜차이즈 확인이 필요합니다" });
      return;
    }

    // 사용자가 입력한 데이터 저장 (임시 회원가입 상태)
    sessionStorage.setItem("signupHQProfile", JSON.stringify(formData));

    // 프랜차이즈 정보도 저장 (완료 화면에서 사용)
    try {
      const franchise = JSON.parse(savedFranchise);
      if (franchise && franchise.name) {
        sessionStorage.setItem("signupFranchiseName", franchise.name);
      }
    } catch (e) {
      console.error("프랜차이즈 정보 파싱 실패:", e);
    }

    // 실제 등록된 계정 정보 저장 (hq/communication 등에서 사용)
    try {
      const accountsJson = sessionStorage.getItem("registeredAccounts");
      const registeredAccounts = accountsJson ? JSON.parse(accountsJson) : [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingIndex = registeredAccounts.findIndex(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (acc: any) => acc.companyEmail === formData.companyEmail && acc.role === "hq"
      );

      // 프랜차이즈 정보 추가
      let franchiseName = "";
      try {
        const franchise = JSON.parse(savedFranchise);
        franchiseName = franchise.name || "";
      } catch (e) {
        console.error("프랜차이즈 정보 파싱 실패:", e);
      }

      const newAccount = {
        ...formData,
        role: "hq",
        franchiseName: franchiseName,
        registeredAt: new Date().toISOString(),
      };

      if (existingIndex >= 0) {
        registeredAccounts[existingIndex] = newAccount;
      } else {
        registeredAccounts.push(newAccount);
      }

      sessionStorage.setItem("registeredAccounts", JSON.stringify(registeredAccounts));
    } catch (e) {
      console.error("등록된 계정 저장 실패:", e);
    }

    // 로딩 상태 설정
    setIsLoading(true);

    if (isOAuthSignup) {
      try {
        const franchise = JSON.parse(savedFranchise) as { id?: string };
        const response = await fetch("/api/auth/oauth-onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "hq",
            name: formData.name,
            phone: formData.phone,
            brandId: franchise.id,
          }),
        });
        const data = (await response.json()) as { userId?: string; error?: string };

        if (!response.ok || !data.userId) {
          throw new Error(data.error || "SNS 프로필 생성에 실패했습니다.");
        }

        clearSignupSessionStorage();
        router.push("/hq");
      } catch (error) {
        setErrors({
          form: error instanceof Error ? error.message : "SNS 프로필 생성에 실패했습니다.",
        });
        setIsLoading(false);
      }
      return;
    }

    // DEV 테스트 이메일: signInWithPassword로 기존 계정 재사용
    const normalizedEmail = normalizeEmail(formData.companyEmail);
    const isDevTestEmail = typeof window !== "undefined" && process.env.NODE_ENV === "development" && DEV_TEST_EMAILS.some((email) => normalizeEmail(email) === normalizedEmail);

    if (isDevTestEmail) {
      try {
        const supabase = createClient();
        const { data: authData, error: authError } =
          await supabase.auth.signInWithPassword({
            email: formData.companyEmail,
            password: DEV_TEST_PASSWORD,
          });

        if (authError) {
          setIsLoading(false);
          console.error("Test account signIn error:", authError);
          setErrors({
            companyEmail: `테스트 계정 로그인 실패: ${authError.message || "알 수 없는 오류"}`,
          });
          return;
        }

        if (!authData.user || !authData.session) {
          setIsLoading(false);
          setErrors({
            companyEmail: "테스트 계정 세션을 확보할 수 없습니다.",
          });
          return;
        }

        // HQ 테스트 계정 로그인 성공
        setIsLoading(false);
        await new Promise(resolve => setTimeout(resolve, 50));
        router.push("/signup/complete");
      } catch (e) {
        setIsLoading(false);
        console.error("테스트 계정 처리 중 오류:", e);
        setErrors({ companyEmail: "회원가입 중 오류가 발생했습니다." });
      }
      return;
    }

    // 일반 이메일: /api/auth/signup API 사용
    try {
      const franchise = JSON.parse(savedFranchise) as { id?: string };
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyEmail: formData.companyEmail,
          password: password,
          name: formData.name,
          phone: formData.phone,
          role: "hq",
          brandId: franchise.id,
        }),
      });
      const data = (await response.json()) as { userId?: string; error?: string; detail?: string; code?: string };

      if (data.code === "email_exists") {
        setEmailAlreadyRegistered(true);
        setErrors({ form: data.error || "이미 가입된 이메일입니다. 로그인해 주세요." });
        setIsLoading(false);
        return;
      }

      if (!response.ok || !data.userId) {
        throw new Error(data.detail || data.error || "회원가입 중 오류가 발생했습니다.");
      }

      // 가입 직후 세션이 이미 발급되므로 재로그인 없이 매뉴얼 온보딩으로 이동한다.
      router.push("/hq/manuals/onboarding");
    } catch (e) {
      console.error("회원가입 실패:", e);
      setEmailAlreadyRegistered(false);
      setErrors({
        form: e instanceof Error ? e.message : "회원가입 중 오류가 발생했습니다.",
      });
      setIsLoading(false);
    }
  };

  const handlePrevious = () => {
    router.push("/signup/terms");
  };

  // owner/staff용 검증
  const validateOwnerStaffForm = () => {
    const newErrors: Record<string, string> = {};

    if (!ownerStaffFormData.email) {
      newErrors.email = "이메일을 입력해주세요";
    } else if (!ownerStaffFormData.email.includes("@")) {
      newErrors.email = "올바른 이메일 형식이 아닙니다";
    }

    if (!ownerStaffFormData.name) {
      newErrors.name = "이름을 입력해주세요";
    } else if (ownerStaffFormData.name.length < 2) {
      newErrors.name = "이름은 2글자 이상이어야 합니다";
    }

    if (!ownerStaffPassword) {
      newErrors.password = "비밀번호를 입력해주세요";
    } else if (ownerStaffPassword.length < 8) {
      newErrors.password = "비밀번호는 8글자 이상이어야 합니다";
    }

    if (ownerStaffPassword !== ownerStaffPasswordConfirm) {
      newErrors.passwordConfirm = "비밀번호가 일치하지 않습니다";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // owner/staff용 계속하기
  const handleContinueOwnerStaff = async () => {
    if (!validateOwnerStaffForm()) return;

    setIsLoading(true);

    try {
      const supabase = createClient();

      if (process.env.NODE_ENV === "development") {
        console.log("🔗 [DEV] Email Auth Link / Token:", {
          email: ownerStaffFormData.email,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          inbucketUrl: "http://localhost:54324",
          note: "Supabase 로컬 개발 환경에서는 Inbucket에서 실제 인증 메일 링크를 확인하세요.",
        });
        void fetch("/api/auth/dev-email-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: "signup-profile signUp",
            email: ownerStaffFormData.email,
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          }),
        });
      }

      // Supabase Auth 사용자 생성
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: ownerStaffFormData.email,
        password: ownerStaffPassword,
        options: {
          data: {
            role: role || "owner",
            name: ownerStaffFormData.name,
          }
        }
      });

      if (authError) {
        setIsLoading(false);
        if (authError.message?.includes("already registered")) {
          setErrors({ email: "이미 등록된 이메일입니다." });
        } else {
          setErrors({ email: authError.message || "회원가입 중 오류가 발생했습니다." });
        }
        return;
      }

      // user와 session이 모두 있는지 확인
      if (!authData.user) {
        setIsLoading(false);
        setErrors({ email: "사용자 생성에 실패했습니다." });
        return;
      }

      if (!authData.session) {
        setIsLoading(false);
        setErrors({ email: "로그인 세션을 생성할 수 없습니다. Supabase 이메일 설정을 확인해주세요." });
        return;
      }

      // signupProfile에 저장 (approval 페이지에서 사용)
      sessionStorage.setItem(
        "signupProfile",
        JSON.stringify(ownerStaffFormData)
      );

      // 약간의 지연 후 다음 페이지로
      await new Promise(resolve => setTimeout(resolve, 50));
      router.push("/signup/stores");
    } catch (e) {
      setIsLoading(false);
      console.error("Auth 사용자 생성 실패:", e);
      setErrors({ email: "회원가입 중 오류가 발생했습니다." });
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      {/* Header */}
      <header className="relative border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
        <div className="flex items-center justify-between px-5 sm:px-8 lg:px-12 xl:px-16 h-16 lg:h-[68px]">
          <button
            onClick={handlePrevious}
            className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors flex-shrink-0 bg-none border-none cursor-pointer"
          >
            <ChevronLeft size={24} className="flex-shrink-0" />
            <span className="text-base sm:text-lg lg:text-[17px] font-semibold hidden sm:inline">이전</span>
            <span className="text-base font-semibold sm:hidden">이전</span>
          </button>

          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex-shrink-0">
            <img
              src="/logo/ilitda-wordmark.png"
              alt="일잇다"
              className="w-[76px] sm:w-[88px] lg:w-[100px] h-auto object-contain"
            />
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <span className="text-base sm:text-lg lg:text-[17px] font-semibold text-[var(--color-text-secondary)]">
              {role === "hq" ? "3 / 3" : "3 / 5"}
            </span>
            <div className="w-20 sm:w-28 h-2 bg-[var(--color-border-light)] rounded-full overflow-hidden flex-shrink-0">
              <div className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-300" style={{ width: role === "hq" ? "100%" : "60%" }} />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center py-12 sm:py-16 lg:py-20 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-6xl">
          {/* Title Section */}
          <div className="mb-6 sm:mb-8 lg:mb-10 text-center">
            <h1 className="mb-4 sm:mb-5 lg:mb-6 font-bold text-[var(--color-text-primary)]" style={{ fontSize: "clamp(32px, 2.5vw, 42px)", fontWeight: 800 }}>
              {role === "hq" ? "기본 정보를 입력해주세요" : "프로필 정보를 입력해주세요"}
            </h1>
            <p className="text-[var(--color-text-secondary)]" style={{ fontSize: "clamp(16px, 1.2vw, 20px)" }}>
              {role === "hq" ? "본사 직원 인증을 위해 회사 이메일을 확인해주세요." : "회원가입을 위해 기본 정보를 입력해주세요."}
            </p>
          </div>

          {/* HQ Form */}
          {role === "hq" && (
            <>
              {/* Form Container */}
              <div className="mx-auto w-full max-w-[860px]">
                <form>
                  {/* Company Email */}
                  <div className="mb-6">
                    <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                      본사 직원 이메일
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_156px] gap-3.5 w-full">
                      <Input
                        type="email"
                        placeholder="회사 이메일을 입력해주세요"
                        value={formData.companyEmail}
                        onChange={handleCompanyEmailChange}
                    error={errors.companyEmail || verificationError}
                    className="h-[72px]"
                    disabled={isOAuthSignup || (emailVerified && formData.companyEmail.length > 0)}
                  />
                  {!isOAuthSignup && (
                  <button
                    type="button"
                    onClick={handleSendVerificationCode}
                    disabled={isSendingVerification || !isValidEmail(formData.companyEmail) || emailVerified}
                    className={`h-[72px] rounded-lg border-2 font-semibold text-sm sm:text-base transition-all duration-200 flex items-center justify-center whitespace-nowrap ${
                      isSendingVerification || !isValidEmail(formData.companyEmail) || emailVerified
                        ? "border-[var(--color-border-light)] text-[var(--color-text-secondary)] bg-white cursor-not-allowed opacity-60"
                        : "border-[var(--color-primary)] text-[var(--color-primary)] bg-white hover:bg-[var(--color-primary-light)]/20"
                    }`}
                  >
                    {isSendingVerification ? "발송 중..." : "인증번호 받기"}
                  </button>
                  )}
                </div>

                {/* Email Verification Notification */}
                {emailVerificationSent && !emailVerified && (
                  <div className="mt-5 mb-5 p-4 bg-[var(--color-primary-light)]/30 border border-[var(--color-primary)]/20 rounded-lg">
                    <p className="text-sm sm:text-base text-[var(--color-text-secondary)]">
                      입력하신 이메일로 인증번호를 보냈습니다.
                    </p>
                  </div>
                )}

                {/* Verification Code Input */}
                {emailVerificationSent && !emailVerified && (
                  <div className="mb-8">
                    <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                      인증번호
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_156px] gap-3.5 w-full">
                      <Input
                        type="text"
                        placeholder="인증번호 6자리 입력"
                        value={verificationCode}
                        onChange={(e) => {
                          setVerificationCode(e.target.value.slice(0, 6));
                          setVerificationError("");
                        }}
                        error={verificationError}
                        className="h-[72px]"
                      />
                      <button
                        type="button"
                        onClick={handleVerifyCode}
                        disabled={isVerifying || verificationCode.length < 6}
                        className={`h-[72px] rounded-lg border-2 font-semibold text-sm sm:text-base transition-all duration-200 flex items-center justify-center whitespace-nowrap ${
                          isVerifying || verificationCode.length < 6
                            ? "border-[var(--color-border-light)] text-[var(--color-text-secondary)] bg-white cursor-not-allowed opacity-60"
                            : "border-[var(--color-primary)] text-[var(--color-primary)] bg-white hover:bg-[var(--color-primary-light)]/20"
                        }`}
                      >
                        {isVerifying ? "확인 중..." : "인증 확인"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Email Verified Success */}
                {emailVerified && !franchiseConfirmed && !franchiseNotFound && (
                  <div className="flex items-center gap-2 mt-2.5 text-sm sm:text-base">
                    <div className="w-5 h-5 rounded-full bg-[var(--color-primary)] flex items-center justify-center flex-shrink-0">
                      <Check size={14} className="text-white" strokeWidth={3} />
                    </div>
                    <span className="text-[var(--color-primary)] font-medium">
                      이메일 인증이 완료되었습니다.
                    </span>
                  </div>
                )}
              </div>

              {/* Franchise Confirmation */}
              {emailVerified && franchiseConfirmation && !franchiseConfirmed && (
                <div className="mb-8 p-6 sm:p-8 border border-[var(--color-primary)]/20 rounded-[12px] bg-white">
                  <div className="text-center mb-6">
                    {/* Franchise Logo/Icon */}
                    <div className="flex justify-center mb-4">
                      <div className="p-3 bg-[var(--color-primary-light)] rounded-lg">
                        <Building2 size={32} className="text-[var(--color-primary)]" />
                      </div>
                    </div>

                    <h3 className="text-lg sm:text-xl font-bold text-[var(--color-text-primary)] mb-4">
                      {franchiseConfirmation.name}
                    </h3>
                    <p className="text-sm sm:text-base text-[var(--color-text-secondary)] mb-2">
                      {franchiseConfirmation.name} 본사 직원이 맞나요?
                    </p>
                  </div>

                  <div className="flex gap-3 justify-center">
                    <button
                      type="button"
                      onClick={handleRetryFranchise}
                      className="px-6 py-3 border border-[var(--color-primary)] rounded-lg font-semibold text-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-colors"
                    >
                      다시 확인
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmFranchise}
                      className="px-6 py-3 bg-[var(--color-primary)] text-white rounded-lg font-semibold hover:bg-[var(--color-primary-hover)] transition-colors"
                    >
                      확인
                    </button>
                  </div>
                </div>
              )}

              {/* Franchise Confirmation Completed */}
              {emailVerified && franchiseConfirmation && franchiseConfirmed && (
                <div className="mb-8 p-6 sm:p-8 border border-[var(--color-primary)]/20 rounded-[12px] bg-white">
                  <div className="text-center">
                    {/* Check Icon */}
                    <div className="flex justify-center mb-4">
                      <div className="p-3 bg-[var(--color-primary)] rounded-full">
                        <Check size={32} className="text-white" />
                      </div>
                    </div>

                    <h3 className="text-lg sm:text-xl font-bold text-[var(--color-text-primary)] mb-4">
                      본사 직원 확인 완료
                    </h3>

                    <p className="text-sm sm:text-base font-bold text-[var(--color-text-primary)] mb-1">
                      {franchiseConfirmation.name}
                    </p>

                    <p className="text-sm sm:text-base text-[var(--color-text-secondary)]">
                      {franchiseConfirmation.name} 본사 직원으로 확인되었습니다.
                    </p>
                  </div>
                </div>
              )}

              {/* Franchise Not Found */}
              {franchiseNotFound && (
                <div className="mb-8 p-6 sm:p-8 border border-red-200 rounded-[12px] bg-red-50">
                  <div className="text-center">
                    <h4 className="text-base sm:text-lg font-bold text-red-600 mb-2">
                      등록된 프랜차이즈 정보를 찾을 수 없습니다.
                    </h4>
                    <p className="text-sm text-red-600 mb-4">
                      입력한 회사 이메일을 다시 확인해주세요.
                    </p>
                    <button
                      type="button"
                      onClick={handleRetryFranchise}
                      className="px-6 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-colors"
                    >
                      다시 입력
                    </button>
                  </div>
                </div>
              )}

              {/* Name */}
              <div className="mb-6">
                <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                  이름
                </label>
                <Input
                  type="text"
                  placeholder="예: 홍길동"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  error={errors.name}
                />
              </div>

              {/* Phone */}
              <div className="mb-6">
                <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                  연락처
                </label>
                <Input
                  type="tel"
                  placeholder="010-0000-0000"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  error={errors.phone}
                />
              </div>

              {!isOAuthSignup && (<>
              {/* Password */}
              <div className="mb-6">
                <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                  비밀번호
                </label>
                <PasswordInput
                  placeholder="8글자 이상 입력해주세요"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={errors.password}
                />
              </div>

              {/* Password Confirm */}
              <div className="mb-8">
                <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                  비밀번호 확인
                </label>
                <PasswordInput
                  placeholder="비밀번호를 다시 입력해주세요"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  error={errors.passwordConfirm}
                />
              </div>
              </>)}

              {errors.form && (
                <div className="mb-4 text-center">
                  <p className="text-sm text-[var(--color-status-error)]">{errors.form}</p>
                  {emailAlreadyRegistered && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => router.push("/")}
                      className="mt-2"
                    >
                      로그인하러 가기
                    </Button>
                  )}
                </div>
              )}

              {/* Next Button */}
              <div className="flex justify-center pt-8">
                <Button
                  onClick={handleContinue}
                  disabled={isLoading || !isHQFormComplete()}
                  variant="primary"
                  size="lg"
                  className="w-full sm:w-auto min-h-14 lg:min-h-16 px-8 lg:px-12 text-lg lg:text-xl font-semibold"
                >
                  다음
                </Button>
              </div>
            </form>
          </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============= 점주/직원 기본정보 화면 =============
function OwnerStaffSignupProfile() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    phone: "",
  });
  // 비밀번호는 sessionStorage에 저장하지 않음 (보안상 이유로 React state에서만 유지)
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);

  // Email verification states
  const [emailDuplicateChecked, setEmailDuplicateChecked] = useState(false);
  const [emailDuplicateError, setEmailDuplicateError] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailVerificationSent, setEmailVerificationSent] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isOAuthSignup, setIsOAuthSignup] = useState(false);

  // 페이지 로드 시 sessionStorage에서 저장된 데이터 복원
  useEffect(() => {
    const savedProfile = sessionStorage.getItem("signupProfile");
    if (savedProfile) {
      try {
        const profile = JSON.parse(savedProfile);
        // password와 passwordConfirm은 복구하지 않음
        const { password: _, passwordConfirm: __, ...profileData } = profile;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFormData(profileData);
        // 이메일이 있으면 중복 확인 완료 상태로 표시
        if (profileData.email) {
          setEmailDuplicateChecked(true);
          setEmailVerified(true);
        }
      } catch (e) {
        console.error("프로필 데이터 로드 실패:", e);
      }
    }
  }, []);

  useEffect(() => {
    const loadOAuthUser = async () => {
      const supabase = createClient();
      const { data, error } = await supabase.auth.getUser();
      const user = data.user;

      if (error || !user || !isOAuthUser(user) || !user.email) return;

      setIsOAuthSignup(true);
      setEmailDuplicateChecked(true);
      setEmailVerified(true);
      setFormData((current) => ({
        ...current,
        email: user.email ?? current.email,
        name: current.name || getOAuthDisplayName(user.user_metadata),
        password: "",
        passwordConfirm: "",
      }));
    };

    void loadOAuthUser();
  }, []);

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, email: e.target.value });
    setEmailDuplicateChecked(false);
    setEmailDuplicateError("");
    setEmailVerified(false);
    setEmailVerificationSent(false);
    setVerificationCode("");
    setVerificationError("");
    setErrors({ ...errors, email: "" });
    sessionStorage.removeItem("signupVerified");
  };

  const isValidEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  };

  const handleCheckEmailDuplicate = async () => {
    if (!isValidEmail(formData.email)) {
      setEmailDuplicateError("올바른 이메일 주소를 입력해주세요.");
      return;
    }

    setIsCheckingDuplicate(true);
    setEmailDuplicateError("");

    try {
      const response = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.email }),
      });
      const data = (await response.json()) as { available?: boolean; error?: string };

      if (!response.ok) {
        throw new Error(data.error || "중복 확인 중 오류가 발생했습니다.");
      }

      if (!data.available) {
        setEmailDuplicateChecked(false);
        setEmailDuplicateError("이미 가입된 이메일입니다.");
        return;
      }

      setEmailDuplicateChecked(true);
      setEmailDuplicateError("");
    } catch {
      setEmailDuplicateError("중복 확인 중 오류가 발생했습니다.");
    } finally {
      setIsCheckingDuplicate(false);
    }
  };

  const handleSendVerificationCode = async () => {
    if (!emailDuplicateChecked) {
      setVerificationError("이메일 중복 확인을 먼저 진행해주세요.");
      return;
    }

    setIsSendingVerification(true);
    setVerificationError("");

    try {
      const response = await fetch("/api/auth/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.email }),
      });
      const data = (await response.json()) as { sent?: boolean; error?: string };

      if (!response.ok || !data.sent) {
        throw new Error(data.error || "인증번호 발송 중 오류가 발생했습니다.");
      }

      setEmailVerificationSent(true);
      setEmailVerified(false);
      setVerificationCode("");
    } catch {
      setVerificationError("인증번호 발송 중 오류가 발생했습니다.");
    } finally {
      setIsSendingVerification(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!verificationCode || verificationCode.length < 6) {
      setVerificationError("인증번호를 정확히 입력해주세요.");
      return;
    }

    setIsVerifying(true);
    setVerificationError("");

    try {
      const response = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.email, code: verificationCode }),
      });
      const data = (await response.json()) as { verified?: boolean; error?: string };

      if (!response.ok || !data.verified) {
        throw new Error(data.error || "인증번호가 일치하지 않습니다.");
      }

      setEmailVerified(true);
      setVerificationError("");
      sessionStorage.setItem("signupVerified", "true");
    } catch {
      setVerificationError("인증번호가 일치하지 않거나 만료되었습니다.");
    } finally {
      setIsVerifying(false);
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.email) {
      newErrors.email = "이메일을 입력해주세요";
    } else if (!formData.email.includes("@")) {
      newErrors.email = "올바른 이메일 형식이 아닙니다";
    }

    if (!isOAuthSignup && !emailVerified) {
      newErrors.email = newErrors.email || "이메일 인증이 필요합니다";
    }

    if (!formData.name) {
      newErrors.name = "이름을 입력해주세요";
    } else if (formData.name.length < 2) {
      newErrors.name = "이름은 2글자 이상이어야 합니다";
    }

    if (!formData.phone) {
      newErrors.phone = "연락처를 입력해주세요";
    } else if (formData.phone.replace(/[^0-9]/g, "").length < 10) {
      newErrors.phone = "올바른 연락처 형식이 아닙니다";
    }

    if (!isOAuthSignup && !password) {
      newErrors.password = "비밀번호를 입력해주세요";
    } else if (!isOAuthSignup && password.length < 8) {
      newErrors.password = "비밀번호는 8글자 이상이어야 합니다";
    }

    if (!isOAuthSignup && password !== passwordConfirm) {
      newErrors.passwordConfirm = "비밀번호가 일치하지 않습니다";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinue = async () => {
    if (!validateForm()) return;

    setIsLoading(true);

    if (isOAuthSignup) {
      try {
        const role = sessionStorage.getItem("signupRole");
        const response = await fetch("/api/auth/oauth-onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, name: formData.name, phone: formData.phone }),
        });
        const data = (await response.json()) as { userId?: string; error?: string };

        if (!response.ok || !data.userId) {
          throw new Error(data.error || "SNS 프로필 생성에 실패했습니다.");
        }

        sessionStorage.setItem("signupProfile", JSON.stringify({
          email: formData.email,
          name: formData.name,
          phone: formData.phone,
          role,
        }));
        router.push("/signup/stores");
      } catch (error) {
        setErrors({
          form: error instanceof Error ? error.message : "SNS 프로필 생성에 실패했습니다.",
        });
        setIsLoading(false);
      }
      return;
    }

    setTimeout(() => {
      const profileData = {
        ...formData,
        role: sessionStorage.getItem("signupRole"),
      };

      sessionStorage.setItem("signupProfile", JSON.stringify(profileData));
    sessionStorage.setItem("signupPassword", password);
      console.log("[SIGNUP_STEP3] Saved profile:", profileData);
      setIsLoading(false);
      router.push("/signup/stores");
    }, 800);
  };

  const handlePrevious = () => {
    router.push("/signup/terms");
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      {/* Header */}
      <header className="relative border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
        <div className="flex items-center justify-between px-5 sm:px-8 lg:px-12 xl:px-16 h-16 lg:h-[68px]">
          <button
            onClick={handlePrevious}
            className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors flex-shrink-0 bg-none border-none cursor-pointer"
          >
            <ChevronLeft size={24} className="flex-shrink-0" />
            <span className="text-base sm:text-lg lg:text-[17px] font-semibold hidden sm:inline">이전</span>
            <span className="text-base font-semibold sm:hidden">이전</span>
          </button>

          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex-shrink-0">
            <img
              src="/logo/ilitda-wordmark.png"
              alt="일잇다"
              className="w-[76px] sm:w-[88px] lg:w-[100px] h-auto object-contain"
            />
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <span className="text-base sm:text-lg lg:text-[17px] font-semibold text-[var(--color-text-secondary)]">
              3 / 5
            </span>
            <div className="w-20 sm:w-28 h-2 bg-[var(--color-border-light)] rounded-full overflow-hidden flex-shrink-0">
              <div className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-300" style={{ width: "60%" }} />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center py-12 sm:py-16 lg:py-20 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-6xl">
          {/* Title Section */}
          <div className="mb-6 sm:mb-8 lg:mb-10 text-center">
            <h1 className="mb-4 sm:mb-5 lg:mb-6 font-bold text-[var(--color-text-primary)]" style={{ fontSize: "clamp(32px, 2.5vw, 42px)", fontWeight: 800 }}>
              기본 정보를 입력해주세요
            </h1>
            <p className="text-[var(--color-text-secondary)]" style={{ fontSize: "clamp(16px, 1.2vw, 20px)" }}>
              서비스 이용에 필요한 기본 정보를 입력해주세요.
            </p>
          </div>

          {/* Form Container */}
          <div className="mx-auto w-full max-w-[860px]">
            <form>
              {/* Email with Duplicate Check */}
              <div className="mb-6">
                <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                  이메일
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_156px] gap-3.5 w-full">
                  <Input
                    type="email"
                    placeholder="example@email.com"
                    value={formData.email}
                    onChange={handleEmailChange}
                    error={errors.email || emailDuplicateError}
                    className="h-[72px]"
                    disabled={isOAuthSignup}
                  />
                  {!isOAuthSignup && (
                  <button
                    type="button"
                    onClick={handleCheckEmailDuplicate}
                    disabled={isCheckingDuplicate || !isValidEmail(formData.email)}
                    className={`h-[72px] rounded-lg border-2 font-semibold text-sm sm:text-base transition-all duration-200 flex items-center justify-center whitespace-nowrap ${
                      isCheckingDuplicate || !isValidEmail(formData.email)
                        ? "border-[var(--color-border-light)] text-[var(--color-text-secondary)] bg-white cursor-not-allowed opacity-60"
                        : "border-[var(--color-primary)] text-[var(--color-primary)] bg-white hover:bg-[var(--color-primary-light)]/20"
                    }`}
                  >
                    {isCheckingDuplicate ? "확인 중..." : "중복 확인"}
                  </button>
                  )}
                </div>

                {/* Duplicate Check Success */}
                {emailDuplicateChecked && !emailDuplicateError && !isOAuthSignup && (
                  <div className="flex items-center gap-2 mt-2.5 text-sm sm:text-base">
                    <div className="w-5 h-5 rounded-full bg-[var(--color-primary)] flex items-center justify-center flex-shrink-0">
                      <Check size={14} className="text-white" strokeWidth={3} />
                    </div>
                    <span className="text-[var(--color-primary)] font-medium">
                      사용 가능한 이메일입니다.
                    </span>
                  </div>
                )}

                {/* Send Verification Button */}
                {emailDuplicateChecked && !emailDuplicateError && !emailVerificationSent && !isOAuthSignup && (
                  <button
                    type="button"
                    onClick={handleSendVerificationCode}
                    disabled={isSendingVerification}
                    className="mt-4 w-full sm:w-auto px-6 py-3 bg-[var(--color-primary)] text-white rounded-lg font-semibold hover:bg-[var(--color-primary-hover)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isSendingVerification ? "발송 중..." : "인증번호 받기"}
                  </button>
                )}
              </div>

              {/* Email Verification Message */}
              {emailVerificationSent && !isOAuthSignup && (
                <div className="mt-5 mb-5 p-4 bg-[var(--color-primary-light)]/30 border border-[var(--color-primary)]/20 rounded-lg">
                  <p className="text-sm sm:text-base text-[var(--color-text-secondary)]">
                    입력하신 이메일로 인증번호를 보냈습니다.
                  </p>
                </div>
              )}

              {/* Verification Code Input */}
              {emailVerificationSent && !isOAuthSignup && (
                <div className="mb-8">
                  <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                    인증번호
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_156px] gap-3.5 w-full">
                    <Input
                      type="text"
                      placeholder="인증번호 6자리 입력"
                      value={verificationCode}
                      onChange={(e) => {
                        setVerificationCode(e.target.value.slice(0, 6));
                        setVerificationError("");
                      }}
                      error={verificationError}
                      className="h-[72px]"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyCode}
                      disabled={isVerifying || verificationCode.length < 6}
                      className={`h-[72px] rounded-lg border-2 font-semibold text-sm sm:text-base transition-all duration-200 flex items-center justify-center whitespace-nowrap ${
                        isVerifying || verificationCode.length < 6
                          ? "border-[var(--color-border-light)] text-[var(--color-text-secondary)] bg-white cursor-not-allowed opacity-60"
                          : "border-[var(--color-primary)] text-[var(--color-primary)] bg-white hover:bg-[var(--color-primary-light)]/20"
                      }`}
                    >
                      {isVerifying ? "확인 중..." : "인증 확인"}
                    </button>
                  </div>

                  {/* Verification Success */}
                  {emailVerified && (
                    <div className="flex items-center gap-2 mt-2.5 text-sm sm:text-base">
                      <div className="w-5 h-5 rounded-full bg-[var(--color-primary)] flex items-center justify-center flex-shrink-0">
                        <Check size={14} className="text-white" strokeWidth={3} />
                      </div>
                      <span className="text-[var(--color-primary)] font-medium">
                        이메일 인증이 완료되었습니다.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Name */}
              <div className="mb-6">
                <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                  이름
                </label>
                <Input
                  type="text"
                  placeholder="예: 홍길동"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  error={errors.name}
                />
              </div>

              {/* Phone */}
              <div className="mb-6">
                <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                  연락처
                </label>
                <Input
                  type="tel"
                  placeholder="010-0000-0000"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  error={errors.phone}
                />
              </div>

              {!isOAuthSignup && (<>
              {/* Password */}
              <div className="mb-6">
                <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                  비밀번호
                </label>
                <PasswordInput
                  placeholder="8글자 이상 입력해주세요"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={errors.password}
                />
              </div>

              {/* Password Confirm */}
              <div className="mb-8">
                <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                  비밀번호 확인
                </label>
                <PasswordInput
                  placeholder="비밀번호를 다시 입력해주세요"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  error={errors.passwordConfirm}
                />
              </div>
              </>)}

              {errors.form && (
                <p className="mb-4 text-center text-sm text-[var(--color-status-error)]">
                  {errors.form}
                </p>
              )}

              {/* Next Button */}
              <div className="flex justify-center pt-8">
                <Button
                  type="button"
                  onClick={handleContinue}
                  disabled={isLoading || !emailVerified}
                  variant="primary"
                  size="lg"
                  className="w-full sm:w-auto min-h-14 lg:min-h-16 px-8 lg:px-12 text-lg lg:text-xl font-semibold"
                >
                  다음
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============= 메인 export: 역할별 분기 =============
export default function SignupProfilePage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
    if (!savedRole) {
      router.push("/signup/role");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRole(savedRole);
    setIsLoading(false);
  }, [router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-default)] flex items-center justify-center">
        <p className="text-[var(--color-text-secondary)]">로딩 중...</p>
      </div>
    );
  }

  if (role === "hq") {
    return <HQSignupProfile />;
  }

  return <OwnerStaffSignupProfile />;
}
