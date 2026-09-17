"use client";

import React, { useLayoutEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, Clock, Mail } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import type { UserRole } from "@/lib/types/user";

export default function SignupCompletePage() {
  const router = useRouter();
  const [mounted] = useState(() => typeof window !== 'undefined');

  useLayoutEffect(() => {
    const role = sessionStorage.getItem("signupRole") as UserRole | null;
    if (!role) {
      router.push("/signup/role");
    }
  }, [router]);

  if (!mounted) {
    return null;
  }

  const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
  const status = savedRole === "hq" ? "completed" : "pending";

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <div className="flex flex-col min-h-screen">
        {/* Content */}
        <div className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
          <div className="w-full max-w-2xl">
            {status === "completed" ? (
              // 완료 상태
              <Card className="text-center" padding="lg">
                <div className="flex justify-center mb-6">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-primary-light)]">
                    <CheckCircle
                      size={40}
                      className="text-[var(--color-primary)]"
                    />
                  </div>
                </div>

                <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">
                  가입 완료!
                </h1>
                <p className="text-lg text-[var(--color-text-secondary)] mb-8">
                  일잇다에 오신 것을 환영합니다.
                </p>

                <div className="bg-[var(--color-primary-light)] p-6 rounded-lg mb-8 text-left">
                  <h3 className="font-semibold text-[var(--color-text-primary)] mb-4">
                    지금부터 할 수 있는 것들:
                  </h3>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-3">
                      <div className="mt-1 h-5 w-5 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                        ✓
                      </div>
                      <span className="text-[var(--color-text-primary)]">
                        매장 및 직원 관리
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="mt-1 h-5 w-5 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                        ✓
                      </div>
                      <span className="text-[var(--color-text-primary)]">
                        매뉴얼 배포 및 관리
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="mt-1 h-5 w-5 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                        ✓
                      </div>
                      <span className="text-[var(--color-text-primary)]">
                        AI 상담 활용
                      </span>
                    </li>
                  </ul>
                </div>

                <Link href="/login" className="block">
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    className="w-full"
                  >
                    로그인하기
                  </Button>
                </Link>

                <Link href="/" className="block mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    className="w-full"
                  >
                    홈으로 돌아가기
                  </Button>
                </Link>
              </Card>
            ) : (
              // 대기 상태
              <Card className="text-center" padding="lg">
                <div className="flex justify-center mb-6">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100">
                    <Clock size={40} className="text-orange-600" />
                  </div>
                </div>

                <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">
                  가입 신청이 완료되었습니다.
                </h1>
                <p className="text-lg text-[var(--color-text-secondary)] mb-8">
                  관리자의 승인을 기다리고 있습니다.
                </p>

                <div className="bg-orange-50 p-6 rounded-lg mb-8 text-left border border-orange-200">
                  <div className="flex gap-3 mb-4">
                    <Mail size={20} className="text-orange-600 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-[var(--color-text-primary)]">
                        승인 대기 중
                      </h3>
                      <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                        본사 관리자가 귀하의 가입 신청을 검토 중입니다.
                        <br />
                        보통 1-2일 소요되며, 결과는 이메일로 알려드립니다.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                <div className="space-y-4 mb-8 text-left">
                  <div className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-primary)]">
                        <CheckCircle
                          size={20}
                          className="text-white"
                        />
                      </div>
                      <div className="w-1 h-8 bg-[var(--color-border)]" />
                    </div>
                    <div className="pb-4">
                      <p className="font-semibold text-[var(--color-text-primary)]">
                        가입 신청 완료
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        이미 완료되었습니다.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)]">
                        <Clock size={16} className="text-[var(--color-text-tertiary)]" />
                      </div>
                      <div className="w-1 h-8 bg-[var(--color-border)]" />
                    </div>
                    <div className="pb-4">
                      <p className="font-semibold text-[var(--color-text-primary)]">
                        관리자 검토
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        진행 중...
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)]">
                        <CheckCircle
                          size={16}
                          className="text-[var(--color-text-tertiary)]"
                        />
                      </div>
                    </div>
                    <div>
                      <p className="font-semibold text-[var(--color-text-primary)]">
                        승인 완료
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        승인되면 시작할 수 있습니다.
                      </p>
                    </div>
                  </div>
                </div>

                <Link href="/" className="block">
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    className="w-full"
                  >
                    홈으로 돌아가기
                  </Button>
                </Link>

                <Link href="/login" className="block mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    className="w-full"
                  >
                    다시 로그인하기
                  </Button>
                </Link>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
