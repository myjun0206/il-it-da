"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ChevronRight, CircleCheck, Clock, MessageSquare, Search, X } from "lucide-react";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import BackToHomeLink from "@/components/hq/BackToHomeLink";
import { createClient } from "@/lib/supabase/client";

type InquiryStatus = "open" | "resolved";
type StatusFilter = "all" | InquiryStatus;

// 화면 표시용 형태. 현재 DB에는 문의·요청 테이블과 API가 없어 불러올 데이터가 없다.
interface StoreInquiry {
  id: string;
  storeName: string;
  category: string;
  content: string;
  authorName: string;
  createdAt: string;
  status: InquiryStatus;
}

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "open", label: "미처리" },
  { value: "resolved", label: "처리 완료" },
];

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("ko-KR");
}

function InquiryStatusBadge({ status }: { status: InquiryStatus }) {
  return status === "resolved" ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary-light)]/40 px-3 py-1 text-sm font-medium text-[var(--color-primary)]">
      <CircleCheck size={16} aria-hidden="true" />
      처리 완료
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
      <Clock size={16} aria-hidden="true" />
      미처리
    </span>
  );
}

// 홈 "미처리 문의·요청" 카드에서 진입하는 업무 화면 모드. 이 페이지의 "미처리" 필터와 같은 기준이다.
const UNRESOLVED_VIEW = "unresolved";

export default function HqStoreRequestsPage() {
  return (
    <Suspense fallback={null}>
      <HqStoreRequestsContent />
    </Suspense>
  );
}

