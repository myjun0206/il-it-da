"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Store, UserRound, Check, ChevronLeft } from "lucide-react";
import { Button } from "@/components/common/Button";
import { createClient } from "@/lib/supabase/client";

type Role = "hq" | "owner" | "staff";

interface RoleCard {
  id: Role;
  icon: React.ComponentType<{ size: number; className?: string }>;
  title: string;
  description: string;
  subtitle: string;
}

const roles: RoleCard[] = [
  {
    id: "hq",
    icon: Building2,
    title: "본사",
    description: "브랜드와 가맹점의 매뉴얼을 관리해요",
    subtitle: "브랜드 관리자 · 본사 담당자",
  },
  {
    id: "owner",
    icon: Store,
    title: "점주",
    description: "매장 운영과 직원 업무를 관리해요",
    subtitle: "가맹점주 · 매장 관리자",
  },
  {
    id: "staff",
    icon: UserRound,
    title: "직원",
    description: "매뉴얼을 확인하고 AI에게 업무를 물어봐요",
    subtitle: "매장 직원 · 아르바이트",
  },
];

export default function SignupRolePage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isOAuthSignup, setIsOAuthSignup] = useState(false);
  const [isAuthChecked, setIsAuthChecked] = useState(false);

  useEffect(() => {
    const checkOAuthUser = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        const hasOAuthIdentity = user?.identities?.some(
          (identity) => identity.provider === "google" || identity.provider === "kakao" || identity.provider === "apple" || identity.provider === "custom:naver",
        );
        const primaryProvider = user?.app_metadata?.provider;

        setIsOAuthSignup(Boolean(
          hasOAuthIdentity || primaryProvider === "google" || primaryProvider === "kakao" || primaryProvider === "apple" || primaryProvider === "custom:naver",
        ));
      } finally {
        setIsAuthChecked(true);
      }
    };

    void checkOAuthUser();
  }, []);

  const availableRoles = isOAuthSignup ? roles.filter((role) => role.id !== "hq") : roles;

  const handleNext = () => {
    if (selectedRole) {
      // 새 회원가입: /signup/start에서 이미 초기화됨
      // 역할만 저장하고 다음 단계로 이동
      sessionStorage.setItem("signupRole", selectedRole);
      router.push("/signup/terms");
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      {/* Header */}
      <header className="relative border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
        <div className="flex items-center justify-between px-5 sm:px-8 lg:px-12 xl:px-16 h-16 lg:h-[68px]">
          {/* LEFT: Back Link */}
          <Link
            href="/"
            className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors flex-shrink-0"
          >
            <ChevronLeft size={24} className="flex-shrink-0" />
            <span className="text-base sm:text-lg lg:text-[17px] font-semibold hidden sm:inline">로그인으로 돌아가기</span>
            <span className="text-base font-semibold sm:hidden">로그인</span>
          </Link>

          {/* CENTER: Logo (Absolute Centered) - Wordmark */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex-shrink-0">
            <img
              src="/logo/ilitda-wordmark.png"
              alt="일잇다"
              className="w-[76px] sm:w-[88px] lg:w-[100px] h-auto object-contain"
            />
          </div>

        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center py-12 sm:py-16 lg:py-20 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-6xl">
          {/* Title Section */}
          <div className="mb-8 sm:mb-12 lg:mb-16 text-center">
            <h1
              className="mb-4 sm:mb-5 lg:mb-6 font-bold text-[var(--color-text-primary)]"
              style={{
                fontSize: "clamp(32px, 2.5vw, 42px)",
                fontWeight: 800,
              }}
            >
              어떤 역할로 시작하시나요?
            </h1>
            <p
              className="text-[var(--color-text-secondary)]"
              style={{
                fontSize: "clamp(16px, 1.2vw, 20px)",
              }}
            >
              역할에 맞는 일잇다 서비스를 준비해드릴게요.
            </p>
          </div>

          {/* Role Cards */}
          <div className={`grid grid-cols-1 ${isOAuthSignup ? "md:grid-cols-2" : "md:grid-cols-3"} gap-6 lg:gap-8 mb-12 lg:mb-16`}>
            {isAuthChecked && availableRoles.map((role) => {
              const isSelected = selectedRole === role.id;
              const IconComponent = role.icon;

              return (
                <button
                  key={role.id}
                  onClick={() => setSelectedRole(role.id)}
                  className={`relative flex flex-col justify-center items-start p-8 sm:p-10 lg:p-12 rounded-lg border-2 transition-all duration-200 text-left ${
                    isSelected
                      ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/40"
                      : "border-[var(--color-border-light)] bg-white hover:border-[var(--color-border)] hover:-translate-y-0.5"
                  }`}
                >
                  {/* Selection Checkmark */}
                  {isSelected && (
                    <div className="absolute top-5 right-5 lg:top-6 lg:right-6 flex items-center justify-center w-7 h-7 rounded-full bg-[var(--color-primary)]">
                      <Check
                        size={16}
                        className="text-white block shrink-0"
                        strokeWidth={3}
                      />
                    </div>
                  )}

                  {/* Content Wrapper - Centered Vertically */}
                  <div className="flex flex-col items-start w-full">
                    {/* Icon */}
                    <div className="mb-6 lg:mb-8 flex-shrink-0">
                      <IconComponent
                        size={44}
                        className={`transition-colors ${
                          isSelected
                            ? "text-[var(--color-primary)]"
                            : "text-[var(--color-text-secondary)]"
                        }`}
                      />
                    </div>

                    {/* Title */}
                    <h3 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--color-text-primary)] mb-4 lg:mb-6">
                      {role.title}
                    </h3>

                    {/* Subtitle */}
                    <p className="text-base sm:text-lg lg:text-xl text-[var(--color-text-secondary)]">
                      {role.subtitle}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Next Button */}
          <div className="flex justify-center">
            <Button
              onClick={handleNext}
              disabled={!selectedRole}
              variant="primary"
              size="lg"
              className="w-full sm:w-auto min-h-14 lg:min-h-16 px-8 lg:px-12 text-lg lg:text-xl font-semibold"
            >
              다음
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
