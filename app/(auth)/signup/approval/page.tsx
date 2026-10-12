"use client";

import React, { useState, useLayoutEffect, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Trash2, Check, Plus, Store as StoreIcon } from "lucide-react";
import { Button } from "@/components/common/Button";
import { getBrandLogoPath } from "@/lib/brands/brand-logos";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types/user";
import type { Store } from "@/lib/types/store";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";

type ApprovalStatus = "requestable" | "pending" | "approved" | "rejected";

interface StoreApprovalState {
  store: Store;
  status: ApprovalStatus;
  requestedAt?: string;
}

function isDatabaseStoreId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
  const submitting = useRef(false);
  // 신청 진행 중인 대상: "all" = 모두 승인 신청, 그 외 = 해당 매장 id (버튼 문구 표시용)
  const [requestingTarget, setRequestingTarget] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [emailAlreadyRegistered, setEmailAlreadyRegistered] = useState(false);

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
    // 이전 버전이 남겨 둔 가입 비밀번호/재시도 기록은 더 이상 쓰지 않으므로 지운다.
    sessionStorage.removeItem("signupPassword");
    sessionStorage.removeItem("signupAuthAttemptEmail");
    sessionStorage.removeItem("signupAuthAttemptAt");
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

          // DB에서 현재 memberships 조회 (가입 신청 전이라 세션이 아예 없는 방문자는 401을
          // 유발하지 않도록, 로컬 세션 존재 여부를 먼저 확인한 뒤에만 서버에 조회한다).
          const fetchMembershipsAndMerge = async () => {
            try {
              const supabase = createClient();
              const { data: sessionCheck } = await supabase.auth.getSession();

              let dbMemberships: { membershipId: string; storeId: string; storeName: string; status: string; requestedAt?: string }[] = [];

              if (sessionCheck.session) {
                const response = await fetch("/api/signup/store-membership", {
                  credentials: "include",
                });
                const result = await response.json();

                if (response.ok && result.success && Array.isArray(result.data)) {
                  dbMemberships = result.data;
                }
              }

              // 기존 approval 상태 복원 또는 새로 생성
              const savedApprovals = sessionStorage.getItem("signupStoreApprovals");
              let existingApprovals: StoreApprovalState[] = [];
              if (savedApprovals) {
                try {
                  existingApprovals = JSON.parse(savedApprovals);
                } catch {
                  existingApprovals = [];
                }
              }

              // 새로운 selectedStores와 DB memberships을 merge
              const mergedApprovals = parsed.map((store: Store) => {
                // 먼저 DB membership을 찾기 (storeName으로 매칭)
                const dbMembership = dbMemberships.find(
                  (m) => m.storeName === store.name
                );

                if (dbMembership) {
                  // DB membership이 존재하면 DB status 우선 사용
                  return {
                    store,
                    status: dbMembership.status as ApprovalStatus,
                    requestedAt: dbMembership.requestedAt,
                  };
                }

                // DB membership이 없으면 기존 local 상태 확인
                const existingItem = existingApprovals.find(
                  (item: StoreApprovalState) => item.store.id === store.id
                );

                if (existingItem) {
                  // 기존 상태 유지 (단, DB에 없는 항목이므로 requestable로 재설정)
                  if (existingItem.status === "approved" || existingItem.status === "pending") {
                    // DB에 없는데 local에만 있으면 requestable로 리셋
                    return {
                      store,
                      status: "requestable" as ApprovalStatus,
                    };
                  }
                  return { ...existingItem, store };
                }

                // 새로운 매장
                return {
                  store,
                  status: "requestable" as ApprovalStatus,
                };
              });

              setStoreApprovals(mergedApprovals);
              sessionStorage.setItem("signupStoreApprovals", JSON.stringify(mergedApprovals));
            } catch (e) {
              console.error("Failed to fetch memberships:", e);

              // 실패하면 기존 로직 대로 처리
              const savedApprovals = sessionStorage.getItem("signupStoreApprovals");
              if (savedApprovals) {
                try {
                  const existingApprovals = JSON.parse(savedApprovals);
                  const mergedApprovals = parsed.map((store: Store) => {
                    const existingItem = existingApprovals.find(
                      (item: StoreApprovalState) => item.store.id === store.id
                    );
                    if (existingItem) {
                      return { ...existingItem, store };
                    } else {
                      return {
                        store,
                        status: "requestable" as ApprovalStatus,
                      };
                    }
                  });
                  setStoreApprovals(mergedApprovals);
                } catch {
                  const newApprovals = parsed.map((store: Store) => ({
                    store,
                    status: "requestable" as ApprovalStatus,
                  }));
                  setStoreApprovals(newApprovals);
                }
              } else {
                const newApprovals = parsed.map((store: Store) => ({
                  store,
                  status: "requestable" as ApprovalStatus,
                }));
                setStoreApprovals(newApprovals);
              }
            }
          };

          fetchMembershipsAndMerge();
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

  // Auth session 확인. 이메일 가입자는 기본 정보 단계의 인증번호 확인으로 이미 세션이 있어야 한다.
  // (이 화면에서는 계정을 만들거나 비밀번호를 다루지 않는다. 테스트 계정만 개발용으로 로그인한다)
  const ensureSignupAuthSession = async (): Promise<boolean> => {
    const supabase = createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    // signupProfile과 signupRole 읽기
    const signupProfile = sessionStorage.getItem("signupProfile");
    const signupRole = sessionStorage.getItem("signupRole");

    if (!signupProfile || !signupRole) {
      setSubmissionError("회원가입 정보가 없습니다. 회원가입을 다시 진행해주세요.");
      return false;
    }

    try {
      const profile = JSON.parse(signupProfile);
      const profileEmail = profile.email;

      const isOAuthUser = currentUser?.identities?.some(
        (identity) => identity.provider === "google" || identity.provider === "kakao" || identity.provider === "apple" || identity.provider === "custom:naver",
      ) || currentUser?.app_metadata?.provider === "google" || currentUser?.app_metadata?.provider === "kakao" || currentUser?.app_metadata?.provider === "apple" || currentUser?.app_metadata?.provider === "custom:naver";

      if (currentUser && isOAuthUser) {
        return true;
      }

      if (currentUser && currentUser.email === profileEmail && currentUser.email_confirmed_at) {
        const currentUserRole = currentUser.user_metadata?.role as string | undefined;
        if (currentUserRole === signupRole) {
          return true;
        }
      }

      setEmailAlreadyRegistered(true);
      setSubmissionError("이메일 인증이 확인된 로그인 세션이 없습니다. 기본 정보 단계에서 인증하거나 로그인 후 신청해주세요.");
      return false;
    } catch (error) {
      logSafeAuthError("SIGNUP_APPROVAL_AUTH_SESSION_ERROR", error);
      setSubmissionError("회원가입 중 오류가 발생했습니다.");
      return false;
    }
  };

  const handleDeleteAll = () => {
    setStoreApprovals([]);
    setSelectedStores([]);
    setShowConfirmDialog(false);
  };

  // 승인 신청 공통 처리. targetStoreId가 없으면 "신청 전"인 모든 매장, 있으면 그 매장 하나만 신청한다.
  // 서버(/api/signup/store-membership)가 로그인 사용자 기준으로 pending membership만 만든다(자동 승인 없음).
  const requestApprovals = async (targetStoreId?: string) => {
    if (submitting.current) return;

    const requestableApprovals = storeApprovals.filter(
      (item) => item.status === "requestable" && (!targetStoreId || item.store.id === targetStoreId)
    );

    if (requestableApprovals.length === 0) return;

    submitting.current = true;
    setIsLoading(true);
    setRequestingTarget(targetStoreId ?? "all");
    setSubmissionError("");
    setEmailAlreadyRegistered(false);

    // 신청에 성공한 매장만 "승인 대기"로 바꾼다. (중간에 실패해도 앞서 성공한 매장은 반영)
    const requestedStoreIds = new Map<string, ApprovalStatus>();
    const applyRequested = () => {
      if (requestedStoreIds.size === 0) return storeApprovals;
      const requestedAt = new Date().toISOString();
      const updatedApprovals = storeApprovals.map((item) =>
        requestedStoreIds.has(item.store.id)
          ? { ...item, status: requestedStoreIds.get(item.store.id) ?? "pending", requestedAt }
          : item
      );
      setStoreApprovals(updatedApprovals);
      sessionStorage.setItem("signupStoreApprovals", JSON.stringify(updatedApprovals));
      return updatedApprovals;
    };

    try {
      // 인증된 세션 확인 (이메일 인증 전이면 신청하지 않는다)
      const isAuthenticated = await ensureSignupAuthSession();
      if (!isAuthenticated) {
        return;
      }

      // ensureSignupAuthSession이 true를 반환해도 그 사이 세션이 끊겼을 가능성에 대비해,
      // 매장별 승인 신청 API를 호출하기 직전 세션이 실제로 살아있는지 한 번 더 확인한다.
      // 세션이 없으면 API를 호출하지 않고 즉시 안내 후 중단한다.
      const supabase = createClient();
      const { data: sessionCheck } = await supabase.auth.getSession();
      if (!sessionCheck.session) {
        setSubmissionError("인증 세션을 확인할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.");
        return;
      }

      // Create memberships for the target stores (userId from server auth.getUser)
      for (const approval of requestableApprovals) {
        try {
          const response = await fetch("/api/signup/store-membership", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(isDatabaseStoreId(approval.store.id) ? { storeId: approval.store.id } : {}),
              storeName: approval.store.name,
              role: role,
              terms: (() => { try { return JSON.parse(sessionStorage.getItem("signupTerms") ?? "null"); } catch { return null; } })(),
              email: (() => { try { return JSON.parse(sessionStorage.getItem("signupProfile") ?? "null")?.email; } catch { return null; } })(),
            }),
          });

          const result = (await response.json()) as { success: boolean; error?: string; code?: string; requestId?: string; membershipStatus?: string };

          if (!result.success && (result.code === "EMAIL_NOT_CONFIRMED" || result.code === "EMAIL_OTP_UNAVAILABLE")) {
            applyRequested();
            setSubmissionError(result.error || "이메일 인증을 확인할 수 없습니다.");
            return;
          }

          if (!result.success) {
            console.error("Membership 생성 실패:", result);
            applyRequested();
            if (result.code === "STORE_NO_OWNER") {
              // 점주가 등록되지 않은 매장: 신청을 받을 점주가 없어 서버가 신청을 만들지 않는다.
              setSubmissionError(
                `"${approval.store.name}"은(는) 아직 점주가 등록되지 않은 매장이라 신청할 수 없습니다. 점주가 등록된 뒤 다시 신청해주세요.`
              );
              return;
            }
            const requestReference = result.requestId ? ` (문의 ID: ${result.requestId})` : "";
            setSubmissionError(`매장 "${approval.store.name}" 신청을 완료하지 못했습니다. ${result.error || "잠시 후 다시 시도해주세요."}${requestReference}`);
            return;
          }
          requestedStoreIds.set(approval.store.id, result.membershipStatus === "approved" || result.membershipStatus === "rejected" ? result.membershipStatus : "pending");
        } catch (e) {
          console.error("Membership 생성 중 예외:", e);
          applyRequested();
          setSubmissionError(`매장 "${approval.store.name}" 신청을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.`);
          return;
        }
      }

      const updatedApprovals = applyRequested();
      const hasRemainingRequestable = updatedApprovals.some((item) => item.status === "requestable");
      const approverLabel = role === "owner" ? "본사" : "점주";

      if (hasRemainingRequestable) {
        // 아직 신청하지 않은 매장이 남아 있으면 이 화면에 머물러 이어서 신청할 수 있게 한다.
        alert(`"${requestableApprovals[0].store.name}" 승인 요청이 완료되었습니다.\n${approverLabel} 승인을 기다려 주세요.`);
        return;
      }

      alert(`승인 요청이 완료되었습니다.\n${approverLabel} 승인을 기다려 주세요.`);

      // Move to approval status page
      router.push("/signup/approval-status");
    } catch (e) {
      console.error("승인 요청 중 오류:", e);
      alert("승인 요청 중 오류가 발생했습니다.");
    } finally {
      submitting.current = false;
      setIsLoading(false);
      setRequestingTarget(null);
    }
  };

  const handleRequestAll = () => requestApprovals();
  const handleRequestStore = (storeId: string) => requestApprovals(storeId);

  const handleGoToApprovalStatus = () => {
    // 최종 상태 저장
    sessionStorage.setItem("signupStoreApprovals", JSON.stringify(storeApprovals));
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
  const allApprovalsPending = storeApprovals.length > 0 && storeApprovals.every((item) => item.status === "pending");

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
                      {requestingTarget === "all" ? "신청 중..." : "모두 승인 신청"}
                    </Button>
                  </div>
                </div>

                {submissionError && (
                  <div className="mb-4 rounded-lg border border-[var(--color-status-error)]/20 bg-red-50 px-4 py-3">
                    <p className="text-sm text-[var(--color-status-error)]">{submissionError}</p>
                    {emailAlreadyRegistered && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => router.push("/")}
                        className="mt-2"
                      >
                        로그인하러 가기
                      </Button>
                    )}
                  </div>
                )}

                {/* Store Approval Cards */}
                <div className="space-y-3">
                  {storeApprovals
                    .filter((approval) => approval.status !== "rejected")
                    .map((approval, index) => {
                    const store = approval.store;
                    const statusLabel =
                      approval.status === "requestable"
                        ? "신청 전"
                        : approval.status === "pending"
                        ? "승인 대기"
                        : "승인 완료";

                    const statusColor =
                      approval.status === "requestable"
                        ? "text-[var(--color-text-secondary)]"
                        : approval.status === "pending"
                        ? "text-[var(--color-status-warning)]"
                        : "text-[var(--color-status-success)]";

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
                                disabled={isLoading}
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
                                  onClick={() => handleRequestStore(store.id)}
                                  disabled={isLoading}
                                  aria-label={`${store.name} 승인 신청`}
                                  className="h-8 px-3 text-xs sm:text-sm flex-shrink-0"
                                >
                                  <Check size={14} className="mr-1" />
                                  {requestingTarget === store.id ? "신청 중..." : "신청"}
                                </Button>
                              ) : approval.status === "pending" ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={true}
                                  className="h-8 px-3 text-xs sm:text-sm flex-shrink-0"
                                >
                                  요청 완료
                                </Button>
                              ) : approval.status === "approved" ? (
                                <Button
                                  type="button"
                                  variant="primary"
                                  size="sm"
                                  disabled={true}
                                  className="h-8 px-3 text-xs sm:text-sm flex-shrink-0 opacity-75"
                                >
                                  승인 완료
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Action Buttons */}
                <div className="mt-6 space-y-3 w-full">
                  {/* Add Store Button */}
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

                  {/* Approval Status Button - Show when all pending */}
                  {allApprovalsPending && (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={handleGoToApprovalStatus}
                      className="w-full h-14 px-4 text-base font-medium flex items-center justify-center gap-2"
                    >
                      <Check size={20} />
                      승인 현황 확인
                    </Button>
                  )}
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
