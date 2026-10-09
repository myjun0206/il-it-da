"use client";

import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Check, Camera, Store } from "lucide-react";

import ThemeSelector from "@/components/common/ThemeSelector";
import ProfileAvatar from "@/components/common/ProfileAvatar";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { AccountDeleteConfirmDialog } from "@/components/common/AccountDeleteConfirmDialog";
import { useStaffShell } from "@/components/staff/StaffShellContext";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";
import {
  readSelectedStaffStoreId,
  writeSelectedStaffStoreId,
  writeStaffConversationId,
} from "@/lib/staff/selected-store";
import { clearStaffSessionKeys, hasPasswordLogin } from "@/lib/staff/staff-membership-service";
import { createClient } from "@/lib/supabase/client";
import { uploadProfileAvatarClient, deleteProfileAvatarClient } from "@/lib/supabase/storage-profile-avatar";

// 직원 환경설정 (최소 구성): 계정 정보 확인 · 화면 테마 · 로그아웃. 점주/HQ 설정 화면과 같은 카드·행 스타일.
const cardClass = "bg-white border border-[var(--color-border)] rounded-xl p-6 mb-6 shadow-sm";
const rowClass =
  "flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-6 border-t border-[var(--color-border)] first:border-t-0 first:pt-0 last:pb-0";
const rowLabelClass = "w-40 shrink-0 text-sm font-medium text-[var(--color-text-secondary)]";
const secondaryButtonClass =
  "flex h-11 w-32 shrink-0 items-center justify-center rounded-lg border-2 border-[var(--color-border)] bg-white px-5 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap";
const primaryButtonClass =
  "flex h-11 w-32 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)] px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap";
const dangerButtonClass =
  "flex h-11 w-32 shrink-0 items-center justify-center rounded-lg border-2 border-red-300 bg-white px-5 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-60 transition-colors whitespace-nowrap";
const successBorderButtonClass =
  "flex h-11 w-32 shrink-0 items-center justify-center rounded-lg border-2 border-[var(--color-primary)] bg-white px-5 text-sm font-medium text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap";
const compactButtonClass =
  "text-sm font-medium text-[var(--color-text-primary)] hover:text-[var(--color-primary)] transition-colors underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded px-1 py-1 disabled:cursor-not-allowed disabled:opacity-60";

type Feedback = { type: "success" | "error"; message: string } | null;

