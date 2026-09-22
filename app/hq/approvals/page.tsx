"use client";

import React, { useLayoutEffect, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";

interface Membership {
  id: string;
  user_id: string;
  store_id: string;
  role: "owner" | "staff";
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  user_name?: string;
  store_name?: string;
}

interface ApprovalItem {
  membership: Membership;
}

type FilterStatus = "pending" | "approved" | "rejected" | "all";

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
  }>({ open: false });
  const [isProcessing, setIsProcessing] = useState(false);

  useLayoutEffect(() => {
    // Check Supabase session
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) {
          router.push("/");
          return;
        }

        const user = data.session.user;
        const role = user.user_metadata?.role;

        // Verify user is HQ
        if (role !== "hq") {
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
      const response = await fetch(`/api/hq/approvals`);
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
        const response = await fetch(`/api/hq/approvals`);
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

  const handleApprove = (membershipId: string, storeName: string, userName: string, role: string) => {
    setConfirmDialog({
      open: true,
      membershipId,
      action: "approve",
      storeName,
      userName,
      role,
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

    setIsProcessing(true);
    try {
      const response = await fetch("/api/hq/approvals", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          membershipId: confirmDialog.membershipId,
          action: confirmDialog.action,
        }),
      });

      const result = await response.json();

      if (result.success) {
        // Refresh the complete approvals list (allApprovals only)
        setIsLoading(true);
        try {
          const refreshResponse = await fetch(`/api/hq/approvals`);
          const refreshResult = await refreshResponse.json();

          if (refreshResult.success && Array.isArray(refreshResult.data)) {
            // Update all approvals only (no filtering here)
            setAllApprovals(refreshResult.data);
          }
        } finally {
          setIsLoading(false);
        }

        // Close dialog
        setConfirmDialog({ open: false });
      } else {
        alert(`Failed to ${confirmDialog.action === "approve" ? "approve" : "reject"}: ${result.error}`);
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
        return "승인 대기";
      case "approved":
        return "승인 완료";
      case "rejected":
        return "승인 거절";
      default:
        return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-700";
      case "approved":
        return "bg-green-100 text-green-700";
      case "rejected":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  if (!isReady) {
    return null;
  }

  // 통계는 항상 전체 데이터 기반 (필터와 무관)
  const pendingCount = allApprovals.filter((item) => item.membership.status === "pending").length;
  const approvedCount = allApprovals.filter((item) => item.membership.status === "approved").length;
  const rejectedCount = allApprovals.filter((item) => item.membership.status === "rejected").length;

  // 테이블 표시는 필터된 데이터만
  const filteredApprovals =
    filterStatus === "all"
      ? allApprovals
      : allApprovals.filter(
          (item: ApprovalItem) => item.membership.status === filterStatus
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
        <HQHeader userName={userName} franchiseName={franchiseName} />

        {/* Content */}
        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Heading Section */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
              승인 관리
            </h1>
            <p className="text-base text-[var(--color-text-secondary)]">
              점주의 가입 요청을 확인하고 승인할 수 있습니다.
            </p>
          </div>

          {/* Filters */}
          <div className="mb-8 space-y-4">
            {/* Status Filter */}
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">
                상태
              </h3>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFilterStatus("all");
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    filterStatus === "all"
                      ? "bg-[var(--color-primary)] text-white"
                      : "border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]"
                  }`}
                >
                  전체
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFilterStatus("pending");
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    filterStatus === "pending"
                      ? "bg-[var(--color-primary)] text-white"
                      : "border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]"
                  }`}
                >
                  승인 대기
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFilterStatus("approved");
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    filterStatus === "approved"
                      ? "bg-[var(--color-primary)] text-white"
                      : "border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]"
                  }`}
                >
                  승인 완료
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFilterStatus("rejected");
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    filterStatus === "rejected"
                      ? "bg-[var(--color-primary)] text-white"
                      : "border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]"
                  }`}
                >
                  승인 거절
                </button>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="mb-8 grid grid-cols-3 gap-4 pointer-events-none">
            <div className="bg-white border border-[var(--color-border)] rounded-lg p-4">
              <p className="text-sm text-[var(--color-text-secondary)] mb-1">승인 대기</p>
              <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
            </div>
            <div className="bg-white border border-[var(--color-border)] rounded-lg p-4">
              <p className="text-sm text-[var(--color-text-secondary)] mb-1">승인 완료</p>
              <p className="text-2xl font-bold text-green-600">{approvedCount}</p>
            </div>
            <div className="bg-white border border-[var(--color-border)] rounded-lg p-4">
              <p className="text-sm text-[var(--color-text-secondary)] mb-1">승인 거절</p>
              <p className="text-2xl font-bold text-red-600">{rejectedCount}</p>
            </div>
          </div>

          {/* Approvals List */}
          <div className="bg-white border border-[var(--color-border)] rounded-lg overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center">
                <p className="text-[var(--color-text-secondary)]">승인 요청을 불러오는 중입니다...</p>
              </div>
            ) : filteredApprovals.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-[var(--color-text-secondary)]">
                  {filterStatus === "pending" ? "대기 중인 승인 요청이 없습니다." : "해당하는 승인 요청이 없습니다."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
                      <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                        신청자
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                        매장명
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                        신청 일시
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                        상태
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-[var(--color-text-primary)]">
                        관리
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApprovals.map((item, index) => {
                      const membership = item.membership;
                      return (
                        <tr
                          key={membership.id || index}
                          className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-surface)] transition-colors last:border-b-0"
                        >
                          <td className="px-6 py-4 text-sm text-[var(--color-text-primary)] font-medium">
                            {membership.user_name || "Unknown"}
                          </td>
                          <td className="px-6 py-4 text-sm text-[var(--color-text-primary)]">
                            {membership.store_name || "Unknown"}
                          </td>
                          <td className="px-6 py-4 text-sm text-[var(--color-text-secondary)]">
                            {formatTimestamp(membership.requested_at)}
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`px-3 py-1 rounded text-sm font-medium inline-block ${getStatusColor(
                                membership.status
                              )}`}
                            >
                              {getStatusLabel(membership.status)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            {membership.status === "pending" ? (
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() =>
                                    handleApprove(
                                      membership.id,
                                      membership.store_name || "Unknown",
                                      membership.user_name || "Unknown",
                                      membership.role || "owner"
                                    )
                                  }
                                  className="px-3 py-1.5 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors font-medium text-sm flex items-center gap-1"
                                  title="승인"
                                >
                                  <Check size={16} />
                                  승인
                                </button>
                                <button
                                  onClick={() =>
                                    handleReject(
                                      membership.id,
                                      membership.store_name || "Unknown",
                                      membership.user_name || "Unknown",
                                      membership.role || "owner"
                                    )
                                  }
                                  className="px-3 py-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors font-medium text-sm flex items-center gap-1"
                                  title="거절"
                                >
                                  <X size={16} />
                                  거절
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--color-text-secondary)]">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
