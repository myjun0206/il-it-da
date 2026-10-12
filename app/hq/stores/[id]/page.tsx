"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, FileText, Users, UserRound } from "lucide-react";
import { useParams } from "next/navigation";
import type { HqStoreSummary } from "@/lib/types/store";

type StoreMember = {
  id: string;
  userId: string;
  role: "owner" | "staff";
  status: string;
  requestedAt: string;
  approvedAt: string | null;
  name: string;
  email: string | null;
};

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("ko-KR");
}

export default function HqStoreDetailPage() {
  const params = useParams<{ id: string }>();
  const [store, setStore] = useState<HqStoreSummary | null>(null);
  const [staffMembers, setStaffMembers] = useState<StoreMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [membersError, setMembersError] = useState("");

  useEffect(() => {
    const loadStore = async () => {
      try {
        const storesResponse = await fetch("/api/hq/stores");
        const storesData = (await storesResponse.json()) as { stores?: HqStoreSummary[]; error?: string };

        if (!storesResponse.ok) throw new Error(storesData.error || "지점 정보를 불러오지 못했습니다.");

        const selectedStore = storesData.stores?.find((item) => item.id === params.id) ?? null;
        if (!selectedStore) {
          setErrorMessage("지점 정보를 찾을 수 없습니다.");
          return;
        }

        setStore(selectedStore);
      } catch (error) {
        console.error("Failed to load HQ store:", error);
        setErrorMessage(error instanceof Error ? error.message : "지점 정보를 불러오지 못했습니다.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadStore();
  }, [params.id]);

  useEffect(() => {
    if (!store?.id) return;

    const loadMembers = async () => {
      setIsLoadingMembers(true);
      setMembersError("");
      try {
        const response = await fetch(`/api/hq/stores/${store.id}/members`);
        const data = (await response.json()) as { members?: StoreMember[]; error?: string };

        if (!response.ok) {
          throw new Error(data.error || "직원 목록을 불러오지 못했습니다.");
        }

        setStaffMembers(data.members ?? []);
      } catch (error) {
        console.error("Failed to load members:", error);
        setMembersError(error instanceof Error ? error.message : "직원 목록을 불러오지 못했습니다.");
      } finally {
        setIsLoadingMembers(false);
      }
    };

    void loadMembers();
  }, [store?.id]);



  return (
    <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          <Link
            href="/hq/stores"
            className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]"
          >
            <ArrowLeft size={16} /> 지점 현황으로 돌아가기
          </Link>

          {isLoading ? (
            <div className="rounded-lg border border-[var(--color-border)] bg-white p-8 text-center text-sm text-[var(--color-text-secondary)] shadow-sm">
              지점 정보를 불러오는 중...
            </div>
          ) : errorMessage ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">{errorMessage}</div>
          ) : store ? (
            <>
              {/* 상단 페이지 헤더 */}
              <div className="mb-8">
                <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{store.name}</h1>
              </div>

              {/* 중간 통계 카드 - 2열 */}
              <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* 등록된 직원 */}
                <div className="rounded-lg border border-[var(--color-border)] bg-white p-6 shadow-sm">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary)]">
                    <Users size={20} aria-hidden="true" />
                  </div>
                  <p className="text-sm text-[var(--color-text-secondary)] mb-2">등록된 직원</p>
                  <p className="text-3xl font-bold text-[var(--color-text-primary)]">{store.staffCount}<span className="text-lg font-medium">명</span></p>
                </div>

                {/* 지점 매뉴얼 */}
                <div className="rounded-lg border border-[var(--color-border)] bg-white p-6 shadow-sm">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary)]">
                    <FileText size={20} aria-hidden="true" />
                  </div>
                  <p className="text-sm text-[var(--color-text-secondary)] mb-2">지점 매뉴얼</p>
                  <p className="text-3xl font-bold text-[var(--color-text-primary)]">{store.manualCount}<span className="text-lg font-medium">개</span></p>
                </div>
              </div>

              {/* 지점 기본 정보 카드 */}
              <div className="mb-8 rounded-lg border border-[var(--color-border)] bg-white p-6 shadow-sm">
                <h2 className="mb-6 text-lg font-semibold text-[var(--color-text-primary)]">지점 기본 정보</h2>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  {/* 지점명 */}
                  <div>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">지점명</p>
                    <p className="text-base font-medium text-[var(--color-text-primary)]">{store.name}</p>
                  </div>

                  {/* 점주 */}
                  <div>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">점주</p>
                    <p className="text-base font-medium text-[var(--color-text-primary)]">
                      {store.ownerNames.length > 0 ? store.ownerNames.join(", ") : "미지정"}
                    </p>
                  </div>

                  {/* 등록일 */}
                  <div>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">등록일</p>
                    <p className="text-base font-medium text-[var(--color-text-primary)]">{formatDate(store.createdAt)}</p>
                  </div>
                </div>
              </div>

              {/* 소속 직원 섹션 */}
              <div className="rounded-lg border border-[var(--color-border)] bg-white shadow-sm">
                <div className="border-b border-[var(--color-border)] p-6">
                  <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                    소속 직원 {isLoadingMembers ? "" : `(${staffMembers.length}명)`}
                  </h2>
                </div>

                {isLoadingMembers ? (
                  <div className="p-6 text-center text-sm text-[var(--color-text-secondary)]">
                    직원 정보를 불러오는 중...
                  </div>
                ) : membersError ? (
                  <div className="p-6 text-sm text-red-700">{membersError}</div>
                ) : staffMembers.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-sm text-[var(--color-text-secondary)]">등록된 직원이 없습니다.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 p-6">
                    {staffMembers.map((member) => (
                      <div
                        key={member.id}
                        className="min-h-[96px] flex items-center gap-4 rounded-lg border border-[var(--color-border)] bg-white p-5 hover:bg-[var(--color-bg-default)] transition-colors"
                      >
                        {/* 왼쪽 프로필 아이콘 */}
                        <div className="flex-shrink-0 w-14 h-14 rounded-full bg-[var(--color-primary-light)]/30 flex items-center justify-center">
                          <UserRound size={28} className="text-[var(--color-primary)]" aria-hidden="true" />
                        </div>

                        {/* 중앙 직원 정보 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <p className="text-base font-semibold text-[var(--color-text-primary)] truncate">
                              {member.name}
                            </p>
                            <span
                              className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 whitespace-nowrap ${
                                member.role === "owner"
                                  ? "bg-[var(--color-primary-light)]/20 text-[var(--color-primary)]"
                                  : "bg-[var(--color-border)]/50 text-[var(--color-text-secondary)]"
                              }`}
                            >
                              {member.role === "owner" ? "점주" : "직원"}
                            </span>
                          </div>
                          {member.email && (
                            <p className="text-sm text-[var(--color-text-secondary)] truncate">
                              {member.email}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </main>
      );
}