function FeedbackMessage({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  const isSuccess = feedback.type === "success";
  const Icon = isSuccess ? CheckCircle2 : AlertCircle;
  return (
    <p
      role={isSuccess ? "status" : "alert"}
      className={`mt-4 flex items-center gap-2 text-base font-medium ${isSuccess ? "text-[var(--color-primary)]" : "text-red-700"}`}
    >
      <Icon size={20} aria-hidden="true" />
      {feedback.message}
    </p>
  );
}

export default function StaffSettingsPage() {
  const router = useRouter();
  const { userName, roleLabel, defaultStoreId, stores, isStoresLoading, reloadStores, logout } = useStaffShell();
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFeedback, setAvatarFeedback] = useState<Feedback>(null);

  // 가입 정보 상태
  const [signupFullName, setSignupFullName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPhoneNumber, setSignupPhoneNumber] = useState("");
  const [signupDataLoading, setSignupDataLoading] = useState(false);

  // 비밀번호 변경 상태
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [passwordChangeMode, setPasswordChangeMode] = useState<"idle" | "verify" | "change" | "success">("idle");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);
  const [isAuthenticatingPassword, setIsAuthenticatingPassword] = useState(false);
  const [isPasswordAuthenticated, setIsPasswordAuthenticated] = useState(false);

  // 매장 탈퇴 상태
  const [selectedWithdrawStore, setSelectedWithdrawStore] = useState<string | null>(null);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawFeedback, setWithdrawFeedback] = useState<Feedback>(null);
  const [withdrawConfirmDialog, setWithdrawConfirmDialog] = useState<{
    isOpen: boolean;
    storeId?: string;
    storeName?: string;
    isDefault?: boolean;
  }>({ isOpen: false });

  // 회원 탈퇴 상태
  const [showAccountDeleteConfirm, setShowAccountDeleteConfirm] = useState(false);
  const [accountDeletePassword, setAccountDeletePassword] = useState("");
  const [isAuthenticatingForDelete, setIsAuthenticatingForDelete] = useState(false);
  const [isAccountDeletePasswordAuthenticated, setIsAccountDeletePasswordAuthenticated] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isOAuthUser, setIsOAuthUser] = useState(false);
  const [accountDeleteError, setAccountDeleteError] = useState<string | null>(null);

  // 비밀번호 변경 관련 상태 초기화
  const resetPasswordChangeState = () => {
    setShowPasswordChange(false);
    setPasswordChangeMode("idle");
    setCurrentPassword("");
    setNewPassword("");
    setNewPasswordConfirm("");
    setIsPasswordAuthenticated(false);
    setPasswordFeedback(null);
  };

  // 비밀번호 변경 성공 후 확인 버튼 핸들러
  const handleConfirmPasswordSuccess = () => {
    resetPasswordChangeState();
  };

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();

        if (!isCancelled && userData.user) {
          setUserId(userData.user.id);
          setEmail(userData.user.email ?? "");

          // 소셜 로그인(OAuth) 전용 계정 여부 확인 (비밀번호 없는 계정)
          setIsOAuthUser(!hasPasswordLogin(userData.user));

          // avatar_url 조회 (cache busting은 이제 filename에 포함됨)
          const { data: profile } = await supabase
            .from("profiles")
            .select("avatar_url, avatar_updated_at, full_name")
            .eq("id", userData.user.id)
            .maybeSingle<{ avatar_url: string | null; avatar_updated_at: string | null; full_name: string | null }>();

          if (!isCancelled) {
            // 원본 URL만 사용 (query string 없음)
            // filename이 avatar-{timestamp}.jpg 형태이므로 cache busting 불필요
            setAvatarUrl(profile?.avatar_url || null);
          }
        }
      } catch (e) {
        console.error("Failed to load staff account:", e);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, []);

  // 가입 정보 로드
  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      setSignupDataLoading(true);
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();

        if (!isCancelled && userData.user) {
          // auth.users에서 직접 가입 정보 조회
          setSignupEmail(userData.user.email ?? "");

          // 우선: auth.users.user_metadata에서 full_name 조회 (가입 시 저장됨)
          const metadataFullName = userData.user.user_metadata?.full_name as string | undefined;

          // 메타데이터에 full_name이 없으면 profiles 테이블에서 조회
          let fullName = metadataFullName ?? "";
          if (!fullName) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("id", userData.user.id)
              .maybeSingle<{ full_name: string | null }>();

            fullName = profile?.full_name ?? "";
          }

          if (!isCancelled) {
            setSignupFullName(fullName);
          }

          // signup_profiles 테이블에서 전화번호 조회
          const { data: signupProfile } = await supabase
            .from("signup_profiles")
            .select("phone_number")
            .eq("user_id", userData.user.id)
            .maybeSingle<{ phone_number: string | null }>();

          if (!isCancelled) {
            setSignupPhoneNumber(signupProfile?.phone_number ?? "");
          }
        }
      } catch (e) {
        console.error("Failed to load signup info:", e);
      } finally {
        if (!isCancelled) {
          setSignupDataLoading(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, []);

  const handleAvatarFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 브라우저 로컬 미리보기: DataURL 사용
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarPreview(reader.result as string);
      setAvatarFeedback(null);
    };
    reader.readAsDataURL(file);
  };

  const handleCancelAvatarPreview = () => {
    setAvatarPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setAvatarFeedback(null);
  };

  const handleUploadAvatar = async () => {
    if (!fileInputRef.current?.files?.[0]) return;
    if (isUploadingAvatar) return;

    const file = fileInputRef.current.files[0];
    const mimeType = file.type;

    setIsUploadingAvatar(true);
    setAvatarFeedback(null);

    try {
      const result = await uploadProfileAvatarClient(file, mimeType);

      if (result.success && result.avatarUrl) {
        // cache busting은 이제 filename에 포함됨 (avatar-{timestamp}.jpg)
        // 따라서 query string 불필요, 원본 URL만 사용
        setAvatarUrl(result.avatarUrl);
        setAvatarPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setAvatarFeedback({ type: "success", message: "프로필 사진이 저장되었습니다." });

        // Header에 avatar 변경 이벤트 전송
        window.dispatchEvent(
          new CustomEvent("staffAvatarUpdated", {
            detail: { avatarUrl: result.avatarUrl },
          })
        );
      } else {
        setAvatarFeedback({
          type: "error",
          message: result.error || "프로필 사진 업로드에 실패했습니다.",
        });
      }
    } catch (e) {
      setAvatarFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "프로필 사진 업로드 중 오류가 발생했습니다.",
      });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleDeleteAvatar = async () => {
    if (!avatarUrl) return;
    if (!window.confirm("프로필 사진을 삭제할까요?")) return;

    setAvatarFeedback(null);

    try {
      const result = await deleteProfileAvatarClient();

      if (result.success) {
        setAvatarUrl(null);
        setAvatarPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setAvatarFeedback({ type: "success", message: "프로필 사진이 삭제되었습니다." });

        // Header에 avatar 변경 이벤트 전송
        window.dispatchEvent(
          new CustomEvent("staffAvatarUpdated", {
            detail: { avatarUrl: null },
          })
        );
      } else {
        setAvatarFeedback({
          type: "error",
          message: result.error || "프로필 사진 삭제에 실패했습니다.",
        });
      }
    } catch (e) {
      setAvatarFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "프로필 사진 삭제 중 오류가 발생했습니다.",
      });
    }
  };

  // 비밀번호 인증 (현재 비밀번호 확인)
  const handleAuthenticatePassword = async () => {
    if (!currentPassword) {
      setPasswordFeedback({ type: "error", message: "현재 비밀번호를 입력해주세요." });
      return;
    }

    setIsAuthenticatingPassword(true);
    setPasswordFeedback(null);

    try {
      // 백엔드 API로 현재 비밀번호 검증
      const response = await fetch("/api/staff/validate-password", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: currentPassword }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        code?: string;
        message?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.message || "현재 비밀번호가 일치하지 않습니다.");
      }

      setIsPasswordAuthenticated(true);
      setPasswordChangeMode("change");
      setPasswordFeedback(null);
    } catch (e) {
      setPasswordFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "비밀번호 인증에 실패했습니다.",
      });
    } finally {
      setIsAuthenticatingPassword(false);
    }
  };

  // 비밀번호 변경 핸들러
  const handleChangePassword = async () => {
    if (!isPasswordAuthenticated) {
      setPasswordFeedback({ type: "error", message: "먼저 현재 비밀번호로 인증해주세요." });
      return;
    }

    if (!newPassword || !newPasswordConfirm) {
      setPasswordFeedback({ type: "error", message: "새 비밀번호를 입력해주세요." });
      return;
    }

    if (newPassword !== newPasswordConfirm) {
      setPasswordFeedback({ type: "error", message: "새 비밀번호가 일치하지 않습니다." });
      return;
    }

    if (newPassword.length < 8) {
      setPasswordFeedback({ type: "error", message: "비밀번호는 8자 이상 입력해주세요." });
      return;
    }

    if (newPassword === currentPassword) {
      setPasswordFeedback({ type: "error", message: "새 비밀번호는 현재 비밀번호와 달라야 합니다." });
      return;
    }

    setIsChangingPassword(true);
    setPasswordFeedback(null);

    try {
      // 백엔드 API로 비밀번호 변경
      const response = await fetch("/api/staff/change-password", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ newPassword }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        code?: string;
        message?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.message || "비밀번호 변경에 실패했습니다.");
      }

      // ✅ API 성공 → mode를 "success"로 변경 (폼은 유지)
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      setIsPasswordAuthenticated(false);
      setPasswordChangeMode("success");
      setPasswordFeedback(null);
    } catch (e) {
      // ❌ 실패 → 현재 입력 화면 유지, 에러 메시지만 표시
      setPasswordFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "비밀번호 변경에 실패했습니다.",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  // 회원 탈퇴 비밀번호 인증
  const handleAuthenticateForDelete = async () => {
    if (!accountDeletePassword) {
      setAccountDeleteError("비밀번호를 입력해주세요.");
      return;
    }

    setIsAuthenticatingForDelete(true);
    setAccountDeleteError(null);

    try {
      // 브라우저 client로 재로그인하면 현재 세션이 교체되므로 서버 검증 API만 사용한다.
      const response = await fetch("/api/staff/validate-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: accountDeletePassword }),
      });
      const result = (await response.json()) as { success?: boolean; message?: string };

      if (!response.ok || !result.success) {
        throw new Error(result.message || "비밀번호가 일치하지 않습니다.");
      }

      setIsAccountDeletePasswordAuthenticated(true);
    } catch (e) {
      setAccountDeleteError(e instanceof Error ? e.message : "본인 확인에 실패했습니다.");
    } finally {
      setIsAuthenticatingForDelete(false);
    }
  };

  // 회원 탈퇴 실행
  const handleDeleteAccount = async () => {
    if (!isOAuthUser && !isAccountDeletePasswordAuthenticated) {
      setAccountDeleteError("먼저 비밀번호로 본인 확인을 해주세요.");
      return;
    }

    setIsDeleting(true);
    setAccountDeleteError(null);

    try {
      const response = await fetch("/api/staff/delete-account", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: isOAuthUser ? undefined : accountDeletePassword,
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        code?: string;
        error?: string;
        message?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.error || result.message || "회원 탈퇴 요청에 실패했습니다.");
      }

      // 탈퇴 성공: Auth 세션 로그아웃 (실패해도 계정 삭제 실패로 처리하지 않는다)
      // auth-js signOut은 서버 로그아웃 API가 실패해도 로컬 Auth 세션(쿠키)을 제거하고 error를 반환한다.
      try {
        const supabase = createClient();
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          console.warn("[STAFF_SETTINGS] Sign out after account deletion returned error:", signOutError.message);
        }
      } catch (signOutError) {
        console.warn("[STAFF_SETTINGS] Sign out after account deletion failed:", signOutError);
      }

      // 앱 sessionStorage 키 정리 (Auth 세션과 별개, sessionStorage 전체 clear 방지)
      clearStaffSessionKeys(userId);

      // 홈 화면으로 이동
      router.push("/");
    } catch (e) {
      setAccountDeleteError(e instanceof Error ? e.message : "회원 탈퇴에 실패했습니다.");
      setIsDeleting(false);
    }
  };

  // 매장 탈퇴 핸들러
  const handleWithdrawStore = async (storeId: string) => {
    setIsWithdrawing(true);
    setWithdrawFeedback(null);

    try {
      const store = stores.find((s) => s.id === storeId);
      if (!store?.membershipId) {
        throw new Error("매장 정보를 확인할 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.");
      }

      const response = await fetch(`/api/staff/memberships/${encodeURIComponent(store.membershipId)}`, {
        method: "DELETE",
        credentials: "include",
      });

      const data = (await response.json()) as { success: boolean; error?: string };

      if (!response.ok || !data.success) {
        throw new Error(data.error || "매장 탈퇴에 실패했습니다.");
      }

      setWithdrawFeedback({ type: "success", message: "매장 탈퇴가 완료되었습니다." });
      setSelectedWithdrawStore(null);
      setWithdrawConfirmDialog({ isOpen: false });

      // 탈퇴한 매장이 현재 선택된 매장이었으면 선택값 정리
      if (readSelectedStaffStoreId() === storeId) {
        writeSelectedStaffStoreId(null);
        writeStaffConversationId(null);
      }

      reloadStores();
    } catch (e) {
      setWithdrawFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "요청을 처리하지 못했습니다.",
      });
    } finally {
      setIsWithdrawing(false);
    }
  };

  // 기본 매장 탈퇴 전 확인
  const handleConfirmWithdraw = (storeId: string) => {
    const store = stores.find((s) => s.id === storeId);
    if (!store) return;

    const isDefault = defaultStoreId === storeId;
    setWithdrawConfirmDialog({
      isOpen: true,
      storeId,
      storeName: formatStoreDisplayName(store.name),
      isDefault,
    });
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">환경설정</h1>
          <p className="text-base text-[var(--color-text-primary)] opacity-70">프로필과 서비스 이용 환경을 설정합니다.</p>
        </div>

        {/* === 계정 정보 카드 === */}
        <section aria-labelledby="account-heading" className={cardClass}>
          <h2 id="account-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
            계정 정보
          </h2>
          <p className="mb-4 text-base text-[var(--color-text-primary)] opacity-70">내 프로필과 근무 정보를 확인하고 관리합니다.</p>

          {/* === 프로필 섹션 === */}
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 mb-8">
            {/* Avatar: 왼쪽 고정 */}
            <div className="flex-shrink-0">
              <ProfileAvatar
                name={userName}
                avatarUrl={avatarPreview || avatarUrl}
                size="xl"
              />
              
              {/* 사진 변경 입력 */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                onChange={handleAvatarFileSelect}
                disabled={isUploadingAvatar}
                className="hidden"
                aria-label="프로필 사진 선택"
              />
            </div>

            {/* 사용자 정보 영역: 중앙 확장 */}
            <div className="flex-1 flex flex-col gap-4">
              {/* 이름 + 역할 배지 */}
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-[var(--color-text-primary)]">
                  {userName || "등록된 이름 없음"}
                </h3>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-xs font-medium text-[var(--color-primary)]">
                  {roleLabel || "역할 정보 없음"}
                </span>
              </div>

              {/* 이메일 */}
              <div>
                <p className="text-xs text-[var(--color-text-tertiary)] mb-1">이메일</p>
                <p className="text-sm font-medium text-[var(--color-text-primary)] break-all">
                  {email || "등록된 이메일 없음"}
                </p>
              </div>

              {/* 피드백 메시지 */}
              <FeedbackMessage feedback={avatarFeedback} />
            </div>

            {/* 사진 변경 액션: 오른쪽 끝 고정 */}
            <div className="flex-shrink-0 flex flex-col gap-1 items-end justify-start">
              {avatarPreview ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleUploadAvatar}
                    disabled={isUploadingAvatar}
                    className={compactButtonClass}
                  >
                    {isUploadingAvatar ? "저장 중..." : "저장"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelAvatarPreview}
                    disabled={isUploadingAvatar}
                    className={compactButtonClass}
                  >
                    취소
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingAvatar}
                  className="inline-flex h-10 items-center gap-2 px-3 text-sm font-medium text-[var(--color-text-primary)] border-2 border-[var(--color-border)] bg-white transition-colors hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-bg-default)] rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="프로필 사진 변경"
                >
                  <Camera size={18} aria-hidden="true" className="flex-shrink-0" />
                  <span>사진 변경</span>
                </button>
              )}
            </div>
          </div>

          {/* Divider + 간격 조정 */}
          <div className="border-t border-[var(--color-border)] py-6" />

          {/* === 근무 정보 섹션 === */}
          <div>
            {isStoresLoading ? (
              <p className="text-base text-[var(--color-text-secondary)]">불러오는 중...</p>
            ) : stores.length > 0 ? (
              <>
                {/* 헤더 - 흰색 배경 */}
                <div className="flex items-center justify-between gap-4 mb-6">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-lg font-bold text-[var(--color-text-primary)]">근무 매장</h3>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[var(--color-primary)]/10 text-xs font-bold text-[var(--color-primary)]">
                      {`${stores.length}`}
                    </span>
                  </div>
                  <a
                    href="/staff/stores"
                    className="inline-flex h-10 items-center gap-2 px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Store size={18} aria-hidden="true" className="flex-shrink-0" />
                    <span>매장 관리</span>
                  </a>
                </div>

                {/* 기본 매장 - 선택 배경 */}
                {stores.map((store) => {
                  const isCurrent = defaultStoreId === store.id;
                  if (isCurrent) {
                    return (
                      <div
                        key={store.id}
                        className="bg-[var(--color-primary)]/8 border border-[var(--color-primary)]/15 rounded-lg mb-2"
                      >
                        <div className="flex items-center justify-between gap-3 px-4 py-3">
                          <p className="text-base font-medium text-[var(--color-text-primary)]">
                            {formatStoreDisplayName(store.name)}
                          </p>
                          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0" aria-label="기본 매장" title="기본 매장">
                            <Check size={18} className="text-[var(--color-primary)]" aria-hidden="true" />
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })}

                {/* 일반 매장 목록 */}
                {stores.some((s) => defaultStoreId !== s.id) && (
                  <div className="space-y-2">
                    {stores.map((store) => {
                      const isCurrent = defaultStoreId === store.id;
                      if (!isCurrent) {
                        return (
                          <div
                            key={store.id}
                            className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg transition-colors"
                          >
                            <p className="text-base font-medium text-[var(--color-text-primary)]">
                              {formatStoreDisplayName(store.name)}
                            </p>
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}
              </>
            ) : (
              <p className="text-base text-[var(--color-text-secondary)]">승인된 근무 매장이 없습니다.</p>
            )}
          </div>
        </section>

        {/* === 가입 정보 카드 === */}
        <section aria-labelledby="signup-heading" className={cardClass}>
          <h2 id="signup-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
            가입 정보
          </h2>
          <p className="mb-6 text-base text-[var(--color-text-primary)] opacity-70">
            가입 시 등록한 정보입니다. 비밀번호만 변경할 수 있습니다.
          </p>

          {/* 가입 정보 필드 */}
          {signupDataLoading ? (
            <p className="text-base text-[var(--color-text-secondary)]">로드 중...</p>
          ) : (
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  이름
                </label>
                <input
                  type="text"
                  value={signupFullName}
                  disabled
                  className="w-full px-4 py-3 rounded-lg bg-[var(--color-bg-default)] border border-[var(--color-border)] text-[var(--color-text-primary)] cursor-not-allowed opacity-70"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  이메일
                </label>
                <input
                  type="email"
                  value={signupEmail}
                  disabled
                  className="w-full px-4 py-3 rounded-lg bg-[var(--color-bg-default)] border border-[var(--color-border)] text-[var(--color-text-primary)] cursor-not-allowed opacity-70"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  전화번호
                </label>
                <input
                  type="tel"
                  value={signupPhoneNumber || "등록된 전화번호가 없습니다"}
                  disabled
                  className="w-full px-4 py-3 rounded-lg bg-[var(--color-bg-default)] border border-[var(--color-border)] text-[var(--color-text-primary)] cursor-not-allowed opacity-70"
                />
              </div>
            </div>
          )}

          {/* 구분선 */}
          <div className="border-t border-[var(--color-border)] my-6" />

          {/* 비밀번호 변경 섹션 */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-[var(--color-text-primary)]">비밀번호</h3>
              <p className="text-base text-[var(--color-text-secondary)] mt-1">계정 보안을 위해 비밀번호를 변경할 수 있습니다.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (showPasswordChange) {
                  resetPasswordChangeState();
                } else {
                  setShowPasswordChange(true);
                  setPasswordChangeMode("verify");
                }
              }}
              className={secondaryButtonClass}
            >
              {showPasswordChange ? "취소" : "비밀번호 변경"}
            </button>
          </div>

          {/* 비밀번호 변경 폼 */}
          {showPasswordChange && (
            <div className="mt-6 pt-6 border-t border-[var(--color-border)] space-y-4">
              {/* Step 1: 현재 비밀번호 인증 */}
              {passwordChangeMode === "verify" && (
                <>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 flex flex-col">
                      <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                        현재 비밀번호
                      </label>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="현재 비밀번호를 입력하세요"
                        className="h-11 px-4 rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
                        disabled={isAuthenticatingPassword}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAuthenticatePassword}
                      disabled={isAuthenticatingPassword}
                      className={primaryButtonClass}
                    >
                      {isAuthenticatingPassword ? "인증 중..." : "인증"}
                    </button>
                  </div>

                  <FeedbackMessage feedback={passwordFeedback} />
                </>
              )}

              {/* Step 2: 새 비밀번호 설정 */}
              {passwordChangeMode === "change" && (
                <>
                  <div className="mb-4 p-4 rounded-lg bg-[var(--color-primary-light)]/20 border border-[var(--color-primary)]/30">
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      ✓ 본인 확인이 완료되었습니다. 새 비밀번호를 입력해주세요.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                      새 비밀번호
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="최소 8자 이상"
                      className="w-full h-11 px-4 rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
                      disabled={isChangingPassword}
                    />
                  </div>

                  <div className="flex gap-2 items-end">
                    <div className="flex-1 flex flex-col">
                      <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                        비밀번호 확인
                      </label>
                      <input
                        type="password"
                        value={newPasswordConfirm}
                        onChange={(e) => setNewPasswordConfirm(e.target.value)}
                        placeholder="새 비밀번호를 다시 입력하세요"
                        className="h-11 px-4 rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
                        disabled={isChangingPassword}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleChangePassword}
                      disabled={isChangingPassword}
                      className={primaryButtonClass}
                    >
                      {isChangingPassword ? "변경 중..." : "변경"}
                    </button>
                  </div>

                  {passwordFeedback?.type === "error" && <FeedbackMessage feedback={passwordFeedback} />}
                </>
              )}

              {/* 성공 상태 - Compact 가로 레이아웃 */}
              {passwordChangeMode === "success" && (
                <div className="bg-[var(--color-primary)]/8 border border-[var(--color-primary)]/15 rounded-lg px-4 py-3 mt-4">
                  <div className="flex items-center justify-between gap-4">
                    <div
                      role="status"
                      aria-live="polite"
                      className="flex items-center gap-2 text-base font-medium text-[var(--color-primary)]"
                    >
                      <CheckCircle2 size={18} aria-hidden="true" className="flex-shrink-0" />
                      <span>비밀번호가 변경되었습니다.</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleConfirmPasswordSuccess}
                      className={successBorderButtonClass}
                    >
                      확인
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* === 매장 탈퇴 카드 === */}
        <section aria-labelledby="withdraw-heading" className={cardClass}>
          <h2 id="withdraw-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
            매장 탈퇴
          </h2>
          <p className="mb-6 text-base text-[var(--color-text-primary)] opacity-70">
            승인받은 근무 매장 중 탈퇴할 매장을 선택하세요.
          </p>

          {/* 매장 목록 */}
          {isStoresLoading ? (
            <p className="text-base text-[var(--color-text-secondary)]">불러오는 중...</p>
          ) : stores.length > 0 ? (
            <>
              <div className="space-y-3 mb-6">
                {stores.map((store) => {
                  const isSelected = selectedWithdrawStore === store.id;
                  const isDefault = defaultStoreId === store.id;

                  return (
                    <div
                      key={store.id}
                      onClick={() =>
                        setSelectedWithdrawStore(isSelected ? null : store.id)
                      }
                      className={`flex items-center gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        isSelected
                          ? "bg-[var(--color-primary-light)]/10 border-[var(--color-primary)] shadow-sm"
                          : "bg-white border-[var(--color-border)] hover:border-[var(--color-primary)]/50"
                      }`}
                    >
                      {/* 선택 원형 */}
                      <div
                        className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          isSelected
                            ? "bg-[var(--color-primary)] border-[var(--color-primary)]"
                            : "border-[var(--color-border)]"
                        }`}
                      >
                        {isSelected && (
                          <Check size={16} className="text-white" aria-hidden="true" />
                        )}
                      </div>

                      {/* 매장 정보 */}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-base font-semibold text-[var(--color-text-primary)]">
                            {formatStoreDisplayName(store.name)}
                          </p>
                          {isDefault && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full bg-[var(--color-primary)]/10 text-xs font-medium text-[var(--color-primary)]">
                              기본 매장
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-[var(--color-text-secondary)]">
                          승인 완료
                        </p>
                      </div>

                      {/* 체크 아이콘 */}
                      {isSelected && (
                        <div className="flex-shrink-0">
                          <Check size={20} className="text-[var(--color-primary)]" aria-hidden="true" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 탈퇴 버튼 */}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedWithdrawStore) return;
                    handleConfirmWithdraw(selectedWithdrawStore);
                  }}
                  disabled={!selectedWithdrawStore || isWithdrawing}
                  className={primaryButtonClass}
                >
                  {isWithdrawing ? "처리 중..." : "선택한 매장 탈퇴"}
                </button>
              </div>

              <FeedbackMessage feedback={withdrawFeedback} />
            </>
          ) : (
            <p className="text-base text-[var(--color-text-secondary)]">승인된 근무 매장이 없습니다.</p>
          )}
        </section>

        {/* === 회원 탈퇴 카드 === */}
        <section aria-labelledby="delete-account-heading" className={cardClass}>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="min-w-0">
              <h2 id="delete-account-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
                회원 탈퇴
              </h2>
              <p className="text-base text-[var(--color-text-primary)] opacity-70">
                일잇다 서비스 이용을 종료하고 계정을 삭제합니다. 탈퇴 시 소속된 모든 매장에서 자동으로 탈퇴되며, 승인 대기 중인 매장 신청도 취소됩니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAccountDeleteConfirm(true)}
              className={dangerButtonClass}
            >
              회원 탈퇴
            </button>
          </div>
        </section>

        {/* === 화면 설정 카드 === */}
        <section aria-labelledby="display-heading" className={cardClass}>
          <h2 id="display-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
            화면 설정
          </h2>
          <p className="mb-6 text-base text-[var(--color-text-primary)] opacity-70">
            일잇다의 화면 테마를 선택합니다. 시스템 설정을 선택하면 기기의 라이트/다크 모드를 따릅니다.
          </p>
          <ThemeSelector />
        </section>

        {/* === 매장 탈퇴 확인 대화상자 === */}
        <ConfirmDialog
          isOpen={withdrawConfirmDialog.isOpen}
          title={
            withdrawConfirmDialog.isDefault
              ? "기본 매장 탈퇴"
              : "매장 탈퇴"
          }
          description={
            withdrawConfirmDialog.isDefault
              ? `기본 매장인 "${withdrawConfirmDialog.storeName}"에서 탈퇴하시겠습니까? 탈퇴 후 다른 기본 매장을 설정해주세요.`
              : `"${withdrawConfirmDialog.storeName}"에서 탈퇴하시겠습니까? 이 작업은 되돌릴 수 없습니다.`
          }
          confirmText="탈퇴"
          cancelText="취소"
          isDangerous
          isLoading={isWithdrawing}
          onConfirm={() => {
            if (withdrawConfirmDialog.storeId) {
              handleWithdrawStore(withdrawConfirmDialog.storeId);
            }
          }}
          onCancel={() => setWithdrawConfirmDialog({ isOpen: false })}
        />

        {/* === 회원 탈퇴 확인 대화상자 === */}
        <AccountDeleteConfirmDialog
          isOpen={showAccountDeleteConfirm}
          title="회원 탈퇴"
          description={
            isOAuthUser
              ? "소셜 로그인 계정으로 등록된 일잇다 서비스 이용을 종료하고 계정을 삭제합니다. 아래 탈퇴 버튼을 누르면 즉시 계정이 삭제됩니다."
              : "일잇다 서비스 이용을 종료하고 계정을 삭제합니다. 본인 확인을 위해 비밀번호를 입력해주세요."
          }
          passwordValue={accountDeletePassword}
          isAuthenticated={isAccountDeletePasswordAuthenticated}
          isAuthenticating={isAuthenticatingForDelete}
          isDeleting={isDeleting}
          isOAuthUser={isOAuthUser}
          errorMessage={accountDeleteError}
          onPasswordChange={setAccountDeletePassword}
          onAuthenticate={handleAuthenticateForDelete}
          onConfirmDelete={handleDeleteAccount}
          onCancel={() => {
            setShowAccountDeleteConfirm(false);
            setAccountDeletePassword("");
            setIsAccountDeletePasswordAuthenticated(false);
            setAccountDeleteError(null);
          }}
        />
      </div>
    </div>
  );
}
