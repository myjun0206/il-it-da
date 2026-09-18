"use client";

import React, { useState, useLayoutEffect, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Store as StoreIcon } from "lucide-react";
import { Button } from "@/components/common/Button";
import { getBrandLogoPath } from "@/lib/brands/brand-logos";
import type { UserRole } from "@/lib/types/user";
import type { Store } from "@/lib/types/store";

type ApprovalStatus = "requestable" | "pending" | "approved" | "rejected";

interface StoreApprovalState {
  store: Store;
  status: ApprovalStatus;
  requestedAt?: string;
}

// 타임스탬프를 한국식 날짜로 포맷
function formatTimestamp(timestamp?: string): string {
  if (!timestamp) return "-";
  try {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const period = hours >= 12 ? "오후" : "오전";
    const displayHours = String(hours % 12 || 12).padStart(2, "0");
    return `${year}.${month}.${day} ${period} ${displayHours}:${minutes}`;
  } catch {
    return "-";
  }
}

export default function SignupApprovalStatusPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [storeApprovals, setStoreApprovals] = useState<StoreApprovalState[]>([]);

  // 역할 확인 및 라우팅
  useLayoutEffect(() => {
    const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
    
    if (!savedRole || savedRole === "hq") {
      router.push(savedRole === "hq" ? "/signup/complete" : "/signup/role");
    }
  }, [router]);

  // State 업데이트
  useEffect(() => {
    const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
    
    if (!savedRole || savedRole === "hq") {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRole(savedRole);

    // 승인 요청 상태 복원
    const savedApprovals = sessionStorage.getItem("signupStoreApprovals");
    if (savedApprovals) {
      try {
        const approvals = JSON.parse(savedApprovals) as StoreApprovalState[];
        setStoreApprovals(approvals);
      } catch (e) {
        console.error("Failed to parse signupStoreApprovals:", e);
      }
    }
  }, []);

  if (!role) {
    return null;
  }

  const handleGoToHome = () => {
    // 세션 정리
    sessionStorage.removeItem("signupRole");
    sessionStorage.removeItem("signupProfile");
    sessionStorage.removeItem("signupSelectedStores");
    sessionStorage.removeItem("signupStores");
    sessionStorage.removeItem("signupStoreApprovals");
    sessionStorage.removeItem("signupApprovalStatus");
    sessionStorage.removeItem("signupApprovalSubmittedAt");

    // 역할에 따라 이동
    if (role === "owner") {
      router.push("/home-owner");
    } else if (role === "staff") {
      router.push("/home-owner"); // 직원도 같은 페이지로
    } else {
      router.push("/");
    }
  };

  const handleAddStore = () => {
    // 현재 storeApprovals를 저장한 상태로 stores 페이지로 이동
    sessionStorage.setItem("signupStoreApprovals", JSON.stringify(storeApprovals));
    
    // 기존 storeApprovals의 매장들을 selectedStores로 설정
    // (이미 승인 요청한 매장들을 보여주되 새 매장만 추가할 수 있게)
    const existingStores = storeApprovals.map(item => item.store);
    sessionStorage.setItem("signupSelectedStores", JSON.stringify(existingStores));
    
    router.push("/signup/stores?mode=add");
  };

  const roleLabel = role === "owner" ? "점주" : "직원";

  // 상태별 카운트
  const totalCount = storeApprovals.length;
  const pendingCount = storeApprovals.filter((item) => item.status === "pending").length;
  const approvedCount = storeApprovals.filter((item) => item.status === "approved").length;
  const rejectedCount = storeApprovals.filter((item) => item.status === "rejected").length;

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <div className="flex flex-col min-h-screen">
        {/* Header */}
        <header className="relative border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
          <div className="flex items-center justify-between px-5 sm:px-8 lg:px-12 xl:px-16 h-16 lg:h-[68px]">
            <div className="flex-shrink-0" />

            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex-shrink-0">
              <img
                src="/logo/ilitda-wordmark.png"
                alt="일잇다"
                className="h-8 sm:h-9 w-auto object-contain"
              />
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <span className="text-base sm:text-lg lg:text-[17px] font-semibold text-[var(--color-text-secondary)]">
                완료
              </span>
              <div className="w-20 sm:w-28 h-2 bg-[var(--color-border-light)] rounded-full overflow-hidden flex-shrink-0">
                <div
                  className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-300"
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex flex-col px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="w-full max-w-6xl mx-auto">
            {/* Title Section - Left Aligned */}
            <div className="mb-6 sm:mb-8">
              <h1 className="text-3xl sm:text-4xl font-bold text-[var(--color-text-primary)] mb-2">
                승인 현황
              </h1>
              <p className="text-base sm:text-lg text-[var(--color-text-secondary)]">
                요청하신 가입 승인 현황을 확인해주세요.
              </p>
            </div>

            {/* Section Header - Simplified */}
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
                승인 요청
              </h2>
              <span className="text-base font-semibold text-[var(--color-text-secondary)]">
                총 {totalCount}건
              </span>
            </div>

            {/* Approval Cards */}
            <div className="space-y-3 mb-8">
              {storeApprovals.map((approval, index) => {
                const store = approval.store;
                const statusLabel =
                  approval.status === "pending"
                    ? "승인 대기"
                    : approval.status === "approved"
                    ? "승인 완료"
                    : approval.status === "rejected"
                    ? "승인 거절"
                    : "신청 전";

                const statusColor =
                  approval.status === "pending"
                    ? "text-[var(--color-status-warning)]"
                    : approval.status === "approved"
                    ? "text-[var(--color-status-success)]"
                    : approval.status === "rejected"
                    ? "text-[var(--color-status-error)]"
                    : "text-[var(--color-text-secondary)]";

                const requestedAtFormatted = formatTimestamp(approval.requestedAt);
                const brandLogoPath = getBrandLogoPath(store.brandName);
                const roleLabel = role === "owner" ? "점주" : "직원";

                return (
                  <div
                    key={store.id || index}
                    className="bg-white rounded-lg border border-[var(--color-border)] hover:shadow-sm transition-shadow"
                  >
                    {/* Card Grid: Logo | Main Info | Status */}
                    <div className="grid grid-cols-[80px_1fr_auto] sm:grid-cols-[100px_1fr_auto] gap-4 p-4 sm:p-5 min-h-[160px] items-start">
                      
                      {/* LEFT: Brand Logo Area */}
                      <div className="flex items-start justify-center">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border)] flex items-center justify-center overflow-hidden flex-shrink-0">
                          {brandLogoPath ? (
                            <>
                              <img 
                                src={brandLogoPath} 
                                alt={store.brandName || "브랜드"}
                                className="w-full h-full object-contain p-2"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                  const fallbackIcon = e.currentTarget.nextElementSibling as HTMLElement;
                                  if (fallbackIcon) {
                                    fallbackIcon.style.display = "flex";
                                  }
                                }}
                              />
                              <div style={{ display: "none" }} className="w-full h-full flex items-center justify-center">
                                <StoreIcon size={28} className="text-[var(--color-text-secondary)]" />
                              </div>
                            </>
                          ) : (
                            <StoreIcon size={28} className="text-[var(--color-text-secondary)]" />
                          )}
                        </div>
                      </div>

                      {/* CENTER: Main Information */}
                      <div className="flex flex-col gap-3">
                        <h3 className="text-base sm:text-lg font-semibold text-[var(--color-text-primary)]">
                          {store.name}
                        </h3>
                        <div className="grid grid-cols-2 gap-4 sm:gap-6">
                          <div>
                            <p className="text-xs text-[var(--color-text-secondary)] font-medium mb-1">
                              유형
                            </p>
                            <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                              {roleLabel}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-[var(--color-text-secondary)] font-medium mb-1">
                              신청 일시
                            </p>
                            <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                              {requestedAtFormatted}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* RIGHT: Status */}
                      <div className="flex flex-col items-end gap-2">
                        <div className="text-right">
                          <div className="text-xs text-[var(--color-text-secondary)] font-medium">
                            신청 현황
                          </div>
                          <div className={`text-sm font-semibold ${statusColor}`}>
                            {statusLabel}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add Store Button */}
            <div className="mt-6 w-full mb-8">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddStore}
                className="w-full h-14 px-4 text-base font-medium flex items-center justify-center gap-2 hover:bg-[var(--color-primary)] hover:bg-opacity-5"
              >
                <Plus size={20} />
                매장 추가
              </Button>
            </div>

            {/* Button Group */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={handleGoToHome}
                className="w-full sm:w-48"
              >
                <Check size={18} className="mr-2" />
                확인
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
