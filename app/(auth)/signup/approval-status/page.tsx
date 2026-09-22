"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, Home, Plus, Store as StoreIcon } from "lucide-react";
import { Button } from "@/components/common/Button";
import { getBrandLogoPath } from "@/lib/brands/brand-logos";
import { createClient } from "@/lib/supabase/client";
import { signupStorage as sessionStorage } from "@/lib/signup/signup-storage";
import type { UserRole } from "@/lib/types/user";
import type { Store } from "@/lib/types/store";

type ApprovalStatus = "requestable" | "pending" | "approved" | "rejected";
type AccountApprovalStatus = "approved" | "pending" | "rejected" | "not_requested";

interface StoreApprovalState {
  store: Store;
  status: ApprovalStatus;
  requestedAt?: string;
  membershipId?: string;
  membershipStoreId?: string;
}

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
  const [isLoading, setIsLoading] = useState(true);
  const [lookupStatus, setLookupStatus] = useState<AccountApprovalStatus | null>(null);

  useEffect(() => {
    const loadApprovalStatus = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const authRole = user?.user_metadata?.role as UserRole | undefined;
      const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
      const lookupEmail = window.sessionStorage.getItem("approvalLookupEmail");
      const resolvedRole = authRole || savedRole;

      if (!user && lookupEmail) {
        try {
          const response = await fetch("/api/auth/approval-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: lookupEmail }),
            cache: "no-store",
          });
          const result = (await response.json()) as {
            found: boolean;
            status?: AccountApprovalStatus;
            role?: UserRole;
          };

          if (!response.ok || !result.found || !result.status || !result.role) {
            router.replace("/");
            return;
          }

          setRole(result.role);
          setLookupStatus(result.status);
          setIsLoading(false);
        } catch (error) {
          console.error("Failed to load approval lookup:", error);
          router.replace("/");
        }
        return;
      }

      if (!resolvedRole) {
        router.replace("/");
        return;
      }
      if (resolvedRole === "hq") {
        router.replace("/hq");
        return;
      }

      setRole(resolvedRole);

      try {
        const savedApprovals = sessionStorage.getItem("signupStoreApprovals");
        const sessionApprovals = savedApprovals
          ? JSON.parse(savedApprovals) as StoreApprovalState[]
          : [];
        console.log("[approval-status] sessionApprovals loaded:", {
          count: sessionApprovals.length,
          approvals: sessionApprovals.map(a => ({
            storeName: a.store.name,
            status: a.status,
            membershipStoreId: a.membershipStoreId,
          })),
        });

        // Server API에서 실제 membership 정보 조회
        const response = await fetch("/api/signup/store-membership", {
          credentials: "include",
          cache: "no-store",
        });
        const result = await response.json();

        console.log("[approval-status] GET /api/signup/store-membership response:", {
          status: response.status,
          success: result.success,
          dataCount: result.data?.length || 0,
          data: result.data,
        });

        if (response.ok && result.success && Array.isArray(result.data)) {
          // 서버에서 받은 membership 데이터가 있음
          const dbMemberships = result.data;

          if (sessionApprovals.length === 0) {
            const restoredApprovals: StoreApprovalState[] = dbMemberships.map(
              (membership: { membershipId: string; storeId: string; storeName: string; status: ApprovalStatus; requestedAt?: string }) => ({
                store: {
                  id: membership.storeId,
                  brandId: "",
                  brandName: "",
                  name: membership.storeName,
                  address: "",
                  createdAt: new Date(),
                  manualCount: 0,
                  memberCount: 0,
                  status: "active",
                },
                status: membership.status,
                requestedAt: membership.requestedAt,
                membershipId: membership.membershipId,
                membershipStoreId: membership.storeId,
              }),
            );
            setStoreApprovals(restoredApprovals);
            sessionStorage.setItem("signupStoreApprovals", JSON.stringify(restoredApprovals));
            return;
          }

          // sessionApprovals의 각 항목과 dbMemberships를 store name으로 연결
          const updatedApprovals = sessionApprovals.map(approval => {
            // store name으로 일치하는 DB membership 찾기
            const dbMembership = dbMemberships.find(
              (m: { membershipId: string; storeId: string; storeName: string; role: string; status: string; requestedAt?: string }) =>
                (approval.membershipStoreId && m.storeId === approval.membershipStoreId) ||
                m.storeName === approval.store.name
            );

            if (dbMembership) {
              console.log(`[approval-status] Merged: "${approval.store.name}"`, {
                sessionStatus: approval.status,
                dbStatus: dbMembership.status,
                membershipId: dbMembership.membershipId,
              });

              // DB membership이 있으면 DB 상태를 우선 사용
              return {
                ...approval,
                status: dbMembership.status as ApprovalStatus,
                requestedAt: dbMembership.requestedAt,
                membershipId: dbMembership.membershipId,
                membershipStoreId: dbMembership.storeId, // 실제 UUID
              };
            }

            console.log(`[approval-status] No DB match for "${approval.store.name}" - using sessionStorage fallback`);
            // DB membership이 없으면 sessionStorage 값 사용 (fallback)
            return approval;
          });

          console.log("[approval-status] Final updatedApprovals:", {
            count: updatedApprovals.length,
            approvals: updatedApprovals.map(a => ({
              storeName: a.store.name,
              status: a.status,
              membershipStoreId: a.membershipStoreId,
            })),
          });

          setStoreApprovals(updatedApprovals);
          sessionStorage.setItem("signupStoreApprovals", JSON.stringify(updatedApprovals));
        } else {
          // Server API 실패 → sessionStorage fallback
          setStoreApprovals(sessionApprovals);
        }
      } catch (e) {
        console.error("Failed to load approval status:", e);
        const fallbackApprovals = sessionStorage.getItem("signupStoreApprovals");
        if (fallbackApprovals) {
          setStoreApprovals(JSON.parse(fallbackApprovals));
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadApprovalStatus();
    const intervalId = window.setInterval(loadApprovalStatus, 5000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        loadApprovalStatus();
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [router]);

  if (!role) return null;

  const handleSelectStore = (membershipStoreId: string, storeName: string) => {
    // Save the real store UUID from membership, not the mock store.id
    // boss 대시보드(app/boss/page.tsx)가 같은 태버 실제 sessionStorage를 읽으므로, 이 두 키만은
    // 가입 위저드 상태와 달리 shadow된 sessionStorage(localStorage)가 아닌 진짜 sessionStorage를 쓴다.
    window.sessionStorage.setItem("selectedStoreId", membershipStoreId);
    window.sessionStorage.setItem("selectedStoreName", storeName);
    router.push("/boss");
  };

  const handleAddStore = () => {
    sessionStorage.setItem("signupStoreApprovals", JSON.stringify(storeApprovals));
    const existingStores = storeApprovals.map(item => item.store);
    sessionStorage.setItem("signupSelectedStores", JSON.stringify(existingStores));
    router.push("/signup/stores?mode=add");
  };

  const handleGoHome = () => {
    router.push("/");
  };

  const roleLabel = role === "owner" ? "점주" : "직원";
  const totalCount = storeApprovals.length;
  const approvedCount = storeApprovals.filter(item => item.status === "approved").length;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-default)] flex items-center justify-center">
        <p className="text-lg text-[var(--color-text-primary)]">승인 현황을 확인 중입니다...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <div className="flex flex-col min-h-screen">
        <header className="relative border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
          <div className="flex items-center justify-between px-5 sm:px-8 lg:px-12 xl:px-16 h-16 lg:h-[68px]">
            <div className="flex-shrink-0" />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <img src="/logo/ilitda-wordmark.png" alt="일잇다" className="h-8 sm:h-9 w-auto object-contain" />
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={handleGoHome}
                className="ml-2 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--color-primary)] bg-white px-4 text-sm font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
              >
                <Home size={17} />
                메인
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 flex flex-col px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="w-full max-w-6xl mx-auto">
            <div className="mb-6 sm:mb-8">
              <h1 className="text-3xl sm:text-4xl font-bold text-[var(--color-text-primary)] mb-2">승인 현황</h1>
              <p className="text-base sm:text-lg text-[var(--color-text-secondary)]">신청한 매장의 승인 상태를 확인해 주세요.<br />승인이 완료된 매장을 선택해 시작할 수 있습니다.</p>
            </div>

            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--color-text-primary)]">승인 요청</h2>
              <span className="text-base font-semibold text-[var(--color-text-secondary)]">총 {totalCount}건 (승인됨: {approvedCount})</span>
            </div>

            {lookupStatus && storeApprovals.length === 0 && (
              <div className="mb-8 border-y border-[var(--color-border)] bg-white px-5 py-8 text-center">
                <p className="text-xl font-bold text-[var(--color-text-primary)]">
                  {lookupStatus === "approved"
                    ? "승인이 완료되었습니다."
                    : lookupStatus === "pending"
                      ? "현재 관리자 승인 대기 중입니다."
                      : lookupStatus === "rejected"
                        ? "승인 요청이 거절되었습니다."
                        : "아직 점포 승인 요청이 등록되지 않았습니다."}
                </p>
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                  상세 점포 정보는 로그인 후 확인할 수 있습니다.
                </p>
              </div>
            )}

            <div className="space-y-3 mb-8">
              {storeApprovals.map((approval, index) => {
                const store = approval.store;
                const statusLabel = approval.status === "pending" ? "승인 대기" : approval.status === "approved" ? "승인 완료" : "승인 거절";
                const statusColor = approval.status === "pending" ? "text-[var(--color-status-warning)]" : approval.status === "approved" ? "text-[var(--color-status-success)]" : "text-[var(--color-status-error)]";
                const statusMessage = approval.status === "pending" ? "본사에서 가입 요청을 확인하고 있습니다." : approval.status === "approved" ? "승인이 완료되었습니다. 매장을 선택해 시작할 수 있습니다." : "승인 요청이 거절되었습니다. 본사 또는 관리자에게 문의해 주세요.";
                const requestedAtFormatted = formatTimestamp(approval.requestedAt);
                const brandLogoPath = getBrandLogoPath(store.brandName);

                return (
                  <div key={store.id || index} className="bg-white rounded-lg border border-[var(--color-border)] hover:shadow-sm transition-shadow">
                    <div className="grid grid-cols-[80px_1fr_auto] sm:grid-cols-[100px_1fr_auto] gap-4 p-4 sm:p-5 min-h-[160px] items-start">
                      <div className="flex items-start justify-center">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border)] flex items-center justify-center overflow-hidden">
                          {brandLogoPath ? (
                            <>
                              <img src={brandLogoPath} alt={store.brandName || "브랜드"} className="w-full h-full object-contain p-2" onError={(e) => { e.currentTarget.style.display = "none"; const fb = e.currentTarget.nextElementSibling as HTMLElement; if (fb) fb.style.display = "flex"; }} />
                              <div style={{ display: "none" }} className="w-full h-full flex items-center justify-center"><StoreIcon size={28} className="text-[var(--color-text-secondary)]" /></div>
                            </>
                          ) : (
                            <StoreIcon size={28} className="text-[var(--color-text-secondary)]" />
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-3">
                        <h3 className="text-base sm:text-lg font-semibold text-[var(--color-text-primary)]">{store.name}</h3>
                        <div className="space-y-2">
                          <p className="text-sm text-[var(--color-text-secondary)]">{statusMessage}</p>
                          <div className="grid grid-cols-2 gap-4 sm:gap-6 text-xs sm:text-sm">
                            <div><p className="text-[var(--color-text-secondary)] font-medium mb-1">유형</p><p className="font-semibold text-[var(--color-text-primary)]">{roleLabel}</p></div>
                            <div><p className="text-[var(--color-text-secondary)] font-medium mb-1">신청 일시</p><p className="font-semibold text-[var(--color-text-primary)]">{requestedAtFormatted}</p></div>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-3 h-full justify-between">
                        <div className="text-right"><div className="text-xs text-[var(--color-text-secondary)] font-medium mb-1">신청 현황</div><div className={`text-sm font-semibold ${statusColor}`}>{statusLabel}</div></div>
                        {approval.status === "approved" ? (
                          <Button type="button" variant="primary" size="sm" onClick={() => handleSelectStore(approval.membershipStoreId || store.id, store.name)} className="h-10 px-4 text-sm whitespace-nowrap">
                            <Check size={16} className="mr-1.5" />
                            이 매장으로 시작하기
                          </Button>
                        ) : (
                          <Button type="button" variant="outline" size="sm" disabled className="h-10 px-4 text-sm whitespace-nowrap">승인 대기 중</Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 w-full mb-8">
              <Button type="button" variant="outline" size="sm" onClick={handleAddStore} className="w-full h-14 px-4 text-base font-medium flex items-center justify-center gap-2 hover:bg-[var(--color-primary)] hover:bg-opacity-5">
                <Plus size={20} />
                매장 추가
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}