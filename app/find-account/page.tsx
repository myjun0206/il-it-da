"use client";

export const dynamic = "force-dynamic";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Check, Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";

type TabType = "id" | "password";
// Find ID states
interface FindIdState {
  name: string;
  phone: string;
  isSearching: boolean;
  isFound: boolean;
  foundId: string;
  error: string;
}

// Find Password states
interface FindPasswordState {
  name: string;
  email: string;
  isCheckingInfo: boolean;
  infoError: string;
  isInfoVerified: boolean;
  tempPassword: string;
  isPasswordVisible: boolean;
  isCopied: boolean;
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
    name: "",
    phone: "",
    isSearching: false,
    isFound: false,
    foundId: "",
    error: "",
  });

  // Find Password state
  const [findPasswordState, setFindPasswordState] = useState<FindPasswordState>({
    name: "",
    email: "",
    isCheckingInfo: false,
    infoError: "",
    isInfoVerified: false,
    tempPassword: "",
    isPasswordVisible: false,
    isCopied: false,
  });

  const formatPhone = (value: string): string => {
    const cleaned = value.replace(/\D/g, "");
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 7) return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7, 11)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    setFindIdState((previous) => ({
      ...previous,
      phone: formatted,
      error: "",
      isFound: false,
      foundId: "",
    }));
  };

  const isValidPhone = (phone: string): boolean => {
    return /^\d{10,11}$/.test(phone.replace(/\D/g, ""));
  };

  const handleFindId = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (findIdState.isSearching) return;

    const fullName = findIdState.name.trim();
    const phone = findIdState.phone.replace(/\D/g, "");

    if (!fullName) {
      setFindIdState((previous) => ({ ...previous, error: "이름을 입력해주세요." }));
      return;
    }

    if (!isValidPhone(phone)) {
      setFindIdState((previous) => ({ ...previous, error: "올바른 휴대폰 번호를 입력해주세요." }));
      return;
    }

    setFindIdState((previous) => ({ ...previous, isSearching: true, error: "" }));

    try {
      const response = await fetch("/api/auth/find-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, phone }),
      });
      const result: { success?: boolean; email?: string; message?: string } = await response.json();

      if (!response.ok || !result.success || !result.email) {
        setFindIdState((previous) => ({
          ...previous,
          isSearching: false,
          error: result.message || "일치하는 계정을 찾을 수 없습니다.",
        }));
        return;
      }

      setFindIdState((previous) => ({
        ...previous,
        isSearching: false,
        isFound: true,
        foundId: result.email ?? "",
      }));
    } catch {
      setFindIdState((previous) => ({
        ...previous,
        isSearching: false,
        error: "계정을 확인하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      }));
    }
  };

  // ==================== FIND PASSWORD ====================

  const handleCheckInfo = async () => {
    if (findPasswordState.isCheckingInfo) return;

    const fullName = findPasswordState.name.trim();
    const email = findPasswordState.email.trim();

    if (!fullName || !email) {
      setFindPasswordState((previous) => ({
        ...previous,
        infoError: "이름과 이메일을 입력해주세요.",
      }));
      return;
    }

    setFindPasswordState((previous) => ({
      ...previous,
      isCheckingInfo: true,
      infoError: "",
    }));

    try {
      const response = await fetch("/api/auth/find-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email }),
      });
      const result: { success?: boolean; temporaryPassword?: string; message?: string } = await response.json();

      if (!response.ok || !result.success || !result.temporaryPassword) {
        setFindPasswordState((previous) => ({
          ...previous,
          isCheckingInfo: false,
          infoError: result.message || "비밀번호 재설정 중 오류가 발생했습니다.",
        }));
        return;
      }

      setFindPasswordState((previous) => ({
        ...previous,
        isInfoVerified: true,
        isCheckingInfo: false,
        tempPassword: result.temporaryPassword ?? "",
        isPasswordVisible: false,
      }));
    } catch {
      setFindPasswordState((previous) => ({
        ...previous,
        isCheckingInfo: false,
        infoError: "비밀번호 재설정 중 오류가 발생했습니다.",
      }));
    }
  };

  const handleCopyPassword = async () => {
    try {
      await navigator.clipboard.writeText(findPasswordState.tempPassword);
      setFindPasswordState((previous) => ({ ...previous, isCopied: true, infoError: "" }));
      setTimeout(() => {
        setFindPasswordState((prev) => ({
          ...prev,
          isCopied: false,
        }));
      }, 2000);
    } catch {
      setFindPasswordState((previous) => ({ ...previous, infoError: "복사하지 못했습니다." }));
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
              가입할 때 입력한 정보로 계정을 확인할 수 있어요
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
                이메일 찾기
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
              {!findIdState.isFound ? (
                <form onSubmit={handleFindId} className="space-y-6">
                  <p className="text-sm sm:text-base text-[var(--color-text-secondary)] text-center mb-8">
                    가입할 때 입력한 이름과 휴대폰 번호를 입력해주세요
                  </p>

                  <div>
                    <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                      이름
                    </label>
                    <Input
                      type="text"
                      placeholder="이름을 입력해주세요"
                      value={findIdState.name}
                      onChange={(e) =>
                        setFindIdState((previous) => ({
                          ...previous,
                          name: e.target.value,
                          error: "",
                          isFound: false,
                          foundId: "",
                        }))
                      }
                      error={findIdState.error && !findIdState.name.trim() ? findIdState.error : undefined}
                      className="h-[56px]"
                    />
                  </div>

                  <div>
                    <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                      휴대폰 번호
                    </label>
                    <Input
                      type="tel"
                      placeholder="010-0000-0000"
                      value={findIdState.phone}
                      onChange={handlePhoneChange}
                      error={findIdState.name.trim() && !isValidPhone(findIdState.phone) ? findIdState.error || undefined : undefined}
                      className="h-[56px]"
                    />
                  </div>

                  {findIdState.error && findIdState.name.trim() && isValidPhone(findIdState.phone) && (
                    <p role="alert" className="text-sm text-[var(--color-status-error)]">
                      {findIdState.error}
                    </p>
                  )}

                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    isLoading={findIdState.isSearching}
                    disabled={findIdState.isSearching}
                    className="w-full mt-8"
                  >
                    이메일 찾기
                  </Button>
                </form>
              ) : (
                <div className="text-center">
                  <div className="mb-8 flex justify-center">
                    <div className="w-12 h-12 rounded-full bg-[var(--color-primary)] flex items-center justify-center">
                      <Check size={24} className="text-white" strokeWidth={3} />
                    </div>
                  </div>

                  <h2 className="text-xl sm:text-2xl font-bold text-[var(--color-text-primary)] mb-6">
                    이메일을 찾았어요
                  </h2>

                  <div className="mb-8 p-6 bg-[var(--color-primary-light)]/20 border border-[var(--color-primary)]/20 rounded-lg">
                    <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                      회원님의 이메일은
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
                      onClick={() => router.push('?tab=password')}
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
                    비밀번호를 찾기 위해 가입 정보를 입력해주세요
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
                      className="h-[56px]"
                    />
                  </div>

                  <div>
                    <label className="block text-base font-semibold text-[var(--color-text-primary)] mb-2.5">
                      이메일
                    </label>
                    <Input
                      type="email"
                      placeholder="이메일을 입력해주세요"
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

                  {findPasswordState.infoError && (
                    <p role="alert" className="text-sm text-[var(--color-status-error)]">
                      {findPasswordState.infoError}
                    </p>
                  )}

                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleCheckInfo}
                    isLoading={findPasswordState.isCheckingInfo}
                    disabled={findPasswordState.isCheckingInfo}
                    className="w-full mt-8"
                  >
                    임시 비밀번호 발급
                  </Button>
                </div>
              )}

              {findPasswordState.isInfoVerified && (
                <div className="mt-10 sm:mt-12">
                  {/* Result Card */}
                  <div className="w-full border border-[var(--color-border)] rounded-[14px] bg-white/55 backdrop-blur-sm px-6 sm:px-8 py-8 sm:py-9">
                    {/* Success Section */}
                    <div className="text-center mb-7 sm:mb-8">
                      <div className="mb-4 flex justify-center">
                        <div className="w-12 h-12 rounded-full bg-[var(--color-primary)] flex items-center justify-center">
                          <Check size={24} className="text-white" strokeWidth={3} />
                        </div>
                      </div>

                      <h2 className="text-[22px] sm:text-[24px] font-bold text-[var(--color-text-primary)] mb-1">
                        임시 비밀번호가 발급되었습니다.
                      </h2>

                      <p className="text-[15px] sm:text-[16px] text-[var(--color-text-secondary)]">
                        로그인 후 새로운 비밀번호로 변경해주세요.
                      </p>
                    </div>

                    {/* Password Section */}
                    <div className="mb-6">
                      <p className="text-sm text-[var(--color-text-secondary)] font-medium mb-3">
                        1회용 비밀번호
                      </p>
                      <div className="relative min-h-[72px] sm:min-h-[76px] w-full bg-white border border-[var(--color-primary)]/30 rounded-[10px] flex items-center px-3 sm:px-4">
                        <button
                          type="button"
                          onClick={() =>
                            setFindPasswordState((previous) => ({
                              ...previous,
                              isPasswordVisible: !previous.isPasswordVisible,
                            }))
                          }
                          className="h-[44px] w-[44px] shrink-0 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-primary)]/5 hover:text-[var(--color-primary)] transition-colors"
                          title={findPasswordState.isPasswordVisible ? "비밀번호 숨기기" : "비밀번호 보기"}
                          aria-label={findPasswordState.isPasswordVisible ? "비밀번호 숨기기" : "비밀번호 보기"}
                          aria-pressed={findPasswordState.isPasswordVisible}
                        >
                          {findPasswordState.isPasswordVisible ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                        <p className="min-w-0 flex-1 px-1 text-center text-base sm:text-xl font-mono font-bold text-[var(--color-text-primary)] break-all">
                          {findPasswordState.isPasswordVisible ? findPasswordState.tempPassword : "••••••••••••"}
                        </p>
                        <button
                          type="button"
                          onClick={handleCopyPassword}
                          className="h-[44px] shrink-0 px-3 border border-[var(--color-primary)] rounded-lg bg-white text-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-colors flex items-center gap-2 font-semibold text-sm sm:text-base whitespace-nowrap"
                          title="비밀번호 복사"
                        >
                          <Copy size={18} />
                          <span>복사</span>
                        </button>
                      </div>
                      {findPasswordState.isCopied && (
                        <p role="status" className="mt-2 text-sm text-[var(--color-primary)]">
                          복사되었습니다.
                        </p>
                      )}
                      {findPasswordState.infoError && (
                        <p role="alert" className="mt-2 text-sm text-[var(--color-status-error)]">
                          {findPasswordState.infoError}
                        </p>
                      )}
                    </div>

                    {/* Info Section */}
                    <div className="bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20 rounded-lg px-4 sm:px-5 py-3.5 mb-6">
                      <p className="text-[14px] sm:text-[15px] text-[var(--color-text-secondary)] leading-relaxed">
                        임시 비밀번호로 로그인한 후,<br />
                        보안을 위해 새 비밀번호로 변경해주세요.
                      </p>
                    </div>

                    {/* Login Button */}
                    <button
                      onClick={handleLoginWithTempPassword}
                      className="w-full h-[54px] sm:h-[56px] bg-[var(--color-primary)] text-white font-semibold text-base rounded-lg hover:bg-[var(--color-primary-hover)] transition-colors"
                    >
                      로그인하러 가기
                    </button>
                  </div>
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
