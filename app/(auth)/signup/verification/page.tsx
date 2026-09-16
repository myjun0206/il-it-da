"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ArrowRight, Mail } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { Card } from "@/components/common/Card";
import type { UserRole } from "@/lib/types/user";

export default function SignupVerificationPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [isCodeSent, setIsCodeSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
    if (!savedRole) {
      router.push("/signup/role");
    } else {
      setRole(savedRole);
    }

    const profileData = sessionStorage.getItem("signupProfile");
    if (profileData) {
      const parsed = JSON.parse(profileData);
      setEmail(parsed.email);
    }
  }, [router]);

  // 타이머
  useEffect(() => {
    if (timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [timeLeft]);

  const handleSendCode = async () => {
    setErrors({});
    setIsLoading(true);

    // Mock send verification code
    setTimeout(() => {
      setIsCodeSent(true);
      setTimeLeft(300); // 5분
      setIsLoading(false);
      console.log("Verification code sent to:", email);
    }, 1000);
  };

  const handleVerify = async () => {
    setErrors({});

    if (!verificationCode) {
      setErrors({ code: "인증 코드를 입력해주세요" });
      return;
    }

    if (verificationCode.length !== 6) {
      setErrors({ code: "6자리 코드를 입력해주세요" });
      return;
    }

    setIsLoading(true);

    // Mock verification
    setTimeout(() => {
      if (verificationCode === "123456") {
        // Mock correct code
        sessionStorage.setItem("signupVerified", "true");
        setIsLoading(false);
        router.push("/signup/complete");
      } else {
        setErrors({ code: "인증 코드가 일치하지 않습니다" });
        setIsLoading(false);
      }
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <div className="flex flex-col min-h-screen">
        {/* Header */}
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <Link
              href="/signup/stores"
              className="flex items-center gap-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <ChevronLeft size={20} />
              <span className="text-sm font-medium">이전</span>
            </Link>
            <div className="text-sm text-[var(--color-text-tertiary)]">
              {role === "hq" ? "6단계" : "5단계"} / 6단계
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
          <Card className="w-full max-w-2xl" padding="lg">
            {/* Title */}
            <div className="mb-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--color-primary-light)] mb-4">
                <Mail size={24} className="text-[var(--color-primary)]" />
              </div>
              <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">
                이메일 인증
              </h1>
              <p className="text-[var(--color-text-secondary)]">
                등록된 이메일로 인증 코드를 보내드렸습니다.
              </p>
            </div>

            {/* Email Display */}
            <div className="mb-8 p-4 bg-[var(--color-bg-default)] rounded-lg">
              <p className="text-sm text-[var(--color-text-secondary)]">
                인증 대상 이메일
              </p>
              <p className="text-lg font-semibold text-[var(--color-text-primary)] mt-1">
                {email}
              </p>
            </div>

            {/* Verification Code Input */}
            {!isCodeSent ? (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleSendCode}
                isLoading={isLoading}
                className="w-full"
              >
                인증 코드 발송
              </Button>
            ) : (
              <div className="space-y-4 mb-8">
                <div>
                  <label className="block text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                    인증 코드
                  </label>
                  <Input
                    type="text"
                    placeholder="6자리 코드를 입력하세요"
                    value={verificationCode}
                    onChange={(e) =>
                      setVerificationCode(e.target.value.toUpperCase())
                    }
                    maxLength={6}
                    error={errors.code}
                  />
                </div>

                {/* Timer */}
                {timeLeft > 0 && (
                  <div className="flex items-center justify-between p-3 bg-[var(--color-primary-light)] rounded-lg">
                    <span className="text-sm text-[var(--color-text-primary)]">
                      시간 제한
                    </span>
                    <span
                      className={`text-sm font-bold ${
                        timeLeft < 60
                          ? "text-[var(--color-status-error)]"
                          : "text-[var(--color-primary)]"
                      }`}
                    >
                      {Math.floor(timeLeft / 60)}:
                      {String(timeLeft % 60).padStart(2, "0")}
                    </span>
                  </div>
                )}

                {/* Action Buttons */}
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={handleVerify}
                  isLoading={isLoading}
                  className="w-full"
                >
                  인증 완료
                </Button>

                <button
                  type="button"
                  onClick={handleSendCode}
                  className="w-full text-sm text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] font-semibold transition-colors py-2"
                >
                  코드 재발송
                </button>
              </div>
            )}

            {/* Help Text */}
            <p className="mt-8 text-center text-sm text-[var(--color-text-tertiary)]">
              스팸 메일함을 확인하거나, 등록 이메일을 변경하려면{" "}
              <Link
                href="/signup/profile"
                className="text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] font-semibold"
              >
                이전 단계
              </Link>
              로 돌아가세요.
            </p>

            {/* Test Code Info */}
            <div className="mt-6 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-xs text-yellow-700">
                <span className="font-bold">테스트 코드:</span> 123456을 입력해
                진행할 수 있습니다.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
