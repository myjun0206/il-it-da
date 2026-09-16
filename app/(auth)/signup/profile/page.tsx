"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Check } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input, PasswordInput } from "@/components/common/Input";
import type { UserRole } from "@/lib/types/user";

export default function SignupProfilePage() {
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

  useEffect(() => {
    // 이전 페이지에서 저장된 역할 확인
    const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
    if (!savedRole) {
      router.push("/signup/role");
    }
  }, [router]);

  // 이메일 값 변경 시 확인 상태 초기화
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

  // 이메일 형식 검증
  const isValidEmail = (email: string): boolean => {
    return email.includes("@") && email.length > 0;
  };

  // TODO: 실제 이메일 중복 확인 API 연결
  const handleCheckEmailDuplicate = async () => {
    if (!isValidEmail(formData.email)) {
      setEmailDuplicateError("올바른 이메일 주소를 입력해주세요.");
      return;
    }

    setIsCheckingDuplicate(true);
    setEmailDuplicateError("");

    try {
      // TODO: Supabase 또는 backend에서 이메일 중복 확인
      // const response = await fetch('/api/auth/check-email', {
      //   method: 'POST',
      //   body: JSON.stringify({ email: formData.email })
      // });
      // const data = await response.json();

      // Mock implementation for UI development
      // 실제 backend 구현 후 교체
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

  // TODO: 실제 인증번호 발송 API 연결
  const handleSendVerificationCode = async () => {
    setIsSendingVerification(true);
    setVerificationError("");

    try {
      // TODO: Supabase 또는 backend에서 인증번호 발송
      // const response = await fetch('/api/auth/send-verification', {
      //   method: 'POST',
      //   body: JSON.stringify({ email: formData.email })
      // });
      // const data = await response.json();

      // Mock implementation for UI development
      setTimeout(() => {
        setEmailVerificationSent(true);
        setIsSendingVerification(false);
      }, 600);
    } catch {
      setVerificationError("인증번호 발송 중 오류가 발생했습니다.");
      setIsSendingVerification(false);
    }
  };

  // TODO: 실제 인증 확인 API 연결
  const handleVerifyCode = async () => {
    if (!verificationCode || verificationCode.length < 6) {
      setVerificationError("인증번호를 정확히 입력해주세요.");
      return;
    }

    setIsVerifying(true);
    setVerificationError("");

    try {
      // TODO: Supabase 또는 backend에서 인증번호 확인
      // const response = await fetch('/api/auth/verify-code', {
      //   method: 'POST',
      //   body: JSON.stringify({ email: formData.email, code: verificationCode })
      // });
      // const data = await response.json();

      // Mock implementation for UI development
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

    if (!emailVerified) {
      // 현재는 선택사항, 추후 필수로 변경 가능
      // newErrors.email = newErrors.email || "이메일 인증이 필요합니다";
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
    // Mock save
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
          {/* LEFT: Back Link */}
          <button
            onClick={handlePrevious}
            className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors flex-shrink-0 bg-none border-none cursor-pointer"
          >
            <ChevronLeft size={24} className="flex-shrink-0" />
            <span className="text-base sm:text-lg lg:text-[17px] font-semibold hidden sm:inline">이전</span>
            <span className="text-base font-semibold sm:hidden">이전</span>
          </button>

          {/* CENTER: Logo (Absolute Centered) - Wordmark */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex-shrink-0">
            <img
              src="/logo/ilitda-wordmark.png"
              alt="일잇다"
              className="w-[76px] sm:w-[88px] lg:w-[100px] h-auto object-contain"
            />
          </div>

          {/* RIGHT: Progress */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <span className="text-base sm:text-lg lg:text-[17px] font-semibold text-[var(--color-text-secondary)]">
              3 / 5
            </span>
            {/* Progress Bar */}
            <div className="w-20 sm:w-28 h-2 bg-[var(--color-border-light)] rounded-full overflow-hidden flex-shrink-0">
              <div
                className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-300"
                style={{ width: "60%" }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center py-12 sm:py-16 lg:py-20 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-6xl">
          {/* Title Section */}
          <div className="mb-6 sm:mb-8 lg:mb-10 text-center">
            <h1
              className="mb-4 sm:mb-5 lg:mb-6 font-bold text-[var(--color-text-primary)]"
              style={{
                fontSize: "clamp(32px, 2.5vw, 42px)",
                fontWeight: 800,
              }}
            >
              기본 정보를 입력해주세요
            </h1>
            <p
              className="text-[var(--color-text-secondary)]"
              style={{
                fontSize: "clamp(16px, 1.2vw, 20px)",
              }}
            >
              서비스 이용에 필요한 기본 정보를 입력해주세요.
            </p>
          </div>

          {/* Form Container */}
          <div className="mx-auto w-full max-w-[860px]">
            <form className="">
              {/* Email with Duplicate Check */}
              <div className="mb-6">
                <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                  이메일
                </label>
                
                {/* Email Input + Check Button Row */}
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

                {/* Duplicate Check Success Message */}
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

                  {/* Verification Success Message */}
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
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
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
                  onChange={(e) =>
                    setFormData({ ...formData, passwordConfirm: e.target.value })
                  }
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
