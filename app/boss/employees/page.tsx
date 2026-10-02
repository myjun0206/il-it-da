"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import { resolveOwnerCurrentStore } from "@/lib/owner/current-store";
import { Input } from "@/components/common/Input";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

interface StaffMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  approvedAt?: string;
  /** 승인됐지만 브랜드 프로필이 없어 승인 마무리가 필요한 상태. */
  needsBrandProfileRecovery?: boolean;
}

interface EmployeesData {
  pending: StaffMember[];
  approved: StaffMember[];
  summary: {
    total: number;
    pending: number;
    approved: number;
  };
}

// 날짜 포맷팅
function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}.${month}.${day}`;
  } catch {
    return "";
  }
}

export default function EmployeesPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [userName, setUserName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [employees, setEmployees] = useState<EmployeesData>({
    pending: [],
    approved: [],
    summary: { total: 0, pending: 0, approved: 0 },
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [removeTarget, setRemoveTarget] = useState<StaffMember | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  // 상태 반영 전 연타·키 반복에도 요청이 한 번만 나가도록 동기 플래그로 막는다.
  const removingRef = useRef(false);

  // Auth 확인
  useLayoutEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user || data.session.user.user_metadata?.role !== "owner") {
          router.push("/");
          return;
        }

        setIsReady(true);
      } catch (e) {
        console.error("Auth check failed:", e);
        router.push("/");
      }
    };

    checkAuth();
  }, [router]);

  // 사용자 정보 및 매장 로드
  useEffect(() => {
    const loadUserAndStoreInfo = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) {
          setIsLoading(false);
          return;
        }

        const name = data.session.user.user_metadata?.name || "점주";
        setUserName(name);

        // 점주 공통 현재 매장 결정 (approved owner membership → store)
        const resolution = await resolveOwnerCurrentStore();
        if (resolution.status === "error") {
          setError("매장 정보를 불러올 수 없습니다.");
          setIsLoading(false);
          return;
        }
        if (!resolution.current) {
          setError("승인된 매장이 없습니다.");
          setIsLoading(false);
          return;
        }
        setSelectedStoreId(resolution.current.storeId);
        setStoreName(resolution.current.storeName);
      } catch (e) {
        console.error("Failed to load user info:", e);
        setIsLoading(false);
      }
    };

    if (isReady) {
      loadUserAndStoreInfo();
    }
  }, [isReady]);

  // 직원 목록 조회
  useEffect(() => {
    const fetchEmployees = async () => {
      if (!selectedStoreId) return;

      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/boss/employees?storeId=${selectedStoreId}`);
        const data = (await response.json()) as { success: boolean; data?: EmployeesData; error?: string };

        if (!response.ok || !data.success) {
          throw new Error(data.error || "직원 목록을 불러올 수 없습니다.");
        }

        setEmployees(data.data || { pending: [], approved: [], summary: { total: 0, pending: 0, approved: 0 } });
      } catch (e) {
        console.error("Failed to fetch employees:", e);
        setError(e instanceof Error ? e.message : "직원 목록을 불러올 수 없습니다.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchEmployees();
  }, [selectedStoreId]);

  // 토스트 메시지
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(""), 2500);
  };

  // 직원 상태 변경
  const handleChangeStatus = async (membershipId: string, newStatus: "approved" | "rejected") => {
    setProcessingId(membershipId);

    try {
      const response = await fetch(`/api/boss/employees/${membershipId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = (await response.json()) as { success: boolean; error?: string };

      if (!response.ok || !data.success) {
        throw new Error(data.error || "상태 변경에 실패했습니다.");
      }

      // 목록 새로고침
      const listResponse = await fetch(`/api/boss/employees?storeId=${selectedStoreId}`);
      const listData = (await listResponse.json()) as { success: boolean; data?: EmployeesData };

      if (listResponse.ok && listData.success && listData.data) {
        setEmployees(listData.data);
        showToast(newStatus === "approved" ? "승인했습니다." : "거절했습니다.");
      }
    } catch (e) {
      console.error("Failed to change status:", e);
      showToast(e instanceof Error ? e.message : "상태 변경 중 오류가 발생했습니다.");
    } finally {
      setProcessingId(null);
    }
  };

  const refreshEmployees = async () => {
    try {
      const listResponse = await fetch(`/api/boss/employees?storeId=${selectedStoreId}`);
      const listData = (await listResponse.json()) as { success: boolean; data?: EmployeesData };
      if (listResponse.ok && listData.success && listData.data) {
        setEmployees(listData.data);
      }
    } catch (e) {
      console.error("Failed to refresh employees:", e);
    }
  };

  // 직원 소속 해제. 결과 불확실·기능 준비 중은 사라지는 토스트가 아니라 화면 상단에 남긴다.
  const requestRemoval = async (target: StaffMember) => {
    if (removingRef.current) return;
    removingRef.current = true;
    setIsRemoving(true);

    try {
      const response = await fetch(`/api/boss/employees/${encodeURIComponent(target.membershipId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStoreId }),
      });
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        alreadyRemoved?: boolean;
        removed?: false | null;
      } | null;

      if (response.ok && data?.success) {
        showToast(data.alreadyRemoved ? "이미 소속이 해제된 직원입니다." : "직원 소속을 해제했습니다.");
      } else if (data?.removed === null || response.status === 503) {
        setError(data?.error || "소속 해제 결과를 확인하지 못했습니다. 목록을 새로고침해 주세요.");
      } else {
        showToast(data?.error || "소속 해제에 실패했습니다.");
      }
    } catch (e) {
      console.error("Failed to remove staff:", e);
      setError("네트워크 오류로 소속 해제 결과를 확인하지 못했습니다. 목록을 확인해 주세요.");
    } finally {
      setRemoveTarget(null);
      setIsRemoving(false);
      removingRef.current = false;
      await refreshEmployees();
    }
  };

  // 로그아웃
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

  // 검색 필터링
  const filteredApproved = employees.approved.filter((staff) => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;
    return staff.name.toLowerCase().includes(query) || staff.email.toLowerCase().includes(query);
  });

  if (!isReady || isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-default)] flex">
        <OwnerSidebar activeMenu="staff" onLogout={handleLogout} />
        <div className="flex-1 ml-0 lg:ml-[240px] flex flex-col">
          <OwnerHeader userName={userName} storeName={storeName} onLogout={handleLogout} />
          <main className="flex-1 p-8">
            <div className="text-center">로딩 중...</div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex">
      <OwnerSidebar activeMenu="staff" onLogout={handleLogout} />

      <div className="flex-1 ml-0 lg:ml-[240px] flex flex-col">
        <OwnerHeader userName={userName} storeName={storeName} onLogout={handleLogout} />

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="px-5 sm:px-8 lg:px-12 xl:px-16 py-8 lg:py-12">
            {/* 페이지 제목 */}
            <div className="mb-8">
              <h1 className="text-3xl lg:text-4xl font-bold text-[var(--color-text-primary)] mb-2">
                직원 관리
              </h1>
              <p className="text-lg text-[var(--color-text-secondary)]">
                현재 매장에서 근무하는 직원을 확인하고 관리하세요.
              </p>
            </div>

            {/* 현재 매장 */}
            <div className="mb-8">
              <p className="text-sm font-semibold text-[var(--color-text-secondary)] mb-2">
                현재 매장
              </p>
              <p className="text-base lg:text-lg font-semibold text-[var(--color-text-primary)]">
                {storeName}
              </p>
            </div>

            {/* 에러 메시지 */}
            {error && (
              <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* 요약 카드 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
              {/* 전체 직원 */}
              <div className="bg-white border border-[var(--color-border)] rounded-lg p-6">
                <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  전체 직원
                </p>
                <p className="text-3xl font-bold text-[var(--color-text-primary)]">
                  {employees.summary.total}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-2">명</p>
              </div>

              {/* 승인 대기 */}
              <div
                className={`bg-white border rounded-lg p-6 ${
                  employees.summary.pending > 0
                    ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/10"
                    : "border-[var(--color-border)]"
                }`}
              >
                <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  승인 대기
                </p>
                <p
                  className={`text-3xl font-bold ${
                    employees.summary.pending > 0
                      ? "text-[var(--color-primary)]"
                      : "text-[var(--color-text-primary)]"
                  }`}
                >
                  {employees.summary.pending}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-2">명</p>
              </div>

              {/* 근무 중 */}
              <div className="bg-white border border-[var(--color-border)] rounded-lg p-6">
                <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  근무 중
                </p>
                <p className="text-3xl font-bold text-[var(--color-text-primary)]">
                  {employees.summary.approved}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-2">명</p>
              </div>
            </div>

            {/* 승인 대기 직원 (홈의 "직원 가입 승인 요청"에서 #pending-staff로 바로 이동) */}
            <section id="pending-staff" className="mb-12 scroll-mt-20">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl lg:text-2xl font-bold text-[var(--color-text-primary)]">
                  승인 대기 직원
                </h2>
                {employees.summary.pending > 0 && (
                  <span className="text-sm font-semibold text-[var(--color-primary)] bg-[var(--color-primary-light)]/20 px-3 py-1 rounded-full">
                    {employees.summary.pending}명
                  </span>
                )}
              </div>

              {employees.pending.length === 0 ? (
                <div className="bg-white border border-[var(--color-border)] rounded-lg p-12 text-center">
                  <p className="text-base text-[var(--color-text-secondary)]">
                    승인 대기 중인 직원이 없습니다.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {employees.pending.map((staff) => (
                    <div
                      key={staff.membershipId}
                      className="bg-white border border-[var(--color-border)] rounded-lg p-4 lg:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[var(--color-text-primary)] truncate">
                          {staff.name}
                        </p>
                        <p className="text-sm text-[var(--color-text-secondary)] truncate">
                          {staff.email}
                        </p>
                        <p className="text-xs text-[var(--color-text-secondary)] mt-2">
                          요청일: {formatDate(staff.requestedAt)}
                        </p>
                      </div>

                      <div className="flex gap-2 w-full lg:w-auto">
                        <Button
                          onClick={() => handleChangeStatus(staff.membershipId, "rejected")}
                          disabled={processingId === staff.membershipId}
                          variant="outline"
                          className="flex-1 lg:flex-none h-10 text-sm"
                        >
                          {processingId === staff.membershipId ? "처리 중..." : "거절"}
                        </Button>
                        <Button
                          onClick={() => handleChangeStatus(staff.membershipId, "approved")}
                          disabled={processingId === staff.membershipId}
                          className="flex-1 lg:flex-none h-10 text-sm"
                        >
                          {processingId === staff.membershipId ? "처리 중..." : "승인"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 직원 목록 */}
            <section>
              <div className="mb-6">
                <h2 className="text-xl lg:text-2xl font-bold text-[var(--color-text-primary)] mb-4">
                  직원 목록
                </h2>

                {/* 검색창 */}
                <div className="relative">
                  <Search
                    size={20}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
                  />
                  <Input
                    type="text"
                    placeholder="직원 이름 또는 이메일을 검색해보세요."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-12"
                  />
                </div>
              </div>

              {filteredApproved.length === 0 ? (
                <div className="bg-white border border-[var(--color-border)] rounded-lg p-12 text-center">
                  {employees.approved.length === 0 ? (
                    <>
                      <p className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
                        등록된 직원이 없습니다.
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        직원이 가입을 요청하면 이곳에서 확인할 수 있습니다.
                      </p>
                    </>
                  ) : (
                    <p className="text-base text-[var(--color-text-secondary)]">
                      검색 결과가 없습니다.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredApproved.map((staff) => (
                    <div
                      key={staff.membershipId}
                      className="bg-white border border-[var(--color-border)] rounded-lg p-4 lg:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[var(--color-text-primary)] truncate">
                          {staff.name}
                        </p>
                        <p className="text-sm text-[var(--color-text-secondary)] truncate">
                          {staff.email}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        {staff.needsBrandProfileRecovery ? (
                          <div className="flex flex-col items-start gap-1 lg:items-end">
                            <button
                              type="button"
                              disabled={processingId === staff.membershipId}
                              onClick={() => handleChangeStatus(staff.membershipId, "approved")}
                              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-amber-300 bg-amber-50 px-4 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 disabled:opacity-60"
                            >
                              {processingId === staff.membershipId ? "처리 중..." : "승인 마무리"}
                            </button>
                            <span className="text-xs text-amber-700">승인 후처리가 끝나지 않았어요.</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-green-500" />
                            <span className="text-[var(--color-text-secondary)]">근무 중</span>
                          </div>
                        )}
                        <span className="text-xs text-[var(--color-text-secondary)]">
                          {formatDate(staff.approvedAt || staff.requestedAt)}
                        </span>
                        <button
                          type="button"
                          disabled={isRemoving || processingId === staff.membershipId}
                          onClick={() => setRemoveTarget(staff)}
                          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-[var(--color-border)] bg-white px-3 text-sm font-medium text-red-700 transition-colors hover:border-red-300 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:opacity-60"
                        >
                          소속 해제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </main>
      </div>

      {/* Toast Message */}
      {toastMessage && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-[var(--color-text-primary)] text-white px-6 py-3 rounded-lg shadow-lg text-sm font-medium animate-fade-in-out">
          {toastMessage}
        </div>
      )}

      <ConfirmDialog
        isOpen={removeTarget !== null}
        title={`${removeTarget?.name ?? "직원"} 소속 해제`}
        description={
          <div className="space-y-2">
            <p className="font-medium text-[var(--color-text-primary)]">
              이 직원의 {storeName} 소속을 해제할까요?
            </p>
            <p>해당 매장의 챗봇·매뉴얼·공지·대화를 이용할 수 없게 됩니다.</p>
            <p>직원 계정과 다른 매장 소속은 유지됩니다.</p>
          </div>
        }
        confirmText="소속 해제"
        cancelText="취소"
        isDangerous
        isLoading={isRemoving}
        onConfirm={() => {
          if (removeTarget) void requestRemoval(removeTarget);
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
