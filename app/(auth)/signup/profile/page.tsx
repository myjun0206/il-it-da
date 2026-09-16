"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Check } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input, PasswordInput } from "@/components/common/Input";
import type { UserRole } from "@/lib/types/user";

// Mock franchise domains - 실제 DB/API로 교체 가능
const FRANCHISE_DOMAINS: Record<string, { name: string; id: string }> = {
  "kyochon.com": { name: "교촌치킨", id: "brand_001" },
  "bhc.com": { name: "BHC 치킨", id: "brand_002" },
  "nene.com": { name: "네네치킨", id: "brand_003" },
  "companiongroup.com": { name: "Companion Group", id: "brand_004" },
};

// ============= HQ 전용 기본정보 화면 =============
function HQSignupProfile() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    companyEmail: "",
    name: "",
    phone: "",
    password: "",
    passwordConfirm: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);

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

  // 페이지 로드 시 sessionStorage에서 저장된 프랜차이즈 정보 복구
  useEffect(() => {
    const savedFranchise = sessionStorage.getItem("signupFranchise");
    if (savedFranchise) {
      try {
        const franchise = JSON.parse(savedFranchise);
        setFranchiseConfirmation(franchise);
        setFranchiseConfirmed(true);
        setEmailVerified(true);
      } catch (e) {
        console.error("프랜차이즈 정보 로드 실패:", e);
      }
    }
  }, []);

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
  };

  const handleSendVerificationCode = async () => {
    if (!isValidEmail(formData.companyEmail)) {
      setVerificationError("올바른 이메일 주소를 입력해주세요.");
      return;
    }

    setIsSendingVerification(true);
    setVerificationError("");

    try {
      // TODO: 실제 API 연결
      setTimeout(() => {
        setEmailVerificationSent(true);
        setIsSendingVerification(false);
      }, 600);
    } catch {
      setVerificationError("인증번호 발송 중 오류가 발생했습니다.");
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
      // TODO: 실제 API 연결 - 서버에서 검증 후 도메인 추출
      setTimeout(() => {
        setEmailVerified(true);
        setIsVerifying(false);

        // 도메인 추출
        const domain = formData.companyEmail.split("@")[1].toLowerCase();
        const franchise = FRANCHISE_DOMAINS[domain];

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
      }, 600);
    } catch {
      setVerificationError("인증 확인 중 오류가 발생했습니다.");
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

    if (!franchiseConfirmed) {
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

    if (!formData.password) {
      newErrors.password = "비밀번호를 입력해주세요";
    } else if (formData.password.length < 8) {
      newErrors.password = "비밀번호는 8글자 이상이어야 합니다";
    }

    if (formData.password !== formData.passwordConfirm) {
      newErrors.passwordConfirm = "비밀번호가 일치하지 않습니다";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinue = async () => {
    if (!validateForm()) return;

    setIsLoading(true);
    setTimeout(() => {
      sessionStorage.setItem("signupProfile", JSON.stringify(formData));
      setIsLoading(false);
      router.push("/signup/organization");
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
              본사 직원 인증을 위해 회사 이메일을 확인해주세요.
            </p>
          </div>

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
                    disabled={emailVerified}
                  />
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
                    <div className="flex items-center justify-center gap-2 mb-4">
                      <div className="w-6 h-6 rounded-full bg-[var(--color-primary)] flex items-center justify-center">
                        <Check size={16} className="text-white" strokeWidth={3} />
                      </div>
                      <span className="text-sm sm:text-base font-medium text-[var(--color-primary)]">
                        이메일 인증이 완료되었습니다.
                      </span>
                    </div>
                  </div>

                  <div className="text-center mb-6">
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

              {/* Franchise Confirmed */}
              {franchiseConfirmed && (
                <div className="mb-8 p-6 sm:p-8 border border-[var(--color-primary)]/20 rounded-[12px] bg-white">
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-4">
                      <div className="w-6 h-6 rounded-full bg-[var(--color-primary)] flex items-center justify-center">
                        <Check size={16} className="text-white" strokeWidth={3} />
                      </div>
                      <span className="text-sm sm:text-base font-medium text-[var(--color-primary)]">
                        본사 확인 완료
                      </span>
                    </div>
                    <h4 className="text-base sm:text-lg font-bold text-[var(--color-text-primary)]">
                      {franchiseConfirmation?.name}
                    </h4>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">본사 관리자</p>
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

              {/* Password */}
              <div className="mb-6">
                <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                  비밀번호
                </label>
                <PasswordInput
                  placeholder="8글자 이상 입력해주세요"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
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
                  value={formData.passwordConfirm}
                  onChange={(e) => setFormData({ ...formData, passwordConfirm: e.target.value })}
                  error={errors.passwordConfirm}
                />
              </div>

              {/* Next Button */}
              <div className="flex justify-center pt-8">
                <Button
                  onClick={handleContinue}
                  disabled={isLoading || !franchiseConfirmed}
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

// ============= 점주/직원 기본정보 화면 (기존) =============
function OwnerStaffSignupProfile() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    phone: "",
    password: "",
    passwordConfirm: "",
  });
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

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, email: e.target.value });
    setEmailDuplicateChecked(false);
    setEmailDuplicateError("");
    setEmailVerified(false);
    setEmailVerificationSent(false);
    setVerificationCode("");
    setVerificationError("");
    setErrors({ ...errors, email: "" });
  };

  const isValidEmail = (email: string): boolean => {
    return email.includes("@") && email.length > 0;
  };

  const handleCheckEmailDuplicate = async () => {
    if (!isValidEmail(formData.email)) {
      setEmailDuplicateError("올바른 이메일 주소를 입력해주세요.");
      return;
    }

    setIsCheckingDuplicate(true);
    setEmailDuplicateError("");

    try {
      setTimeout(() => {
        setEmailDuplicateChecked(true);
        setEmailDuplicateError("");
        setIsCheckingDuplicate(false);
      }, 600);
    } catch {
      setEmailDuplicateError("중복 확인 중 오류가 발생했습니다.");
      setIsCheckingDuplicate(false);
    }
  };

  const handleSendVerificationCode = async () => {
    setIsSendingVerification(true);
    setVerificationError("");

    try {
      setTimeout(() => {
        setEmailVerificationSent(true);
        setIsSendingVerification(false);
      }, 600);
    } catch {
      setVerificationError("인증번호 발송 중 오류가 발생했습니다.");
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
      setTimeout(() => {
        setEmailVerified(true);
        setVerificationError("");
        setIsVerifying(false);
      }, 600);
    } catch {
      setVerificationError("인증 확인 중 오류가 발생했습니다.");
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

    if (!formData.password) {
      newErrors.password = "비밀번호를 입력해주세요";
    } else if (formData.password.length < 8) {
      newErrors.password = "비밀번호는 8글자 이상이어야 합니다";
    }

    if (formData.password !== formData.passwordConfirm) {
      newErrors.passwordConfirm = "비밀번호가 일치하지 않습니다";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinue = async () => {
    if (!validateForm()) return;

    setIsLoading(true);
    setTimeout(() => {
      sessionStorage.setItem("signupProfile", JSON.stringify(formData));
      setIsLoading(false);
      router.push("/signup/organization");
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
                  />
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
                </div>

                {/* Duplicate Check Success */}
                {emailDuplicateChecked && !emailDuplicateError && (
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
                {emailDuplicateChecked && !emailDuplicateError && !emailVerificationSent && (
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
              {emailVerificationSent && (
                <div className="mt-5 mb-5 p-4 bg-[var(--color-primary-light)]/30 border border-[var(--color-primary)]/20 rounded-lg">
                  <p className="text-sm sm:text-base text-[var(--color-text-secondary)]">
                    입력하신 이메일로 인증번호를 보냈습니다.
                  </p>
                </div>
              )}

              {/* Verification Code Input */}
              {emailVerificationSent && (
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

              {/* Password */}
              <div className="mb-6">
                <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                  비밀번호
                </label>
                <PasswordInput
                  placeholder="8글자 이상 입력해주세요"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
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
                  value={formData.passwordConfirm}
                  onChange={(e) => setFormData({ ...formData, passwordConfirm: e.target.value })}
                  error={errors.passwordConfirm}
                />
              </div>

              {/* Next Button */}
              <div className="flex justify-center pt-8">
                <Button
                  onClick={handleContinue}
                  disabled={isLoading}
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
