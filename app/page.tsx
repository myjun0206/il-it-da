"use client";

import React, { Suspense, useState, useLayoutEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input, PasswordInput } from "@/components/common/Input";
import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedProfile } from "@/lib/auth/client-profile";

type OAuthProvider = "google" | "kakao";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const verificationError = searchParams.get("error") === "verification_failed";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Check if user is already logged in on mount
  useLayoutEffect(() => {
    const checkSession = async () => {
      try {
        const oauthError = new URLSearchParams(window.location.search).get("oauthError");
        if (oauthError) {
          setErrors({ email: "SNS 로그인을 완료하지 못했습니다. 다시 시도해주세요." });
        }

        const supabase = createClient();
        const profile = await getAuthenticatedProfile(supabase);
        
        if (profile) {
          const role = profile.role;
          
          // Redirect based on role
          if (role === "hq") {
            router.push("/hq");
          } else if (role === "owner") {
            router.push("/boss");
          } else if (role === "staff") {
            router.push("/staff");
          }
        }
      } catch (e) {
        console.error("Session check failed:", e);
      }
    };
    
    checkSession();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Validation
    if (!email) {
      setErrors((prev) => ({ ...prev, email: "이메일을 입력해주세요" }));
      return;
    }
    if (!password) {
      setErrors((prev) => ({ ...prev, password: "비밀번호를 입력해주세요" }));
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const result: { user?: { id: string; email: string; role: string }; error?: string } =
        await response.json();

      if (!response.ok || !result.user) {
        setIsLoading(false);
        setErrors((prev) => ({
          ...prev,
          email: result.error || "아이디 또는 비밀번호를 확인해주세요.",
        }));
        return;
      }

      // Role-based redirect
      if (result.user.role === "hq") {
        router.push("/hq");
      } else if (result.user.role === "owner") {
        router.push("/boss");
      } else if (result.user.role === "staff") {
        router.push("/staff");
      } else {
        // Unknown role, redirect to home
        router.push("/");
      }
    } catch (e) {
      setIsLoading(false);
      console.error("Login error:", e);
      setErrors((prev) => ({
        ...prev,
        email: "로그인 중 오류가 발생했습니다.",
      }));
    }
  };

  const handleOAuthLogin = async (provider: OAuthProvider) => {
    setErrors({});

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error("OAuth login failed:", error);
      setErrors((prev) => ({
        ...prev,
        email: "SNS 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.",
      }));
    }
  };

  return (
    <div 
      className="min-h-screen flex flex-col"
      style={{
        background: "linear-gradient(135deg, #e3eee0 0%, #ffffff 50%, #f7f9f5 100%)"
      }}
    >
      {/* Desktop Layout */}
      <div className="hidden lg:grid lg:grid-cols-[55%_45%] lg:min-h-screen">
        {/* LEFT SIDE - 브랜드 영역 */}
        <div className="flex flex-col items-center justify-center px-8 py-16 lg:px-12">
          <div className="w-full max-w-[750px]">
            {/* 로고 영역 */}
            <div className="flex justify-center" style={{ marginBottom: "40px" }}>
              <img
                src="/logo/ilitda-logo.png"
                alt="일잇다"
                className="h-auto object-contain"
                style={{ width: "clamp(300px, 23vw, 380px)" }}
              />
            </div>

            {/* 메인 타이틀 */}
            <h1 
              className="mb-8 lg:mb-10 text-center font-bold leading-tight text-[var(--color-text-primary)]"
              style={{
                fontSize: "clamp(50px, 3.4vw, 64px)",
                fontWeight: 800,
                lineHeight: 1.12,
                letterSpacing: "-0.03em"
              }}
            >
              매장의 경험이,
              <br />
              <span className="text-[var(--color-primary)]">더 나은 운영으로 이어지다.</span>
            </h1>

            {/* 설명 문구 */}
            <p 
              className="mb-12 lg:mb-16 text-center text-[var(--color-text-secondary)]"
              style={{
                fontSize: "clamp(16px, 1.1vw, 20px)",
                lineHeight: 1.7
              }}
            >
              본사부터 점주, 직원까지<br />
              흩어진 업무 지식과 매뉴얼을 하나로 연결하세요.
            </p>

            {/* 장점 3개 - 가로 한 줄 데스크톱 */}
            <div className="flex items-center justify-center gap-12" style={{ gap: "44px" }}>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <div 
                  className="rounded-full bg-[var(--color-primary)] flex-shrink-0 flex items-center justify-center text-white"
                  style={{ width: "22px", height: "22px", minWidth: "22px" }}
                >
                  <Check size={10} strokeWidth={3} className="block shrink-0" />
                </div>
                <p className="text-base lg:text-lg font-semibold text-[var(--color-text-primary)]">
                  AI 업무 안내
                </p>
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <div 
                  className="rounded-full bg-[var(--color-primary)] flex-shrink-0 flex items-center justify-center text-white"
                  style={{ width: "22px", height: "22px", minWidth: "22px" }}
                >
                  <Check size={10} strokeWidth={3} className="block shrink-0" />
                </div>
                <p className="text-base lg:text-lg font-semibold text-[var(--color-text-primary)]">
                  매뉴얼 통합 관리
                </p>
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <div 
                  className="rounded-full bg-[var(--color-primary)] flex-shrink-0 flex items-center justify-center text-white"
                  style={{ width: "22px", height: "22px", minWidth: "22px" }}
                >
                  <Check size={10} strokeWidth={3} className="block shrink-0" />
                </div>
                <p className="text-base lg:text-lg font-semibold text-[var(--color-text-primary)]">
                  본사 · 점주 · 직원 연결
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT SIDE - 로그인 폼 */}
        <div className="flex items-center justify-center px-8 py-12">
          <div className="w-full max-w-md p-6">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">
                로그인
              </h2>
              <p className="mt-2 text-[var(--color-text-secondary)]">
                일잇다에서 매장 업무를 이어가세요.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              {verificationError && (
                <p className="rounded-lg border border-[var(--color-status-error)]/20 bg-red-50 px-4 py-3 text-sm text-[var(--color-status-error)]">
                  이메일 인증 확인에 실패했습니다. 다시 시도하거나 재가입해 주세요.
                </p>
              )}
              <Input
                label="아이디 또는 이메일"
                type="email"
                placeholder="example@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
              />

              <PasswordInput
                label="비밀번호"
                placeholder="비밀번호를 입력하세요"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
              />

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="rememberMe"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
                />
                <label
                  htmlFor="rememberMe"
                  className="text-sm text-[var(--color-text-secondary)]"
                >
                  자동 로그인
                </label>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={isLoading}
                className="w-full"
              >
                로그인
              </Button>

              <div className="flex justify-center">
                <Link
                  href="/find-account"
                  className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors"
                >
                  아이디 · 비밀번호 찾기
                </Link>
              </div>

              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 border-t border-[var(--color-border)]"></div>
                <span className="text-sm text-[var(--color-text-tertiary)] whitespace-nowrap">
                  또는
                </span>
                <div className="flex-1 border-t border-[var(--color-border)]"></div>
              </div>

              <div className="flex items-center justify-center gap-4">
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    console.log("Naver login");
                  }}
                  className="flex items-center justify-center rounded-full bg-white border border-[var(--color-border-light)] hover:border-[var(--color-border)] transition-all duration-180 hover:-translate-y-0.5 hover:shadow-sm"
                  style={{ width: "52px", height: "52px" }}
                  aria-label="네이버로 로그인"
                >
                  <img
                    src="/social/naver.png"
                    alt="NAVER"
                    style={{ width: "24px", height: "24px" }}
                    className="object-contain"
                  />
                </a>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    void handleOAuthLogin("kakao");
                  }}
                  className="flex items-center justify-center rounded-full bg-white border border-[var(--color-border-light)] hover:border-[var(--color-border)] transition-all duration-180 hover:-translate-y-0.5 hover:shadow-sm"
                  style={{ width: "52px", height: "52px" }}
                  aria-label="카카오로 로그인"
                >
                  <img
                    src="/social/kakao.svg"
                    alt=""
                    style={{ width: "25px", height: "25px", objectFit: "contain", objectPosition: "center" }}
                    className="block"
                  />
                </a>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    void handleOAuthLogin("google");
                  }}
                  className="flex items-center justify-center rounded-full bg-white border border-[var(--color-border-light)] hover:border-[var(--color-border)] transition-all duration-180 hover:-translate-y-0.5 hover:shadow-sm"
                  style={{ width: "52px", height: "52px" }}
                  aria-label="Google로 로그인"
                >
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    aria-hidden="true"
                    className="block w-6 h-6"
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                    <path fill="none" d="M0 0h48v48H0z" />
                  </svg>
                </a>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    console.log("Apple login");
                  }}
                  className="flex items-center justify-center rounded-full bg-white border border-[var(--color-border-light)] hover:border-[var(--color-border)] transition-all duration-180 hover:-translate-y-0.5 hover:shadow-sm"
                  style={{ width: "52px", height: "52px" }}
                  aria-label="Apple로 로그인"
                >
                  <img
                    src="/social/apple.svg"
                    alt=""
                    className="block w-full h-full object-contain"
                  />
                </a>
              </div>
            </form>

            <div className="mt-8 text-center text-sm">
              <span className="text-[var(--color-text-secondary)]">
                아직 계정이 없으신가요?{" "}
              </span>
              <Link
                href="/signup/start"
                className="font-semibold text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors"
              >
                회원가입
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile/Tablet Layout */}
      <div className="lg:hidden flex flex-col min-h-screen">
        <div className="px-6 py-8">
          <div className="mb-6 flex justify-center">
            <img
              src="/logo/ilitda-logo.png"
              alt="일잇다"
              className="max-h-20 w-auto object-contain"
            />
          </div>
          <h1 className="text-center text-2xl font-bold text-[var(--color-text-primary)] mb-2">
            매장의 경험이,
            <br />
            <span className="text-[var(--color-primary)]">더 나은 운영으로</span>
          </h1>
        </div>

        <div className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-md p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
                로그인
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                일잇다에서 매장 업무를 이어가세요.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              {verificationError && (
                <p className="rounded-lg border border-[var(--color-status-error)]/20 bg-red-50 px-4 py-3 text-sm text-[var(--color-status-error)]">
                  이메일 인증 확인에 실패했습니다. 다시 시도하거나 재가입해 주세요.
                </p>
              )}
              <Input
                label="아이디 또는 이메일"
                type="email"
                placeholder="example@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
              />

              <PasswordInput
                label="비밀번호"
                placeholder="비밀번호를 입력하세요"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
              />

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="rememberMeMobile"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
                />
                <label
                  htmlFor="rememberMeMobile"
                  className="text-sm text-[var(--color-text-secondary)]"
                >
                  자동 로그인
                </label>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={isLoading}
                className="w-full"
              >
                로그인
              </Button>

              <div className="flex justify-center">
                <Link
                  href="/find-account"
                  className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors"
                >
                  아이디 · 비밀번호 찾기
                </Link>
              </div>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[var(--color-border)]"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-[var(--color-bg-surface)] px-2 text-[var(--color-text-tertiary)]">
                    또는
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-3">
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    console.log("Naver login");
                  }}
                  className="flex items-center justify-center rounded-full bg-white border border-[var(--color-border-light)] hover:border-[var(--color-border)] transition-all duration-180 hover:-translate-y-0.5 hover:shadow-sm"
                  style={{ width: "52px", height: "52px" }}
                  aria-label="네이버로 로그인"
                >
                  <img
                    src="/social/naver.png"
                    alt="NAVER"
                    style={{ width: "24px", height: "24px" }}
                    className="object-contain"
                  />
                </a>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    void handleOAuthLogin("kakao");
                  }}
                  className="flex items-center justify-center rounded-full bg-white border border-[var(--color-border-light)] hover:border-[var(--color-border)] transition-all duration-180 hover:-translate-y-0.5 hover:shadow-sm"
                  style={{ width: "52px", height: "52px" }}
                  aria-label="카카오로 로그인"
                >
                  <img
                    src="/social/kakao.svg"
                    alt=""
                    style={{ width: "25px", height: "25px", objectFit: "contain", objectPosition: "center" }}
                    className="block"
                  />
                </a>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    void handleOAuthLogin("google");
                  }}
                  className="flex items-center justify-center rounded-full bg-white border border-[var(--color-border-light)] hover:border-[var(--color-border)] transition-all duration-180 hover:-translate-y-0.5 hover:shadow-sm"
                  style={{ width: "52px", height: "52px" }}
                  aria-label="Google로 로그인"
                >
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    aria-hidden="true"
                    className="block w-6 h-6"
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                    <path fill="none" d="M0 0h48v48H0z" />
                  </svg>
                </a>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    console.log("Apple login");
                  }}
                  className="flex items-center justify-center rounded-full bg-white border border-[var(--color-border-light)] hover:border-[var(--color-border)] transition-all duration-180 hover:-translate-y-0.5 hover:shadow-sm"
                  style={{ width: "52px", height: "52px" }}
                  aria-label="Apple로 로그인"
                >
                  <img
                    src="/social/apple.svg"
                    alt=""
                    className="block w-full h-full object-contain"
                  />
                </a>
              </div>
            </form>

            <div className="mt-6 text-center text-xs">
              <span className="text-[var(--color-text-secondary)]">
                아직 계정이 없으신가요?{" "}
              </span>
              <Link
                href="/signup/start"
                className="font-semibold text-[var(--color-primary)] hover:text-[var(--color-primary-hover)]"
              >
                회원가입
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
