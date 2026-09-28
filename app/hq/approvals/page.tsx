"use client";

import React, { useLayoutEffect, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleCheck, CircleX, Clock, UserCheck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedProfile } from "@/lib/auth/client-profile";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import BackToHomeLink from "@/components/hq/BackToHomeLink";

interface Membership {
  id: string;
  user_id: string;
  store_id: string;
  role: "owner" | "staff";
  status: "pending" | "requested" | "approved" | "rejected";
  requested_at: string;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  user_name?: string;
  store_name?: string;
  has_owner_conflict?: boolean;
  existing_owner_names?: string[];
}

interface ApprovalItem {
  membership: Membership;
}

type FilterStatus = "pending" | "approved" | "rejected" | "all";

function isPendingStatus(status: Membership["status"]): boolean {
  return status === "pending" || status === "requested";
}

export default function HQApprovalsPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("메가MGC커피");
  const [isReady, setIsReady] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [allApprovals, setAllApprovals] = useState<ApprovalItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("pending");
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    membershipId?: string;
    action?: "approve" | "reject";
    storeName?: string;
    userName?: string;
    role?: string;
    hasOwnerConflict?: boolean;
    existingOwnerNames?: string[];
  }>({ open: false });
  const [isProcessing, setIsProcessing] = useState(false);

  useLayoutEffect(() => {
    // Check Supabase session
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const profile = await getAuthenticatedProfile(supabase);

        // Verify user is HQ
        if (profile?.role !== "hq") {
          router.push("/");
          return;
        }
      } catch (e) {
        console.error("Auth check failed:", e);
        router.push("/");
      }
    };

    checkAuth();
  }, [router]);

  useEffect(() => {
    // Set user info from metadata
    const setUserInfo = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) return;

        const user = data.session.user;
        const name = user.user_metadata?.name;

        // Set user name from metadata
        if (name) {
          setUserName(name);
        }

        // Extract franchise name from user name
        if (name && name.includes(" ")) {
          const parts = name.split(" ");
          if (parts[0]) {
            setFranchiseName(parts[0]);
          }
        }

        setIsReady(true);
      } catch (e) {
        console.error("Set user info failed:", e);
        setIsReady(true);
      }
    };

    setUserInfo();
  }, []);

  const fetchApprovals = async () => {
    setIsLoading(true);
    try {
      // Always fetch complete data without status filter
      const response = await fetch(`/api/hq/approvals`, { credentials: "include" });
      const result = await response.json();

      if (result.success && Array.isArray(result.data)) {
        // Store all approvals for statistics (never filter here)
        setAllApprovals(result.data);
      } else {
        console.error("Failed to fetch approvals:", result.error);
        setAllApprovals([]);
      }
    } catch (e) {
      console.error("Fetch approvals error:", e);
      setAllApprovals([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch approvals only on initial load (isReady)
  useEffect(() => {
    const loadApprovals = async () => {
      setIsLoading(true);
      try {
        // Always fetch complete data without status filter
        const response = await fetch(`/api/hq/approvals`, { credentials: "include" });
        const result = await response.json();

        if (result.success && Array.isArray(result.data)) {
          // Store all approvals for statistics (never filter here)
          setAllApprovals(result.data);
        } else {
          console.error("Failed to fetch approvals:", result.error);
          setAllApprovals([]);
        }
      } catch (e) {
        console.error("Fetch approvals error:", e);
        setAllApprovals([]);
      } finally {
        setIsLoading(false);
      }
    };

    if (isReady) {
      loadApprovals();
    }
  }, [isReady]);

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
    } catch (e) {
      console.error("Logout failed:", e);
      router.push("/");
    }
  };

  const handleApprove = (
    membershipId: string,
    storeName: string,
    userName: string,
    role: string,
    hasOwnerConflict?: boolean,
    existingOwnerNames?: string[],
  ) => {
    setConfirmDialog({
      open: true,
      membershipId,
      action: "approve",
      storeName,
      userName,
      role,
      hasOwnerConflict,
      existingOwnerNames,
    });
  };

  const handleReject = (membershipId: string, storeName: string, userName: string, role: string) => {
    setConfirmDialog({
      open: true,
      membershipId,
      action: "reject",
      storeName,
      userName,
      role,
    });
  };

  const handleConfirmAction = async () => {
    if (!confirmDialog.membershipId || !confirmDialog.action) {
      return;
    }

    const membershipId = confirmDialog.membershipId;
    const action = confirmDialog.action;
    setIsProcessing(true);
    try {
      const response = await fetch("/api/hq/approvals", {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          membershipId,
          action,
        }),
      });

      const result = await response.json();

      if (result.success) {
        // Update only the membership that was approved/rejected.
        setAllApprovals((currentApprovals) =>
          currentApprovals.map((item) =>
            item.membership.id === membershipId && result.data
              ? { ...item, membership: { ...item.membership, ...result.data } }
              : item,
          ),
        );

        // Close dialog
        setConfirmDialog({ open: false });
      } else {
        alert(`Failed to ${action === "approve" ? "approve" : "reject"}: ${result.error}`);
      }
    } catch (e) {
      console.error("Action error:", e);
      alert("An error occurred while processing your request");
    } finally {
      setIsProcessing(false);
    }
  };

  const formatTimestamp = (timestamp?: string): string => {
    if (!timestamp) return "-";
    try {
      const date = new Date(timestamp);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${year}.${month}.${day} ${hours}:${minutes}`;
    } catch {
      return "-";
    }
  };

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case "pending":
      case "requested":
        return "승인 대기";
      case "approved":
        return "승인 완료";
      case "rejected":
        return "승인 거절";
      default:
        return status;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
      case "requested":
        return { className: "bg-amber-50 text-amber-800", Icon: Clock };
      case "approved":
        return { className: "bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]", Icon: CircleCheck };
      case "rejected":
        return { className: "bg-red-50 text-red-700", Icon: CircleX };
      default:
        return { className: "bg-amber-50 text-amber-800", Icon: Clock };
    }
  };

  if (!isReady) {
    return null;
  }

  // 통계는 항상 전체 데이터 기반 (필터와 무관)
  const pendingCount = allApprovals.filter((item) => isPendingStatus(item.membership.status)).length;
  const approvedCount = allApprovals.filter((item) => item.membership.status === "approved").length;
  const rejectedCount = allApprovals.filter((item) => item.membership.status === "rejected").length;

  // 테이블 표시는 필터된 데이터만
  const filteredApprovals =
    filterStatus === "all"
      ? allApprovals
          : allApprovals.filter((item: ApprovalItem) =>
              filterStatus === "pending"
                ? isPendingStatus(item.membership.status)
                : item.membership.status === filterStatus,
            );

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      {/* Sidebar */}
      <HQSidebar
        userName={userName}
        franchiseName={franchiseName}
        onLogout={handleLogout}
        activeMenu="home"
      />

      {/* Main Content */}
      <div className="lg:ml-[240px]">
        {/* Header */}
        <HQHeader userName={userName} franchiseName={franchiseName} onLogout={handleLogout} />

        {/* Content */}
        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Heading Section */}
          <BackToHomeLink />
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">승인 관리</h1>
            <p className="text-base text-[var(--color-text-secondary)]">
              본사에서 점주의 가입 및 지점 소속 요청을 검토하고 승인합니다.
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {[
              { label: "승인 대기", value: pendingCount },
              { label: "승인 완료", value: approvedCount },
              { label: "승인 거절", value: rejectedCount },
            ].map((card) => (
              <div key={card.label} className="bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm">
                <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-1">{card.label}</p>
                <p className="text-2xl font-bold text-[var(--color-text-primary)]">{card.value}건</p>
              </div>
            ))}
          </div>

          {/* Status Filter */}
          <div role="group" aria-label="승인 상태 필터" className="mb-6 flex flex-wrap gap-2">
            {(
              [
                { value: "pending", label: "승인 대기" },
                { value: "approved", label: "승인 완료" },
                { value: "rejected", label: "승인 거절" },
                { value: "all", label: "전체" },
              ] as { value: FilterStatus; label: string }[]
            ).map((option) => {
              const isSelected = filterStatus === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setFilterStatus(option.value)}
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

          {/* Approvals List */}
          {isLoading ? (
            <div className="bg-white border border-[var(--color-border)] rounded-xl p-8 shadow-sm text-center">
              <p className="text-base text-[var(--color-text-secondary)]" role="status">
                승인 요청을 불러오는 중입니다...
              </p>
            </div>
          ) : filteredApprovals.length === 0 ? (
            filterStatus === "pending" ? (
              <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                  <UserCheck size={32} className="text-amber-600" aria-hidden="true" />
                </div>
                <p className="text-base text-[var(--color-text-secondary)] mb-2">대기 중인 승인 요청이 없습니다.</p>
                <p className="text-sm text-[var(--color-text-tertiary)]">
                  새로운 점주 승인 요청이 접수되면 이곳에서 확인할 수 있습니다.
                </p>
              </div>
            ) : (
              <div className="bg-white border border-[var(--color-border)] rounded-xl p-12 text-center shadow-sm">
                <p className="text-base text-[var(--color-text-secondary)]">해당하는 승인 요청이 없습니다.</p>
              </div>
            )
          ) : (
            <div className="bg-white border border-[var(--color-border)] rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <caption className="sr-only">점주 승인 요청 목록</caption>
                  <thead className="bg-[var(--color-bg-default)] border-b border-[var(--color-border)]">
                    <tr>
                      <th scope="col" className="px-6 py-4 text-left text-sm font-bold text-[var(--color-text-primary)]">신청자</th>
                      <th scope="col" className="px-6 py-4 text-left text-sm font-bold text-[var(--color-text-primary)]">지점명</th>
                      <th scope="col" className="px-6 py-4 text-left text-sm font-bold text-[var(--color-text-primary)]">신청일</th>
                      <th scope="col" className="px-6 py-4 text-left text-sm font-bold text-[var(--color-text-primary)]">상태</th>
                      <th scope="col" className="px-6 py-4 text-right text-sm font-bold text-[var(--color-text-primary)]">관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApprovals.map((item, index) => {
                      const membership = item.membership;
                      const badge = getStatusBadge(membership.status);
                      const applicantName = membership.user_name || "이름 미등록";
                      const storeName = membership.store_name || "지점 정보 없음";
                      return (
                        <tr
                          key={membership.id || index}
                          className="border-t border-[var(--color-border)] hover:bg-[var(--color-bg-default)] transition-colors"
                        >
                          <td className="px-6 py-4 text-base font-medium text-[var(--color-text-primary)]">{applicantName}</td>
                          <td className="px-6 py-4 text-base text-[var(--color-text-primary)]">
                            <div className="space-y-2">
                              <p>{storeName}</p>
                              {membership.has_owner_conflict && (
                                <p className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700">
                                  ⚠️ 이미 다른 점주가 등록된 지점입니다.
                                </p>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-base text-[var(--color-text-secondary)]">
                            {formatTimestamp(membership.requested_at)}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${badge.className}`}>
                              <badge.Icon size={16} aria-hidden="true" />
                              {getStatusLabel(membership.status)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            {isPendingStatus(membership.status) ? (
                              <div className="flex gap-2 justify-end">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleApprove(
                                      membership.id,
                                      storeName,
                                      applicantName,
                                      membership.role || "owner",
                                      membership.has_owner_conflict,
                                      membership.existing_owner_names,
                                    )
                                  }
                                  aria-label={`${applicantName} 승인`}
                                  className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
                                >
                                  <Check size={16} aria-hidden="true" />
                                  승인
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleReject(membership.id, storeName, applicantName, membership.role || "owner")
                                  }
                                  aria-label={`${applicantName} 거절`}
                                  className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border-2 border-red-200 bg-white px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
                                >
                                  <X size={16} aria-hidden="true" />
                                  거절
                                </button>
                              </div>
                            ) : (
                              <span className="text-sm text-[var(--color-text-secondary)]">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Approval Confirmation Dialog */}
      {confirmDialog.open && confirmDialog.action === "approve" && (
        <div
          className="fixed inset-0 bg-black/35 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="approval-dialog-title"
        >
          {/* Overlay Click Handler */}
          <div
            className="absolute inset-0"
            onClick={() => setConfirmDialog({ open: false })}
            aria-hidden="true"
          />

          {/* Modal Content */}
          <div className="relative bg-white rounded-[18px] shadow-lg max-w-[520px] w-full p-8">
            {/* Header */}
            <div className="mb-6">
              <h2
                id="approval-dialog-title"
                className="text-2xl font-bold text-[var(--color-text-primary)]"
              >
                가입 승인
              </h2>
            </div>

            {/* Main Message */}
            <p className="text-base text-[var(--color-text-secondary)] mb-8">
              <span className="font-semibold text-[var(--color-text-primary)]">
                {confirmDialog.storeName}
              </span>
              의 점주 가입 요청을 승인하시겠습니까?
            </p>

            {confirmDialog.hasOwnerConflict && (
              <div className="mb-6 rounded-lg border-2 border-red-300 bg-red-50 p-4 text-red-800">
                <p className="font-bold">⚠️ [강한 경고]</p>
                <p className="mt-1 text-sm font-semibold">
                  해당 점포에 이미 다른 점장(Owner)이 등록되어 있습니다. 승인 시 기존 점장과의 권한 충돌이 발생할 수 있습니다.
                </p>
                {confirmDialog.existingOwnerNames && confirmDialog.existingOwnerNames.length > 0 && (
                  <p className="mt-2 text-xs">기존 점장: {confirmDialog.existingOwnerNames.join(", ")}</p>
                )}
              </div>
            )}

            {/* Application Info Card */}
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-lg p-6 mb-8">
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-1">
                    매장명
                  </p>
                  <p className="text-base font-semibold text-[var(--color-text-primary)]">
                    {confirmDialog.storeName}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-1">
                    신청자
                  </p>
                  <p className="text-base font-semibold text-[var(--color-text-primary)]">
                    {confirmDialog.userName}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-1">
                    유형
                  </p>
                  <p className="text-base font-semibold text-[var(--color-text-primary)]">
                    {confirmDialog.role === "owner" ? "점주" : "직원"}
                  </p>
                </div>
              </div>
            </div>

            {/* Description */}
            <p className="text-sm text-[var(--color-text-secondary)] mb-8">
              승인 후 해당 점주는 이 매장의 관리 기능을 사용할 수 있습니다.
            </p>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog({ open: false })}
                disabled={isProcessing}
                className="flex-1 px-4 py-3 border border-[var(--color-border)] rounded-lg font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleConfirmAction}
                disabled={isProcessing}
                className="flex-1 px-4 py-3 bg-[var(--color-primary)] text-white font-semibold rounded-lg hover:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] transition-all disabled:opacity-50"
              >
                {isProcessing ? "처리 중..." : "승인하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Confirmation Dialog */}
      {confirmDialog.open && confirmDialog.action === "reject" && (
        <div
          className="fixed inset-0 bg-black/35 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rejection-dialog-title"
        >
          {/* Overlay Click Handler */}
          <div
            className="absolute inset-0"
            onClick={() => setConfirmDialog({ open: false })}
            aria-hidden="true"
          />

          {/* Modal Content */}
          <div className="relative bg-white rounded-[18px] shadow-lg max-w-[520px] w-full p-8">
            {/* Header */}
            <div className="mb-6">
              <h2
                id="rejection-dialog-title"
                className="text-2xl font-bold text-[var(--color-text-primary)]"
              >
                가입 거절
              </h2>
            </div>

            {/* Main Message */}
            <p className="text-base text-[var(--color-text-secondary)] mb-8">
              <span className="font-semibold text-[var(--color-text-primary)]">
                {confirmDialog.storeName}
              </span>
              의 점주 가입 요청을 거절하시겠습니까?
            </p>

            {/* Application Info Card */}
            <div className="bg-gradient-to-br from-red-50 to-rose-50 border border-red-200 rounded-lg p-6 mb-8">
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-1">
                    매장명
                  </p>
                  <p className="text-base font-semibold text-[var(--color-text-primary)]">
                    {confirmDialog.storeName}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-1">
                    신청자
                  </p>
                  <p className="text-base font-semibold text-[var(--color-text-primary)]">
                    {confirmDialog.userName}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-1">
                    유형
                  </p>
                  <p className="text-base font-semibold text-[var(--color-text-primary)]">
                    {confirmDialog.role === "owner" ? "점주" : "직원"}
                  </p>
                </div>
              </div>
            </div>

            {/* Description */}
            <p className="text-sm text-[var(--color-text-secondary)] mb-8">
              이 가입 요청을 거절하면 해당 사용자는 다시 신청할 수 있습니다.
            </p>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog({ open: false })}
                disabled={isProcessing}
                className="flex-1 px-4 py-3 border border-[var(--color-border)] rounded-lg font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleConfirmAction}
                disabled={isProcessing}
                className="flex-1 px-4 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 transition-all disabled:opacity-50"
              >
                {isProcessing ? "처리 중..." : "거절하기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
