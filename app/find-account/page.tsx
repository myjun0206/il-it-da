"use client";

export const dynamic = "force-dynamic";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Check } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";

type TabType = "id" | "password";
type IdFindMethod = "email" | "phone";

// Find ID states
interface FindIdState {
  method: IdFindMethod;
  
  // Email method
  emailInput: string;
  isEmailVerificationSent: boolean;
  emailVerificationCode: string;
  isEmailVerified: boolean;
  foundId: string;
  
  // Phone method
  name: string;
  phone: string;
  isPhoneVerificationSent: boolean;
  phoneVerificationCode: string;
  isPhoneVerified: boolean;
  
  // Loading states
  isSendingVerification: boolean;
  isVerifying: boolean;
  
  // Errors
  emailError: string;
  verificationError: string;
}

// Find Password states
interface FindPasswordState {
  name: string;
  email: string;
  isCheckingInfo: boolean;
  infoError: string;
  
  // After verification
  isInfoVerified: boolean;
  tempPassword: string;
}

// Main content component using useSearchParams
function FindAccountContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Initialize tab from query parameter
  const tabParam = searchParams.get("tab") as TabType | null;
  const activeTab = (tabParam === "id" || tabParam === "password") ? tabParam : "id";

  // Find ID state
  const [findIdState, setFindIdState] = useState<FindIdState>({
    method: "email",
    emailInput: "",
    isEmailVerificationSent: false,
    emailVerificationCode: "",
    isEmailVerified: false,
    foundId: "",
    name: "",
    phone: "",
    isPhoneVerificationSent: false,
    phoneVerificationCode: "",
    isPhoneVerified: false,
    isSendingVerification: false,
    isVerifying: false,
    emailError: "",
    verificationError: "",
  });

  // Find Password state
  const [findPasswordState, setFindPasswordState] = useState<FindPasswordState>({
    name: "",
    email: "",
    isCheckingInfo: false,
    infoError: "",
    isInfoVerified: false,
    tempPassword: "A8x2Jk9mL",
  });

  const handleSendEmailVerification = async () => {
    if (!findIdState.emailInput.includes("@")) {
      setFindIdState({
        ...findIdState,
        emailError: "올바른 이메일을 입력해주세요.",
      });
      return;
    }

    setFindIdState({
      ...findIdState,
      isSendingVerification: true,
      emailError: "",
    });

    try {
      // TODO: Connect to real API
      // POST /api/auth/send-find-id-verification
      // Body: { email: string, method: 'email' }
      // Response: { success: boolean, message?: string }

      await new Promise((resolve) => setTimeout(resolve, 600));

      setFindIdState({
        ...findIdState,
        isEmailVerificationSent: true,
        isSendingVerification: false,
      });
    } catch {
      setFindIdState({
        ...findIdState,
        isSendingVerification: false,
        emailError: "인증번호 발송 중 오류가 발생했습니다.",
      });
    }
  };

  const handleVerifyEmailCode = async () => {
    if (!findIdState.emailVerificationCode || findIdState.emailVerificationCode.length < 6) {
      setFindIdState({
        ...findIdState,
        verificationError: "인증번호를 정확히 입력해주세요.",
      });
      return;
    }

    setFindIdState({
      ...findIdState,
      isVerifying: true,
      verificationError: "",
    });

    try {
      // TODO: Connect to real API
      // POST /api/auth/verify-find-id-code
      // Body: { email: string, code: string }
      // Response: { success: boolean, id?: string, message?: string }

      await new Promise((resolve) => setTimeout(resolve, 600));

      setFindIdState({
        ...findIdState,
        isEmailVerified: true,
        foundId: "sch***@naver.com",
        isVerifying: false,
      });
    } catch {
      setFindIdState({
        ...findIdState,
        isVerifying: false,
        verificationError: "인증 중 오류가 발생했습니다.",
      });
    }
  };

  // ==================== FIND ID: Phone Method ====================

  const formatPhone = (value: string): string => {
    const cleaned = value.replace(/\D/g, "");
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 7) return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7, 11)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    setFindIdState({
      ...findIdState,
      phone: formatted,
      emailError: "",
    });
  };

  const isValidPhone = (phone: string): boolean => {
    return /^\d{10,11}$/.test(phone.replace(/[-]/g, ""));
  };

  const handleSendPhoneVerification = async () => {
    if (!findIdState.name.trim()) {
      setFindIdState({
        ...findIdState,
        emailError: "이름을 입력해주세요.",
      });
      return;
    }

    if (!isValidPhone(findIdState.phone)) {
      setFindIdState({
        ...findIdState,
        emailError: "올바른 휴대폰 번호를 입력해주세요.",
      });
      return;
    }

    setFindIdState({
      ...findIdState,
      isSendingVerification: true,
      emailError: "",
    });

    try {
      // TODO: Connect to real API
      // POST /api/auth/send-find-id-verification
      // Body: { name: string, phone: string, method: 'phone' }

      await new Promise((resolve) => setTimeout(resolve, 600));

      setFindIdState({
        ...findIdState,
        isPhoneVerificationSent: true,
        isSendingVerification: false,
      });
    } catch {
      setFindIdState({
        ...findIdState,
        isSendingVerification: false,
        emailError: "인증번호 발송 중 오류가 발생했습니다.",
      });
    }
  };

  const handleVerifyPhoneCode = async () => {
    if (!findIdState.phoneVerificationCode || findIdState.phoneVerificationCode.length < 6) {
      setFindIdState({
        ...findIdState,
        verificationError: "인증번호를 정확히 입력해주세요.",
      });
      return;
    }

    setFindIdState({
      ...findIdState,
      isVerifying: true,
      verificationError: "",
    });

    try {
      // TODO: Connect to real API
      // POST /api/auth/verify-find-id-code
      // Body: { name: string, phone: string, code: string }

      await new Promise((resolve) => setTimeout(resolve, 600));

      setFindIdState({
        ...findIdState,
        isPhoneVerified: true,
        foundId: "schsch050802",
        isVerifying: false,
      });
    } catch {
      setFindIdState({
        ...findIdState,
        isVerifying: false,
        verificationError: "인증 중 오류가 발생했습니다.",
      });
    }
  };

  // ==================== FIND PASSWORD ====================

  const handleCheckInfo = async () => {
    const errors: string[] = [];

    if (!findPasswordState.name.trim()) {
      errors.push("이름을 입력해주세요.");
    }

    if (!findPasswordState.email.includes("@")) {
      errors.push("올바른 이메일을 입력해주세요.");
    }

    if (errors.length > 0) {
      setFindPasswordState({
        ...findPasswordState,
        infoError: errors[0],
      });
      return;
    }

    setFindPasswordState({
      ...findPasswordState,
      isCheckingInfo: true,
      infoError: "",
    });

    try {
      // TODO: Connect to real API
      // POST /api/auth/verify-account-info
      // Body: { name: string, email: string }
      // Response: { success: boolean, tempPassword?: string, message?: string }

      await new Promise((resolve) => setTimeout(resolve, 600));

      setFindPasswordState({
        ...findPasswordState,
        isInfoVerified: true,
        isCheckingInfo: false,
      });
    } catch {
      setFindPasswordState({
        ...findPasswordState,
        isCheckingInfo: false,
        infoError: "정보 확인 중 오류가 발생했습니다.",
      });
    }
  };

  const handleLoginWithTempPassword = () => {
    router.push("/");
  };

  // ==================== RENDER ====================

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      {/* Header */}
      <header className="relative border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
        <div className="flex items-center justify-between px-5 sm:px-8 lg:px-12 xl:px-16 h-16 lg:h-[68px]">
          {/* LEFT: Back to Login */}
          <Link
            href="/"
            className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors flex-shrink-0"
          >
            <ChevronLeft size={24} className="flex-shrink-0" />
            <span className="text-base sm:text-lg lg:text-[17px] font-semibold hidden sm:inline">
              로그인으로 돌아가기
            </span>
            <span className="text-base font-semibold sm:hidden">로그인</span>
          </Link>

          {/* CENTER: Logo */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex-shrink-0">
            <img
              src="/logo/ilitda-wordmark.png"
              alt="일잇다"
              className="w-[76px] sm:w-[88px] lg:w-[100px] h-auto object-contain"
            />
          </div>

          {/* RIGHT: Empty */}
          <div className="w-12 flex-shrink-0" />
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center py-12 sm:py-16 lg:py-20 px-5 sm:px-6 lg:px-8">
        <div className="w-full max-w-[760px]">
          {/* Title Section */}
          <div className="mb-10 sm:mb-12 text-center">
            <h1
              className="mb-4 font-bold text-[var(--color-text-primary)]"
              style={{
                fontSize: "clamp(32px, 2.5vw, 42px)",
                fontWeight: 800,
              }}
            >
              계정 정보를 찾아드릴게요
            </h1>
            <p
              className="text-[var(--color-text-secondary)]"
              style={{
                fontSize: "clamp(16px, 1.2vw, 20px)",
              }}
            >
              가입할 때 입력한 정보로 계정을 확인할 수 있어요.
            </p>
          </div>

          {/* Tabs */}
          <div className="mb-10 sm:mb-12 border-b border-[var(--color-border)]">
            <div className="grid grid-cols-2 gap-0">
              <button
                onClick={() => router.push('?tab=id')}
                className={`py-4 sm:py-5 px-3 sm:px-4 text-base sm:text-lg font-semibold transition-all border-b-2 flex items-center justify-center min-h-[52px] ${
                  activeTab === "id"
                    ? "border-[var(--color-primary)] text-[var(--color-primary)] font-bold"
                    : "border-transparent text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)]"
                }`}
              >
                아이디 찾기
              </button>
              <button
                onClick={() => router.push('?tab=password')}
                className={`py-4 sm:py-5 px-3 sm:px-4 text-base sm:text-lg font-semibold transition-all border-b-2 flex items-center justify-center min-h-[52px] ${
                  activeTab === "password"
                    ? "border-[var(--color-primary)] text-[var(--color-primary)] font-bold"
                    : "border-transparent text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)]"
                }`}
              >
                비밀번호 찾기
              </button>
            </div>
          </div>

          {/* Tab Content */}
          {activeTab === "id" && (
            <div>
              {!findIdState.isEmailVerified && !findIdState.isPhoneVerified && (
                <div>
                  {/* Method Selection */}
                  <div className="mb-10">
                    <p className="text-base font-semibold text-[var(--color-text-primary)] mb-4">
                      아이디를 어떻게 찾으시겠어요?
                    </p>
                    <div className="flex items-center gap-6">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="idMethod"
                          value="email"
                          checked={findIdState.method === "email"}
                          onChange={(e) =>
                            setFindIdState({
                              ...findIdState,
                              method: e.target.value as IdFindMethod,
                              emailError: "",
                              verificationError: "",
                            })
                          }
                          className="w-4 h-4 accent-[var(--color-primary)]"
                        />
                        <span className="text-sm sm:text-base text-[var(--color-text-primary)]">
                          이메일 인증
                        </span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="idMethod"
                          value="phone"
                          checked={findIdState.method === "phone"}
                          onChange={(e) =>
                            setFindIdState({
                              ...findIdState,
                              method: e.target.value as IdFindMethod,
                              emailError: "",
                              verificationError: "",
                            })
                          }
                          className="w-4 h-4 accent-[var(--color-primary)]"
                        />
                        <span className="text-sm sm:text-base text-[var(--color-text-primary)]">
                          휴대폰 본인인증
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Email Method */}
                  {findIdState.method === "email" && (
                    <div className="space-y-6">
                      <div>
                        <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                          이메일
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_140px] gap-3 w-full">
                          <Input
                            type="email"
                            placeholder="example@naver.com"
                            value={findIdState.emailInput}
                            onChange={(e) =>
                              setFindIdState({
                                ...findIdState,
                                emailInput: e.target.value,
                                emailError: "",
                              })
                            }
                            error={findIdState.emailError}
                            className="h-[56px]"
                          />
                          <button
                            type="button"
                            onClick={handleSendEmailVerification}
                            disabled={
                              findIdState.isSendingVerification ||
                              !findIdState.emailInput.includes("@")
                            }
                            className={`h-[56px] rounded-lg border-2 font-semibold text-sm sm:text-base transition-all flex items-center justify-center whitespace-nowrap ${
                              findIdState.isSendingVerification ||
                              !findIdState.emailInput.includes("@")
                                ? "border-[var(--color-border-light)] text-[var(--color-text-secondary)] bg-white cursor-not-allowed opacity-60"
                                : "border-[var(--color-primary)] text-[var(--color-primary)] bg-white hover:bg-[var(--color-primary-light)]/20"
                            }`}
                          >
                            {findIdState.isSendingVerification ? "발송 중..." : "인증번호 받기"}
                          </button>
                        </div>
                      </div>

                      {findIdState.isEmailVerificationSent && (
                        <div>
                          <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                            인증번호
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_140px] gap-3 w-full">
                            <Input
                              type="text"
                              placeholder="6자리 인증번호"
                              value={findIdState.emailVerificationCode}
                              onChange={(e) =>
                                setFindIdState({
                                  ...findIdState,
                                  emailVerificationCode: e.target.value.slice(0, 6),
                                  verificationError: "",
                                })
                              }
                              error={findIdState.verificationError}
                              className="h-[56px]"
                            />
                            <button
                              type="button"
                              onClick={handleVerifyEmailCode}
                              disabled={
                                findIdState.isVerifying ||
                                !findIdState.emailVerificationCode ||
                                findIdState.emailVerificationCode.length < 6
                              }
                              className={`h-[56px] rounded-lg border-2 font-semibold text-sm sm:text-base transition-all flex items-center justify-center whitespace-nowrap ${
                                findIdState.isVerifying ||
                                !findIdState.emailVerificationCode ||
                                findIdState.emailVerificationCode.length < 6
                                  ? "border-[var(--color-border-light)] text-[var(--color-text-secondary)] bg-white cursor-not-allowed opacity-60"
                                  : "border-[var(--color-primary)] text-[var(--color-primary)] bg-white hover:bg-[var(--color-primary-light)]/20"
                              }`}
                            >
                              {findIdState.isVerifying ? "확인 중..." : "인증 확인"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Phone Method */}
                  {findIdState.method === "phone" && (
                    <div className="space-y-6">
                      <div>
                        <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                          이름
                        </label>
                        <Input
                          type="text"
                          placeholder="이름을 입력해주세요"
                          value={findIdState.name}
                          onChange={(e) =>
                            setFindIdState({
                              ...findIdState,
                              name: e.target.value,
                              emailError: "",
                            })
                          }
                          className="h-[56px]"
                        />
                      </div>

                      <div>
                        <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                          휴대폰 번호
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_140px] gap-3 w-full">
                          <Input
                            type="tel"
                            placeholder="010-0000-0000"
                            value={findIdState.phone}
                            onChange={handlePhoneChange}
                            error={findIdState.emailError}
                            className="h-[56px]"
                          />
                          <button
                            type="button"
                            onClick={handleSendPhoneVerification}
                            disabled={
                              findIdState.isSendingVerification ||
                              !findIdState.name.trim() ||
                              !isValidPhone(findIdState.phone)
                            }
                            className={`h-[56px] rounded-lg border-2 font-semibold text-sm sm:text-base transition-all flex items-center justify-center whitespace-nowrap ${
                              findIdState.isSendingVerification ||
                              !findIdState.name.trim() ||
                              !isValidPhone(findIdState.phone)
                                ? "border-[var(--color-border-light)] text-[var(--color-text-secondary)] bg-white cursor-not-allowed opacity-60"
                                : "border-[var(--color-primary)] text-[var(--color-primary)] bg-white hover:bg-[var(--color-primary-light)]/20"
                            }`}
                          >
                            {findIdState.isSendingVerification ? "발송 중..." : "인증번호 받기"}
                          </button>
                        </div>
                      </div>

                      {findIdState.isPhoneVerificationSent && (
                        <div>
                          <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                            인증번호
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_140px] gap-3 w-full">
                            <Input
                              type="text"
                              placeholder="6자리 인증번호"
                              value={findIdState.phoneVerificationCode}
                              onChange={(e) =>
                                setFindIdState({
                                  ...findIdState,
                                  phoneVerificationCode: e.target.value.slice(0, 6),
                                  verificationError: "",
                                })
                              }
                              error={findIdState.verificationError}
                              className="h-[56px]"
                            />
                            <button
                              type="button"
                              onClick={handleVerifyPhoneCode}
                              disabled={
                                findIdState.isVerifying ||
                                !findIdState.phoneVerificationCode ||
                                findIdState.phoneVerificationCode.length < 6
                              }
                              className={`h-[56px] rounded-lg border-2 font-semibold text-sm sm:text-base transition-all flex items-center justify-center whitespace-nowrap ${
                                findIdState.isVerifying ||
                                !findIdState.phoneVerificationCode ||
                                findIdState.phoneVerificationCode.length < 6
                                  ? "border-[var(--color-border-light)] text-[var(--color-text-secondary)] bg-white cursor-not-allowed opacity-60"
                                  : "border-[var(--color-primary)] text-[var(--color-primary)] bg-white hover:bg-[var(--color-primary-light)]/20"
                              }`}
                            >
                              {findIdState.isVerifying ? "확인 중..." : "인증 확인"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Result Screen */}
              {(findIdState.isEmailVerified || findIdState.isPhoneVerified) && (
                <div className="text-center">
                  <div className="mb-8 flex justify-center">
                    <div className="w-12 h-12 rounded-full bg-[var(--color-primary)] flex items-center justify-center">
                      <Check size={24} className="text-white" strokeWidth={3} />
                    </div>
                  </div>

                  <h2 className="text-xl sm:text-2xl font-bold text-[var(--color-text-primary)] mb-6">
                    아이디를 찾았어요
                  </h2>

                  <div className="mb-8 p-6 bg-[var(--color-primary-light)]/20 border border-[var(--color-primary)]/20 rounded-lg">
                    <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                      회원님의 아이디는
                    </p>
                    <p className="text-lg font-bold text-[var(--color-text-primary)]">
                      {findIdState.foundId}
                    </p>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-2">
                      입니다.
                    </p>
                  </div>

                  <Link href="/" className="block mb-6">
                    <Button variant="primary" size="md" className="w-full">
                      로그인하러 가기
                    </Button>
                  </Link>

                  <p className="text-sm text-[var(--color-text-secondary)]">
                    비밀번호를 잊으셨나요?{" "}
                    <button
                      onClick={() => {
                        router.push('?tab=password');
                        setFindIdState({
                          method: "email",
                          emailInput: "",
                          isEmailVerificationSent: false,
                          emailVerificationCode: "",
                          isEmailVerified: false,
                          foundId: "",
                          name: "",
                          phone: "",
                          isPhoneVerificationSent: false,
                          phoneVerificationCode: "",
                          isPhoneVerified: false,
                          isSendingVerification: false,
                          isVerifying: false,
                          emailError: "",
                          verificationError: "",
                        });
                      }}
                      className="font-semibold text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors"
                    >
                      비밀번호 찾기
                    </button>
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === "password" && (
            <div>
              {!findPasswordState.isInfoVerified && (
                <div className="space-y-6">
                  <p className="text-sm sm:text-base text-[var(--color-text-secondary)] text-center mb-8">
                    비밀번호를 찾기 위해<br />
                    가입 정보를 입력해주세요.
                  </p>

                  <div>
                    <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                      이름
                    </label>
                    <Input
                      type="text"
                      placeholder="이름을 입력해주세요"
                      value={findPasswordState.name}
                      onChange={(e) =>
                        setFindPasswordState({
                          ...findPasswordState,
                          name: e.target.value,
                          infoError: "",
                        })
                      }
                      error={findPasswordState.infoError}
                      className="h-[56px]"
                    />
                  </div>

                  <div>
                    <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                      아이디(이메일)
                    </label>
                    <Input
                      type="email"
                      placeholder="아이디 또는 이메일을 입력해주세요"
                      value={findPasswordState.email}
                      onChange={(e) =>
                        setFindPasswordState({
                          ...findPasswordState,
                          email: e.target.value,
                          infoError: "",
                        })
                      }
                      className="h-[56px]"
                    />
                  </div>

                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleCheckInfo}
                    isLoading={findPasswordState.isCheckingInfo}
                    className="w-full mt-8"
                  >
                    가입 정보 확인
                  </Button>
                </div>
              )}

              {findPasswordState.isInfoVerified && (
                <div className="text-center">
                  <div className="mb-8 flex justify-center">
                    <div className="w-12 h-12 rounded-full bg-[var(--color-primary)] flex items-center justify-center">
                      <Check size={24} className="text-white" strokeWidth={3} />
                    </div>
                  </div>

                  <h2 className="text-xl sm:text-2xl font-bold text-[var(--color-text-primary)] mb-4">
                    임시 비밀번호가 발급되었어요
                  </h2>

                  <p className="text-sm text-[var(--color-text-secondary)] mb-8">
                    아래 임시 비밀번호로 로그인한 뒤<br />
                    본인 인증을 통해 새 비밀번호를 설정해주세요.
                  </p>

                  <div className="mb-8 p-6 bg-[var(--color-primary-light)]/20 border border-[var(--color-primary)]/20 rounded-lg">
                    <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                      임시 비밀번호
                    </p>
                    <p className="text-lg font-mono font-bold text-[var(--color-text-primary)]">
                      {findPasswordState.tempPassword}
                    </p>
                  </div>

                  <button
                    onClick={handleLoginWithTempPassword}
                    className="w-full h-12 bg-[var(--color-primary)] text-white font-semibold rounded-lg hover:bg-[var(--color-primary-hover)] transition-colors mb-6"
                  >
                    임시 비밀번호로 로그인하기
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Loading fallback
function FindAccountLoadingFallback() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex items-center justify-center">
      <p className="text-[var(--color-text-secondary)]">로딩 중...</p>
    </div>
  );
}

// Main page with Suspense
export default function FindAccountPage() {
  return (
    <Suspense fallback={<FindAccountLoadingFallback />}>
      <FindAccountContent />
    </Suspense>
  );
}
