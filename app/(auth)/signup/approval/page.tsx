"use client";

import React, { useState, useLayoutEffect, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Trash2, Check, Plus, Store as StoreIcon } from "lucide-react";
import { Button } from "@/components/common/Button";
import { getBrandLogoPath } from "@/lib/brands/brand-logos";
import { createClient } from "@/lib/supabase/client";
import {
  DEV_TEST_EMAILS,
  DEV_TEST_EMAIL_ROLE_MAP,
  DEV_TEST_PASSWORD,
} from "@/lib/data/mockFranchises";
import type { UserRole } from "@/lib/types/user";
import type { Store } from "@/lib/types/store";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";

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

const SIGNUP_RETRY_COOLDOWN_MS = 25_000;

export default function SignupApprovalPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [selectedStores, setSelectedStores] = useState<Store[]>([]);
  const [storeApprovals, setStoreApprovals] = useState<StoreApprovalState[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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

  // Auth session 확보 (테스트 계정은 signInWithPassword, 신규 이메일은 signUp)
  const ensureSignupAuthSession = async (
    pendingStores: StoreApprovalState[] = []
  ): Promise<boolean> => {
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
      const profilePassword = sessionStorage.getItem("signupPassword") || profile.password;

      if (!profilePassword || typeof profilePassword !== "string" || profilePassword.length < 8) {
        setSubmissionError("비밀번호 정보가 없습니다. 기본 정보 입력 단계에서 비밀번호를 다시 입력해주세요.");
        return false;
      }

      const isOAuthUser = currentUser?.identities?.some(
        (identity) => identity.provider === "google" || identity.provider === "kakao" || identity.provider === "apple" || identity.provider === "custom:naver",
      ) || currentUser?.app_metadata?.provider === "google" || currentUser?.app_metadata?.provider === "kakao" || currentUser?.app_metadata?.provider === "apple" || currentUser?.app_metadata?.provider === "custom:naver";

      if (currentUser && isOAuthUser) {
        return true;
      }

      // 현재 user가 있고 email + role이 signup 대상과 정확히 일치하면 재사용
      if (currentUser && currentUser.email === profileEmail) {
        const currentUserRole = currentUser.user_metadata?.role as string | undefined;
        if (currentUserRole === signupRole) {
          // 현재 session 재사용 가능
          return true;
        }
      }

      // 현재 user가 다른 사용자이거나(이메일 불일치), 이메일은 같지만 역할이 다르면
      // (예: staff로 시작했다가 owner로 다시 가입) 그 세션을 남겨둔 채 signUp을 호출하면
      // Supabase가 AuthApiError를 반환할 수 있으므로 먼저 로그아웃해 세션을 비운다.
      if (currentUser) {
        await supabase.auth.signOut();
      }

      // DEV_TEST_EMAIL인지 확인
      const isTestEmail = DEV_TEST_EMAILS.includes(profileEmail);

      if (isTestEmail) {
        // 테스트 이메일: role 검증 필수
        const expectedRole = DEV_TEST_EMAIL_ROLE_MAP[profileEmail];
        if (!expectedRole || expectedRole !== signupRole) {
          alert(
            `이 계정은 ${expectedRole} 역할만 가능합니다. (선택함: ${signupRole})`
          );
          return false;
        }

        // signInWithPassword 사용 (기존 테스트 계정 재사용)
        const { data: authData, error: authError } =
          await supabase.auth.signInWithPassword({
            email: profileEmail,
            password: DEV_TEST_PASSWORD,
          });

        if (authError) {
          logSafeAuthError("SIGNUP_APPROVAL_TEST_SIGNIN_FAILED", authError);
          alert(
            `테스트 계정 로그인 실패: ${authError.message || "알 수 없는 오류"}`
          );
          return false;
        }

        if (!authData.user || !authData.session) {
          alert("테스트 계정 세션을 확보할 수 없습니다.");
          return false;
        }

        // ✅ 중요: 서버 세션 업데이트 대기
        // signInWithPassword 후 HTTP 쿠키가 업데이트되도록 명시적으로 확인
        // 이를 통해 이후 API 호출이 올바른 user_id를 사용하도록 보장
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session || sessionData.session.user.email !== profileEmail) {
          console.error("Session verification failed after signInWithPassword");
          alert("세션 전환 실패. 다시 시도해주세요.");
          return false;
        }

        return true;
      }

      const checkEmailResponse = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: profileEmail }),
      });
      const checkEmailResult = (await checkEmailResponse.json()) as { available?: boolean; error?: string };

      if (checkEmailResponse.ok && checkEmailResult.available === false) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: profileEmail,
          password: profilePassword,
        });

        if (signInError || !signInData.session) {
          setEmailAlreadyRegistered(true);
          setSubmissionError("이미 가입된 이메일입니다. 로그인 후 다시 진행해주세요.");
          return false;
        }

        sessionStorage.removeItem("signupAuthAttemptEmail");
        sessionStorage.removeItem("signupAuthAttemptAt");
        return true;
      }

      const lastAttemptEmail = sessionStorage.getItem("signupAuthAttemptEmail");
      const lastAttemptAt = Number(sessionStorage.getItem("signupAuthAttemptAt") || "0");
      const elapsedSinceLastAttempt = Date.now() - lastAttemptAt;

      if (lastAttemptEmail === profileEmail && elapsedSinceLastAttempt < SIGNUP_RETRY_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((SIGNUP_RETRY_COOLDOWN_MS - elapsedSinceLastAttempt) / 1000);
        setSubmissionError(`인증 요청이 너무 잦습니다. ${remainingSeconds}초 후 다시 시도해주세요.`);
        return false;
      }

      sessionStorage.setItem("signupAuthAttemptEmail", profileEmail);
      sessionStorage.setItem("signupAuthAttemptAt", String(Date.now()));

      const emailRedirectTo = `${window.location.origin}/auth/callback?next=/signup/approval`;

      if (process.env.NODE_ENV === "development") {
        console.log("🔗 [DEV] Email Auth Link / Token:", {
          email: profileEmail,
          emailRedirectTo,
          inbucketUrl: "http://localhost:54324",
          note: "Supabase 로컬 개발 환경에서는 Inbucket에서 실제 인증 메일 링크를 확인하세요.",
        });
        void fetch("/api/auth/dev-email-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: "signup-approval signUp",
            email: profileEmail,
            emailRedirectTo,
          }),
        });
      }

      // 일반 신규 이메일: signUp 사용
      // pendingStores는 이메일 인증 콜백(app/auth/callback/route.ts)이 세션 확보 직후
      // 서버에서 직접 읽어 매장 승인 신청을 자동으로 일괄 처리하는 데 사용한다.
      const { data: authData, error: authError } =
        await supabase.auth.signUp({
          email: profileEmail,
          password: profilePassword,
          options: {
            data: {
              role: signupRole,
              name: profile.name,
              phone: profile.phone,
              pendingStores: pendingStores.map((item) => ({
                storeId: item.store.id,
                storeName: item.store.name,
              })),
            },
            // 이메일 인증(컨펌) 링크를 눌렀을 때 세션을 실제로 교환해 줄 콜백 경로로 되돌아오게 한다.
            emailRedirectTo,
          },
        });

      if (authError) {
        logSafeAuthError("SIGNUP_APPROVAL_SIGNUP_FAILED", authError);
        const normalizedMessage = authError.message?.toLowerCase() || "";
        if (
          normalizedMessage.includes("already") ||
          normalizedMessage.includes("already registered") ||
          normalizedMessage.includes("user already exists")
        ) {
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: profileEmail,
            password: profilePassword,
          });

          if (signInError || !signInData.session) {
            setEmailAlreadyRegistered(true);
            setSubmissionError("이미 가입된 이메일입니다. 로그인 후 다시 진행해주세요.");
            return false;
          }

          sessionStorage.removeItem("signupAuthAttemptEmail");
          sessionStorage.removeItem("signupAuthAttemptAt");
          return true;
        } else if (
          normalizedMessage.includes("20 seconds") ||
          normalizedMessage.includes("security purposes") ||
          normalizedMessage.includes("rate limit") ||
          normalizedMessage.includes("email rate limit")
        ) {
          setSubmissionError("이메일 발송 요청이 너무 많습니다. 잠시 후(또는 몇 분 뒤) 다시 시도해 주세요.");
        } else if (
          normalizedMessage.includes("session") ||
          normalizedMessage.includes("token") ||
          normalizedMessage.includes("expired")
        ) {
          // 만료/무효 세션이 남아있는 상태로 signUp을 호출한 경우 - 세션을 정리하고 재시도를 안내한다.
          await supabase.auth.signOut();
          setSubmissionError("인증 세션이 만료되었습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.");
        } else {
          setSubmissionError(`회원가입 중 오류: ${authError.message || "알 수 없는 오류"}`);
        }
        return false;
      }

      if (!authData.user || !authData.session) {
        // 이메일 인증이 필요한 프로젝트에서는 signUp 직후 session이 없는 것이 정상이다.
        // 인증 링크를 클릭하면 콜백에서 세션을 확보하는 즉시 선택했던 매장들의 승인 신청이
        // 자동으로 일괄 처리되므로, 사용자는 여기로 다시 돌아와 버튼을 다시 누를 필요가 없다.
        setSubmissionError("인증 메일을 확인한 뒤 메일의 인증 링크를 클릭해주세요. 링크를 클릭하면 선택하신 매장의 승인 신청이 자동으로 접수됩니다.");
        return false;
      }

      // ✅ 중요: signUp 직후 HTTP 쿠키가 실제로 반영되었는지 확인한다.
      // 이를 확인하지 않으면 바로 이어지는 store-membership 호출이 세션 누락(401)으로 실패할 수 있다.
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session || sessionData.session.user.email !== profileEmail) {
        logSafeAuthError("SIGNUP_APPROVAL_SESSION_VERIFY_FAILED", new Error("Session verification failed after signUp"));
        setSubmissionError("세션 확보에 실패했습니다. 다시 시도해주세요.");
        return false;
      }

      setEmailAlreadyRegistered(false);
  sessionStorage.removeItem("signupAuthAttemptEmail");
  sessionStorage.removeItem("signupAuthAttemptAt");
      return true;
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

  const handleRequestAll = async () => {
    const requestableApprovals = storeApprovals.filter(
      (item) => item.status === "requestable"
    );

    if (requestableApprovals.length === 0) return;

    setIsLoading(true);
    setSubmissionError("");
    setEmailAlreadyRegistered(false);

    try {
      // Auth session 확보 (아직 이메일 인증 전이라면 requestableApprovals를 signUp metadata에
      // 담아 인증 콜백이 자동으로 일괄 처리하도록 한다)
      const isAuthenticated = await ensureSignupAuthSession(requestableApprovals);
      if (!isAuthenticated) {
        setIsLoading(false);
        return;
      }

      // ensureSignupAuthSession이 true를 반환해도 그 사이 세션이 끊겼을 가능성에 대비해,
      // 매장별 승인 신청 API를 호출하기 직전 세션이 실제로 살아있는지 한 번 더 확인한다.
      // 세션이 없으면 API를 호출하지 않고 즉시 안내 후 중단한다.
      const supabase = createClient();
      const { data: sessionCheck } = await supabase.auth.getSession();
      if (!sessionCheck.session) {
        setSubmissionError("인증 세션을 확인할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.");
        setIsLoading(false);
        return;
      }

      // Create memberships for all requestable stores (userId from server auth.getUser)
      for (const approval of requestableApprovals) {
        try {
          const response = await fetch("/api/signup/store-membership", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              storeId: approval.store.id,
              storeName: approval.store.name,
              role: role,
            }),
          });

          const result = (await response.json()) as { success: boolean; error?: string };

          if (!result.success) {
            console.error("Membership 생성 실패:", result);
            alert(`매장 "${approval.store.name}" 승인 요청 중 오류: ${result.error || "알 수 없는 오류"}`);
            setIsLoading(false);
            return;
          }
        } catch (e) {
          console.error("Membership 생성 중 예외:", e);
          alert(`매장 "${approval.store.name}" 승인 요청 중 오류`);
          setIsLoading(false);
          return;
        }
      }

      // Update local state to pending
      const updatedApprovals = storeApprovals.map((item) =>
        item.status === "requestable"
          ? {
              ...item,
              status: "pending" as ApprovalStatus,
              requestedAt: new Date().toISOString(),
            }
          : item
      );

      setStoreApprovals(updatedApprovals);
      sessionStorage.setItem("signupStoreApprovals", JSON.stringify(updatedApprovals));
      sessionStorage.removeItem("signupPassword");

      alert("승인 요청이 완료되었습니다.\n본사 승인을 기다려 주세요.");

      // Move to approval status page
      router.push("/signup/approval-status");
    } catch (e) {
      console.error("승인 요청 중 오류:", e);
      alert("승인 요청 중 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

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
                      {isLoading ? "신청 중..." : "승인 신청"}
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
                                className="h-8 px-3 text-xs sm:text-sm flex-shrink-0"
                              >
                                <Trash2 size={14} className="mr-1" />
                                삭제
                              </Button>
                              {approval.status === "pending" ? (
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
