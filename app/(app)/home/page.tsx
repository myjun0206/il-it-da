"use client";

import React from "react";
import Link from "next/link";
import { BookOpen, MessageSquare, HelpCircle, ArrowRight } from "lucide-react";
import { Card } from "@/components/common/Card";
import { Button } from "@/components/common/Button";

export default function StaffHomePage() {
  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">
          안녕하세요! 👋
        </h1>
        <p className="text-lg text-[var(--color-text-secondary)]">
          매장의 업무를 더 쉽게 배우고 관리하세요.
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Manuals */}
        <Link href="/app/manuals">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
            <div className="flex flex-col items-start">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--color-primary-light)] mb-4">
                <BookOpen
                  size={24}
                  className="text-[var(--color-primary)]"
                />
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                매뉴얼
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)] mb-4 flex-1">
                업무 매뉴얼을 확인하세요
              </p>
              <ArrowRight size={16} className="text-[var(--color-primary)]" />
            </div>
          </Card>
        </Link>

        {/* AI Chat */}
        <Link href="/app/chat">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
            <div className="flex flex-col items-start">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-100 mb-4">
                <MessageSquare size={24} className="text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                AI 상담
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)] mb-4 flex-1">
                업무에 대해 물어보세요
              </p>
              <ArrowRight size={16} className="text-[var(--color-primary)]" />
            </div>
          </Card>
        </Link>

        {/* FAQ */}
        <Link href="/app/faq">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full">
            <div className="flex flex-col items-start">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100 mb-4">
                <HelpCircle size={24} className="text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                자주 묻는 질문
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)] mb-4 flex-1">
                일반적인 질문을 확인하세요
              </p>
              <ArrowRight size={16} className="text-[var(--color-primary)]" />
            </div>
          </Card>
        </Link>
      </div>

      {/* Recent Updates */}
      <div>
        <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-4">
          최근 업데이트
        </h2>
        <div className="space-y-3">
          {[
            {
              title: "매뉴얼 - 새로운 POS 사용법",
              date: "2024년 1월 15일",
              type: "매뉴얼",
            },
            {
              title: "직원 안내 - 2월 근무표 공지",
              date: "2024년 1월 12일",
              type: "공지사항",
            },
            {
              title: "매뉴얼 - 상품 구성 변경",
              date: "2024년 1월 10일",
              type: "매뉴얼",
            },
          ].map((item, idx) => (
            <Card key={idx} padding="md">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-[var(--color-text-primary)]">
                    {item.title}
                  </h3>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                    {item.date}
                  </p>
                </div>
                <span className="flex-shrink-0 text-xs font-bold px-3 py-1 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)]">
                  {item.type}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Tips */}
      <Card padding="lg" className="bg-gradient-to-r from-[var(--color-primary-light)] to-[var(--color-secondary-light)]">
        <div>
          <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-2">
            💡 팁
          </h3>
          <p className="text-[var(--color-text-secondary)]">
            AI 상담에 정확한 질문을 할수록 더 좋은 답변을 받을 수 있습니다.
            예를 들어, "POS 매출 현황"이 "사용법이 뭔데?" 보다 더 유용한 답변을 받습니다.
          </p>
        </div>
      </Card>
    </div>
  );
}
