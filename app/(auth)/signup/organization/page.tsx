"use client";

import React, { useState, useLayoutEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ArrowRight, Building2 } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import type { UserRole } from "@/lib/types/user";
import { mockBrands } from "@/lib/data/mockStores";

export default function SignupOrganizationPage() {
  const router = useRouter();
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mounted] = useState(() => typeof window !== 'undefined');

  useLayoutEffect(() => {
    const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
    if (!savedRole) {
      router.push("/signup/role");
    } else if (savedRole !== "hq") {
      // 본사가 아니면 이 페이지 스킵
      router.push("/signup/stores");
    }
  }, [router]);

  if (!mounted) {
    return null;
  }

  const role = sessionStorage.getItem("signupRole") as UserRole | null;

  const handleContinue = async () => {
    if (!selectedBrand) return;

    setIsLoading(true);
    setTimeout(() => {
      sessionStorage.setItem("signupBrand", selectedBrand);
      setIsLoading(false);
      router.push("/signup/stores");
    }, 800);
  };

  if (role !== "hq") {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <div className="flex flex-col min-h-screen">
        {/* Header */}
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <Link
              href="/signup/terms"
              className="flex items-center gap-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <ChevronLeft size={20} />
              <span className="text-sm font-medium">이전</span>
            </Link>
            <div className="text-sm text-[var(--color-text-tertiary)]">
              4단계 / 6단계
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
          <Card className="w-full max-w-2xl" padding="lg">
            {/* Title */}
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">
                브랜드 선택
              </h1>
              <p className="text-[var(--color-text-secondary)]">
                본사에서 관리하는 브랜드를 선택해주세요.
              </p>
            </div>

            {/* Brand List */}
            <div className="space-y-3 mb-8">
              {mockBrands.map((brand) => (
                <Card
                  key={brand.id}
                  onClick={() => setSelectedBrand(brand.id)}
                  padding="md"
                  className={`cursor-pointer transition-all ${
                    selectedBrand === brand.id
                      ? "ring-2 ring-[var(--color-primary)] shadow-lg"
                      : "hover:shadow-md"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--color-primary-light)]">
                      <Building2 size={24} className="text-[var(--color-primary)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-[var(--color-text-primary)]">
                        {brand.name}
                      </h3>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        브랜드 ID: {brand.id}
                      </p>
                    </div>
                    {selectedBrand === brand.id && (
                      <div className="flex-shrink-0">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-primary)]">
                          <span className="text-white text-sm font-bold">✓</span>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            {/* Button Group */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => router.push("/signup/terms")}
                className="w-full sm:w-auto"
              >
                <ChevronLeft size={18} />
                이전
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleContinue}
                disabled={!selectedBrand}
                isLoading={isLoading}
                className="w-full sm:w-auto"
              >
                다음
                <ArrowRight size={18} />
              </Button>
            </div>

            {/* Help Text */}
            <p className="mt-8 text-center text-sm text-[var(--color-text-tertiary)]">
              본사가 보유한 모든 브랜드를 표시합니다.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
