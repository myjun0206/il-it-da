"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Store, Mail, Globe, MessageCircle } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input, PasswordInput } from "@/components/common/Input";
import { Card } from "@/components/common/Card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

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
    // Mock login - 실제 로그인은 미구현
    setTimeout(() => {
      console.log("Login attempt:", { email, password, rememberMe });
      setIsLoading(false);
      // TODO: 실제 로그인 로직 연결
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      {/* Desktop Layout */}
      <div className="hidden lg:grid lg:grid-cols-[55%_45%] lg:min-h-screen">
        {/* LEFT SIDE - 브랜드 영역 */}
        <div className="flex flex-col items-center justify-center px-12 py-12 bg-gradient-to-br from-[var(--color-primary-light)] via-[var(--color-bg-surface)] to-[var(--color-bg-default)]">
          <div className="max-w-md text-center">
            {/* Logo */}
            <div className="mb-12 flex justify-center">
              <div className="flex items-center justify-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-primary)] text-white shadow-lg">
                  <Store size={24} />
                </div>
                <span className="text-3xl font-bold text-[var(--color-text-primary)]">
                  일잇다
                </span>
              </div>
            </div>

            {/* Main Message */}
            <h1 className="mb-4 text-4xl font-bold leading-tight text-[var(--color-text-primary)]">
              사장님의 경험이,
              <br />
              <span className="text-[var(--color-primary)]">
                더 좋은 내일로 이어지다.
              </span>
            </h1>

            {/* Sub Message */}
            <p className="mb-12 text-lg text-[var(--color-text-secondary)]">
              본사부터 매장, 직원까지<br />
              흩어진 업무 노하우를 하나로 연결하세요.
            </p>

            {/* Features */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="mt-1 h-5 w-5 rounded-full bg-[var(--color-primary)] flex-shrink-0 flex items-center justify-center text-white text-sm font-bold">
                  ✓
                </div>
                <p className="text-left text-[var(--color-text-primary)]">
                  AI 기반 업무 안내
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-1 h-5 w-5 rounded-full bg-[var(--color-primary)] flex-shrink-0 flex items-center justify-center text-white text-sm font-bold">
                  ✓
                </div>
                <p className="text-left text-[var(--color-text-primary)]">
                  매장별 매뉴얼 관리
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-1 h-5 w-5 rounded-full bg-[var(--color-primary)] flex-shrink-0 flex items-center justify-center text-white text-sm font-bold">
                  ✓
                </div>
                <p className="text-left text-[var(--color-text-primary)]">
                  본사 · 점주 · 직원 연결
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT SIDE - 로그인 폼 */}
        <div className="flex items-center justify-center px-8 py-12">
          <Card className="w-full max-w-md" padding="lg" shadow={false} border={false}>
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">
                로그인
              </h2>
              <p className="mt-2 text-[var(--color-text-secondary)]">
                일잇다에서 매장 업무를 이어가세요.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              {/* Email */}
              <Input
                label="아이디 또는 이메일"
                type="email"
                placeholder="example@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
              />

              {/* Password */}
              <PasswordInput
                label="비밀번호"
                placeholder="비밀번호를 입력하세요"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
              />

              {/* Remember Me */}
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

              {/* Login Button */}
              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={isLoading}
                className="w-full"
              >
                로그인
              </Button>

              {/* Links */}
              <div className="flex justify-center">
                <Link
                  href="/find-account"
                  className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors"
                >
                  아이디 · 비밀번호 찾기
                </Link>
              </div>

              {/* Divider */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[var(--color-border)]"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-[var(--color-bg-surface)] px-2 text-[var(--color-text-tertiary)]">
                    또는
                  </span>
                </div>
              </div>

              {/* Social Login */}
              <div className="grid grid-cols-3 gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  className="flex items-center justify-center"
                  aria-label="Google로 로그인"
                >
                  <Globe size={18} />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  className="flex items-center justify-center"
                  aria-label="Kakao로 로그인"
                >
                  <MessageCircle size={18} />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  className="flex items-center justify-center"
                  aria-label="Naver로 로그인"
                >
                  <Mail size={18} />
                </Button>
              </div>
            </form>

            {/* Sign Up Link */}
            <div className="mt-8 text-center text-sm">
              <span className="text-[var(--color-text-secondary)]">
                아직 계정이 없으신가요?{" "}
              </span>
              <Link
                href="/signup"
                className="font-semibold text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors"
              >
                회원가입
              </Link>
            </div>
          </Card>
        </div>
      </div>

      {/* Mobile/Tablet Layout */}
      <div className="lg:hidden flex flex-col min-h-screen">
        {/* Mobile TOP - 브랜드 영역 (축약됨) */}
        <div className="px-6 py-8 bg-gradient-to-b from-[var(--color-primary-light)] to-[var(--color-bg-surface)]">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-primary)] text-white">
              <Store size={20} />
            </div>
            <span className="text-2xl font-bold text-[var(--color-text-primary)]">
              일잇다
            </span>
          </div>
          <h1 className="text-center text-2xl font-bold text-[var(--color-text-primary)] mb-2">
            사장님의 경험이,
            <br />
            <span className="text-[var(--color-primary)]">더 좋은 내일로</span>
          </h1>
        </div>

        {/* Mobile BOTTOM - 로그인 폼 */}
        <div className="flex-1 flex items-center justify-center px-4 py-8">
          <Card className="w-full max-w-md" padding="lg">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
                로그인
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                일잇다에서 매장 업무를 이어가세요.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
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

              <div className="grid grid-cols-3 gap-2">
                <Button type="button" variant="outline" size="sm" className="flex items-center justify-center">
                  <Globe size={16} />
                </Button>
                <Button type="button" variant="outline" size="sm" className="flex items-center justify-center">
                  <MessageCircle size={16} />
                </Button>
                <Button type="button" variant="outline" size="sm" className="flex items-center justify-center">
                  <Mail size={16} />
                </Button>
              </div>
            </form>

            <div className="mt-6 text-center text-xs">
              <span className="text-[var(--color-text-secondary)]">
                아직 계정이 없으신가요?{" "}
              </span>
              <Link
                href="/signup"
                className="font-semibold text-[var(--color-primary)] hover:text-[var(--color-primary-hover)]"
              >
                회원가입
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