function HqStoreRequestsContent() {
  const router = useRouter();
  const isUnresolvedView = useSearchParams().get("view") === UNRESOLVED_VIEW;
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("메가MGC커피");
  // 문의·요청 테이블/API가 생기면 franchise 범위로 제한된 서버 API 응답으로 채운다.
  const [inquiries] = useState<StoreInquiry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedInquiry, setSelectedInquiry] = useState<StoreInquiry | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const name = data.session?.user?.user_metadata?.name;
      if (name) {
        setUserName(name);
        const firstName = name.split(" ")[0];
        if (firstName) setFranchiseName(firstName);
      }
    };

    void loadUser();
  }, []);

  useEffect(() => {
    if (!selectedInquiry) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedInquiry(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedInquiry]);

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      router.push("/");
    }
  };

  const statCards = [
    { label: "전체 문의", value: inquiries.length },
    { label: "미처리", value: inquiries.filter((item) => item.status === "open").length },
    { label: "처리 완료", value: inquiries.filter((item) => item.status === "resolved").length },
  ];

  const filteredInquiries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (isUnresolvedView) {
      return inquiries.filter((item) => item.status === "open");
    }
    return inquiries.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!query) return true;
      return item.storeName.toLowerCase().includes(query) || item.content.toLowerCase().includes(query);
    });
  }, [inquiries, searchQuery, statusFilter, isUnresolvedView]);

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <HQSidebar
        userName={userName}
        franchiseName={franchiseName}
        onLogout={handleLogout}
        activeMenu={isUnresolvedView ? "home" : "store-request"}
      />

      <div className="lg:ml-[240px]">
        <HQHeader userName={userName} franchiseName={franchiseName} onLogout={handleLogout} />

        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {isUnresolvedView ? (
            <>
              <BackToHomeLink />
              <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">미처리 문의·요청</h1>
                  <p className="text-base text-[var(--color-text-secondary)]">
                    아직 처리되지 않은 지점의 문의와 요청을 확인합니다.
                  </p>
                </div>
                <Link
                  href="/hq/stores/requests"
                  className="inline-flex min-h-[44px] items-center gap-1 self-start rounded-lg px-2 text-sm font-medium text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:self-auto"
                >
                  전체 문의·요청 보기 <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
            </>
          ) : (
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">문의·요청</h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                지점에서 접수된 문의와 요청 사항을 확인할 수 있습니다.
              </p>
            </div>
          )}

          {/* Stats Cards */}
          <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 ${isUnresolvedView ? "hidden" : ""}`}>
            {statCards.map((card) => (
              <div key={card.label} className="bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm">
                <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-1">{card.label}</p>
                <p className="text-2xl font-bold text-[var(--color-text-primary)]">{card.value}건</p>
              </div>
            ))}
          </div>

          {isUnresolvedView && filteredInquiries.length === 0 ? (
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                <MessageSquare size={32} className="text-amber-600" aria-hidden="true" />
              </div>
              <p className="text-base text-[var(--color-text-secondary)] mb-2">미처리 문의·요청이 없습니다.</p>
              <p className="text-sm text-[var(--color-text-tertiary)]">현재 확인이 필요한 문의나 요청이 없습니다.</p>
            </div>
          ) : inquiries.length === 0 ? (
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                <MessageSquare size={32} className="text-amber-600" aria-hidden="true" />
              </div>
              <p className="text-base text-[var(--color-text-secondary)] mb-2">접수된 문의·요청이 없습니다.</p>
              <p className="text-sm text-[var(--color-text-tertiary)]">
                지점에서 문의나 요청 사항을 등록하면 이곳에서 확인할 수 있습니다.
              </p>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className={`mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between ${isUnresolvedView ? "hidden" : ""}`}>
                <div className="relative w-full md:max-w-sm">
                  <Search
                    size={18}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                  />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="지점명 또는 문의 내용으로 검색"
                    aria-label="지점명 또는 문의 내용으로 검색"
                    className="min-h-[44px] w-full rounded-lg border-2 border-[var(--color-border)] bg-white py-2.5 pl-11 pr-4 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30"
                  />
                </div>

                <div role="group" aria-label="처리 상태 필터" className="flex gap-2">
                  {FILTER_OPTIONS.map((option) => {
                    const isSelected = statusFilter === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setStatusFilter(option.value)}
                        className={`min-h-[44px] rounded-lg border-2 px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ${
                          isSelected
                            ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/30 text-[var(--color-primary)]"
                            : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {filteredInquiries.length === 0 ? (
                <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                  <Search size={28} className="mx-auto mb-3 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                  <p className="text-base text-[var(--color-text-secondary)]">검색 조건에 맞는 문의·요청이 없습니다.</p>
                </div>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden md:block bg-white border border-[var(--color-border)] rounded-xl shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <caption className="sr-only">문의·요청 목록</caption>
                        <thead className="bg-[var(--color-bg-default)] border-b border-[var(--color-border)]">
                          <tr>
                            <th scope="col" className="px-6 py-4 text-left text-sm font-bold text-[var(--color-text-primary)]">지점명</th>
                            <th scope="col" className="px-6 py-4 text-left text-sm font-bold text-[var(--color-text-primary)]">문의 유형</th>
                            <th scope="col" className="px-6 py-4 text-left text-sm font-bold text-[var(--color-text-primary)]">문의 내용</th>
                            <th scope="col" className="px-6 py-4 text-left text-sm font-bold text-[var(--color-text-primary)]">접수일</th>
                            <th scope="col" className="px-6 py-4 text-left text-sm font-bold text-[var(--color-text-primary)]">상태</th>
                            <th scope="col" className="px-6 py-4 text-center text-sm font-bold text-[var(--color-text-primary)]">관리</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredInquiries.map((item) => (
                            <tr key={item.id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-bg-default)] transition-colors">
                              <td className="px-6 py-4 text-base font-medium text-[var(--color-text-primary)]">{item.storeName}</td>
                              <td className="px-6 py-4 text-base text-[var(--color-text-secondary)]">{item.category}</td>
                              <td className="px-6 py-4 text-base text-[var(--color-text-primary)] max-w-md">
                                <p className="line-clamp-2">{item.content}</p>
                              </td>
                              <td className="px-6 py-4 text-base text-[var(--color-text-secondary)]">{formatDate(item.createdAt)}</td>
                              <td className="px-6 py-4">
                                <InquiryStatusBadge status={item.status} />
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button
                                  type="button"
                                  onClick={() => setSelectedInquiry(item)}
                                  aria-label={`${item.storeName} 문의 상세 보기`}
                                  className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                                >
                                  상세 보기 <ChevronRight size={16} aria-hidden="true" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Mobile Cards */}
                  <ul className="md:hidden space-y-3" aria-label="문의·요청 목록">
                    {filteredInquiries.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedInquiry(item)}
                          aria-label={`${item.storeName} 문의 상세 보기`}
                          className="block w-full text-left bg-white border border-[var(--color-border)] rounded-xl p-5 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                        >
                          <div className="mb-2 flex items-start justify-between gap-3">
                            <p className="text-base font-bold text-[var(--color-text-primary)]">{item.storeName}</p>
                            <ChevronRight size={20} className="mt-0.5 shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                          </div>
                          <p className="mb-3 line-clamp-2 text-base text-[var(--color-text-primary)]">{item.content}</p>
                          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                            <InquiryStatusBadge status={item.status} />
                            <span>{item.category}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatDate(item.createdAt)}</span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </main>
      </div>

      {/* Detail Modal */}
      {selectedInquiry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setSelectedInquiry(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="inquiry-detail-title"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-lg bg-white border border-[var(--color-border)] rounded-xl shadow-sm"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
              <h2 id="inquiry-detail-title" className="text-lg font-bold text-[var(--color-text-primary)]">
                문의·요청 상세
              </h2>
              <button
                type="button"
                onClick={() => setSelectedInquiry(null)}
                aria-label="닫기"
                autoFocus
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <dl className="space-y-4 px-6 py-5">
              {[
                { label: "지점명", value: selectedInquiry.storeName },
                { label: "문의 유형", value: selectedInquiry.category },
                { label: "작성자", value: selectedInquiry.authorName },
                { label: "접수일", value: formatDate(selectedInquiry.createdAt) },
              ].map((row) => (
                <div key={row.label} className="flex gap-4">
                  <dt className="w-20 shrink-0 text-sm text-[var(--color-text-secondary)]">{row.label}</dt>
                  <dd className="text-base text-[var(--color-text-primary)]">{row.value}</dd>
                </div>
              ))}
              <div className="flex gap-4">
                <dt className="w-20 shrink-0 text-sm text-[var(--color-text-secondary)]">상태</dt>
                <dd>
                  <InquiryStatusBadge status={selectedInquiry.status} />
                </dd>
              </div>
              <div>
                <dt className="mb-2 text-sm text-[var(--color-text-secondary)]">문의 내용</dt>
                <dd className="whitespace-pre-wrap rounded-lg bg-[var(--color-bg-default)] p-4 text-base text-[var(--color-text-primary)]">
                  {selectedInquiry.content}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
