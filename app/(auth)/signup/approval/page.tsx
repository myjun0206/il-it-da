"use client";

import React, { useState, useLayoutEffect, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Trash2, Check, Plus, Store as StoreIcon } from "lucide-react";
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

export default function SignupApprovalPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [selectedStores, setSelectedStores] = useState<Store[]>([]);
  const [storeApprovals, setStoreApprovals] = useState<StoreApprovalState[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [submittingStoreIds, setSubmittingStoreIds] = useState<Set<string>>(new Set());

  // 역할 확인 및 라우팅
  useLayoutEffect(() => {
    const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
    if (!savedRole) {
      router.push("/signup/role");
      return;
    }

    if (savedRole === "hq") {
      router.push("/signup/complete");
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

    // 프로필 데이터에서 이름 가져오기
    const profileData = sessionStorage.getItem("signupProfile");
    if (profileData) {
      try {
        const parsed = JSON.parse(profileData);
        setUserName(parsed.name || "");
      } catch (e) {
        console.error("Failed to parse signupProfile:", e);
      }
    }

    // selectedStores 복원 (stores 페이지에서 저장한 형식)
    const savedSelectedStores = sessionStorage.getItem("signupSelectedStores");
    if (savedSelectedStores) {
      try {
        const parsed = JSON.parse(savedSelectedStores);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSelectedStores(parsed);

          // 기존 approval 상태 복원 또는 새로 생성
          const savedApprovals = sessionStorage.getItem("signupStoreApprovals");
          if (savedApprovals) {
            try {
              const existingApprovals = JSON.parse(savedApprovals);
              
              // 새로운 selectedStores와 기존 storeApprovals를 merge
              // 1. 새로운 store에 대해 기존 상태를 유지하거나 새로 생성
              // 2. 삭제된 매장(기존에는 있지만 새 list에는 없는 매장)은 제거
              const mergedApprovals = parsed.map((store: Store) => {
                const existingItem = existingApprovals.find(
                  (item: StoreApprovalState) => item.store.id === store.id
                );
                if (existingItem) {
                  // 기존 상태 유지
                  return { ...existingItem, store };
                } else {
                  // 새로운 매장
                  return {
                    store,
                    status: "requestable" as ApprovalStatus,
                  };
                }
              });
              
              setStoreApprovals(mergedApprovals);
            } catch {
              // 기존 상태가 없거나 파싱 실패하면 새로 생성
              const newApprovals = parsed.map((store: Store) => ({
                store,
                status: "requestable" as ApprovalStatus,
              }));
              setStoreApprovals(newApprovals);
            }
          } else {
            // 새로 생성
            const newApprovals = parsed.map((store: Store) => ({
              store,
              status: "requestable" as ApprovalStatus,
            }));
            setStoreApprovals(newApprovals);
          }
        }
      } catch (e) {
        console.error("Failed to parse signupSelectedStores:", e);
        router.push("/signup/stores");
      }
    } else {
      router.push("/signup/stores");
    }
  }, [router]);

  if (!role) {
    return null;
  }

  const handleDeleteStore = (storeId: string) => {
    setStoreApprovals((prev) => prev.filter((item) => item.store.id !== storeId));
    setSelectedStores((prev) => prev.filter((store) => store.id !== storeId));
  };

  const handleRequestApproval = async (storeId: string) => {
    setSubmittingStoreIds((prev) => new Set(prev).add(storeId));

    // 승인 요청 시뮬레이션
    await new Promise((resolve) => setTimeout(resolve, 600));

    setStoreApprovals((prev) =>
      prev.map((item) =>
        item.store.id === storeId
          ? {
              ...item,
              status: "pending" as ApprovalStatus,
              requestedAt: new Date().toISOString(),
            }
          : item
      )
    );

    setSubmittingStoreIds((prev) => {
      const next = new Set(prev);
      next.delete(storeId);
      return next;
    });
  };

  const handleDeleteAll = () => {
    setStoreApprovals([]);
    setSelectedStores([]);
    setShowConfirmDialog(false);
  };

  const handleRequestAll = async () => {
    const requestableApprovals = storeApprovals.filter(
      (item) => item.status === "requestable"
    );

    if (requestableApprovals.length === 0) return;

    setIsLoading(true);

    // 모든 신청 가능한 요청 제출
    await new Promise((resolve) => setTimeout(resolve, 800));

    // 새로운 상태 계산
    const updatedApprovals = storeApprovals.map((item) =>
      item.status === "requestable"
        ? {
            ...item,
            status: "pending" as ApprovalStatus,
            requestedAt: new Date().toISOString(),
          }
        : item
    );

    // 즉시 sessionStorage 업데이트
    sessionStorage.setItem("signupStoreApprovals", JSON.stringify(updatedApprovals));
    sessionStorage.setItem("signupApprovalStatus", "submitted");
    sessionStorage.setItem("signupApprovalSubmittedAt", new Date().toISOString());

    // 그 다음에 상태 업데이트
    setStoreApprovals(updatedApprovals);
    setIsLoading(false);

    // 승인 현황 페이지로 이동
    router.push("/signup/approval-status");
  };

  const handlePrevious = () => {
    // 현재 상태 저장
    sessionStorage.setItem("signupStoreApprovals", JSON.stringify(storeApprovals));
    router.push("/signup/stores");
  };

  const handleAddStore = () => {
    // 현재 상태 저장
    sessionStorage.setItem("signupStoreApprovals", JSON.stringify(storeApprovals));
    router.push("/signup/stores?mode=add");
  };

  const storeCount = selectedStores.length;
  const roleLabel = role === "owner" ? "점주" : "직원";
  const requestableCount = storeApprovals.filter((item) => item.status === "requestable").length;
  const pendingCount = storeApprovals.filter((item) => item.status === "pending").length;

  const isEmpty = selectedStores.length === 0;

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <div className="flex flex-col min-h-screen">
        {/* Header */}
        <header className="relative border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
          <div className="flex items-center justify-between px-5 sm:px-8 lg:px-12 xl:px-16 h-16 lg:h-[68px]">
            <button
              onClick={handlePrevious}
              className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors flex-shrink-0 bg-none border-none cursor-pointer"
            >
              <ChevronLeft size={24} className="flex-shrink-0" />
              <span className="text-base sm:text-lg lg:text-[17px] font-semibold hidden sm:inline">
                이전
              </span>
              <span className="text-base font-semibold sm:hidden">이전</span>
            </button>

            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex-shrink-0">
              <img
                src="/logo/ilitda-wordmark.png"
                alt="일잇다"
                className="h-8 sm:h-9 w-auto object-contain"
              />
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <span className="text-base sm:text-lg lg:text-[17px] font-semibold text-[var(--color-text-secondary)]">
                5 / 5
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
                가입 승인 요청
              </h1>
              <p className="text-base sm:text-lg text-[var(--color-text-secondary)]">
                선택하신 정보를 확인하고 승인 요청을 보내주세요.
              </p>
            </div>

            {isEmpty ? (
              // Empty State
              <div className="bg-white rounded-lg border border-[var(--color-border)] p-8 sm:p-12">
                <div className="text-center">
                  <p className="text-lg text-[var(--color-text-primary)] font-semibold mb-2">
                    신청할 매장이 없습니다.
                  </p>
                  <p className="text-base text-[var(--color-text-secondary)] mb-6">
                    이전 단계에서 매장을 선택해주세요.
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    onClick={handlePrevious}
                    className="w-full sm:w-48"
                  >
                    매장 선택으로 돌아가기
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* Section Header - Unified Row */}
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
                    가입 정보
                  </h2>
                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
                    <span className="text-base font-semibold text-[var(--color-text-secondary)]">
                      총 {storeCount}건
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowConfirmDialog(true)}
                      disabled={isEmpty}
                      className="h-9 px-3 sm:px-4 text-sm flex-shrink-0"
                    >
                      <Trash2 size={16} className="mr-1.5" />
                      모두 삭제
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={handleRequestAll}
                      disabled={requestableCount === 0 || isLoading}
                      className="h-9 px-3 sm:px-4 text-sm flex-shrink-0"
                    >
                      <Check size={16} className="mr-1.5" />
                      {isLoading ? "신청 중..." : "모두 승인 신청"}
                    </Button>
                  </div>
                </div>

                {/* Store Approval Cards */}
                <div className="space-y-3">
                  {storeApprovals.map((approval, index) => {
                    const store = approval.store;
                    const isSubmitting = submittingStoreIds.has(store.id);
                    const statusLabel =
                      approval.status === "requestable"
                        ? "신청 전"
                        : approval.status === "pending"
                        ? "승인 대기"
                        : approval.status === "approved"
                        ? "승인 완료"
                        : "승인 거절";

                    const statusColor =
                      approval.status === "requestable"
                        ? "text-[var(--color-text-secondary)]"
                        : approval.status === "pending"
                        ? "text-[var(--color-status-warning)]"
                        : approval.status === "approved"
                        ? "text-[var(--color-status-success)]"
                        : "text-[var(--color-status-error)]";

                    const requestedAtFormatted = formatTimestamp(approval.requestedAt);
                    const brandLogoPath = getBrandLogoPath(store.brandName);

                    return (
                      <div
                        key={store.id || index}
                        className="bg-white rounded-lg border border-[var(--color-border)] hover:shadow-sm transition-shadow"
                      >
                        {/* Card Grid: Logo | Main Info | Status & Actions */}
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
                          <div className="flex flex-col gap-3 min-w-0">
                            {/* Store Name - Title */}
                            <h3 className="text-base sm:text-lg font-semibold text-[var(--color-text-primary)] leading-snug">
                              {store.name}
                            </h3>

                            {/* Info Details - Three columns */}
                            <div className="grid grid-cols-3 gap-4 sm:gap-6">
                              <div className="min-w-0">
                                <p className="text-xs text-[var(--color-text-secondary)] font-medium mb-1">
                                  이름
                                </p>
                                <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                                  {userName || "정보 없음"}
                                </p>
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs text-[var(--color-text-secondary)] font-medium mb-1">
                                  유형
                                </p>
                                <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                                  {roleLabel}
                                </p>
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs text-[var(--color-text-secondary)] font-medium mb-1">
                                  신청 일시
                                </p>
                                <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                                  {requestedAtFormatted}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* RIGHT: Status & Actions */}
                          <div className="flex flex-col items-end gap-3 h-full justify-between">
                            {/* Status Section */}
                            <div className="text-right">
                              <p className="text-xs text-[var(--color-text-secondary)] font-medium mb-1">
                                신청 현황
                              </p>
                              <p className={`text-sm font-semibold whitespace-nowrap ${statusColor}`}>
                                {statusLabel}
                              </p>
                            </div>

                            {/* Actions Section */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteStore(store.id)}
                                className="h-8 px-3 text-xs sm:text-sm flex-shrink-0"
                              >
                                <Trash2 size={14} className="mr-1" />
                                삭제
                              </Button>
                              {approval.status === "requestable" ? (
                                <Button
                                  type="button"
                                  variant="primary"
                                  size="sm"
                                  onClick={() => handleRequestApproval(store.id)}
                                  disabled={isSubmitting}
                                  className="h-8 px-3 text-xs sm:text-sm flex-shrink-0"
                                >
                                  {isSubmitting ? "신청 중..." : "승인 신청"}
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={true}
                                  className="h-8 px-3 text-xs sm:text-sm flex-shrink-0"
                                >
                                  요청 완료
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Add Store Button */}
                <div className="mt-6 w-full">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddStore}
                    disabled={selectedStores.length >= 5}
                    className="w-full h-14 px-4 text-base font-medium flex items-center justify-center gap-2 hover:bg-[var(--color-primary)] hover:bg-opacity-5"
                  >
                    <Plus size={20} />
                    매장 추가
                  </Button>
                </div>

                {selectedStores.length >= 5 && (
                  <p className="text-xs text-[var(--color-text-secondary)] mt-2">
                    최대 5개까지 추가할 수 있습니다.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Confirm Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg max-w-sm w-full p-6">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
              모두 삭제하시겠습니까?
            </h2>
            <p className="text-base text-[var(--color-text-secondary)] mb-6">
              선택한 매장을 모두 삭제하시겠습니까?
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowConfirmDialog(false)}
                className="w-24 h-10"
              >
                취소
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleDeleteAll}
                className="w-24 h-10 bg-[var(--color-status-error)]"
              >
                모두 삭제
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
