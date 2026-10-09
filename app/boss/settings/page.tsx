"use client";

import React, { useLayoutEffect, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Camera, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import ThemeSelector from "@/components/common/ThemeSelector";
import ProfileAvatar from "@/components/common/ProfileAvatar";
import { uploadProfileAvatarClient, deleteProfileAvatarClient } from "@/lib/supabase/storage-profile-avatar";

interface UserInfo {
  name: string;
  email: string;
  franchiseName: string | null;
  avatarUrl: string | null;
  userId: string;
}

interface NotificationPreferences {
  staffJoinRequest: boolean;
  hqNotices: boolean;
  manualUpdates: boolean;
}

interface StoreMembership {
  storeId: string;
  storeName: string;
  status: string;
  role: string;
}

const NOTIFICATION_OPTIONS: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  { key: "staffJoinRequest", label: "직원 가입 승인 요청", description: "새로운 직원의 매장 가입 요청 알림" },
  { key: "hqNotices", label: "본사 공지사항", description: "새로운 본사 공지를 알려드립니다." },
  { key: "manualUpdates", label: "매뉴얼 관련 알림", description: "공통 매뉴얼 변경사항을 알려드립니다." },
];

type Feedback = { type: "success" | "error"; message: string } | null;
type PasswordStep = "closed" | "current" | "new";

const NAME_MAX_LENGTH = 50;
const PASSWORD_MIN_LENGTH = 8;
// 기존 구현과 같은 키: 알림 설정은 이 기기(브라우저)에만 저장된다.
const NOTIFICATION_PREFS_KEY = "notificationPreferences";

const cardClass = "bg-white border border-[var(--color-border)] rounded-xl p-6 mb-6 shadow-sm";
const primaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-lg bg-[var(--color-primary)] px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap";
const secondaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-lg border-2 border-[var(--color-border)] bg-white px-5 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap";

function FeedbackMessage({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  const isSuccess = feedback.type === "success";
  const Icon = isSuccess ? CheckCircle2 : AlertCircle;
  return (
    <p
      role={isSuccess ? "status" : "alert"}
      className={`mt-3 flex items-center gap-2 text-base font-medium ${isSuccess ? "text-[var(--color-primary)]" : "text-red-700"}`}
    >
      <Icon size={20} aria-hidden="true" />
      {feedback.message}
    </p>
  );
}

// 토글 스위치 컴포넌트
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ${
        checked ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [isLoadingStore, setIsLoadingStore] = useState(true);
  const [error, setError] = useState("");
  const [userInfo, setUserInfo] = useState<UserInfo>({
    name: "",
    email: "",
    franchiseName: null,
    avatarUrl: null,
    userId: "",
  });
  const [storeName, setStoreName] = useState("");
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>({
    staffJoinRequest: true,
    hqNotices: true,
    manualUpdates: true,
  });
  const [prefsFeedback, setPrefsFeedback] = useState<Feedback>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameFeedback, setNameFeedback] = useState<Feedback>(null);

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFeedback, setAvatarFeedback] = useState<Feedback>(null);

  // 비밀번호 변경 상태
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);

  // 회원 탈퇴 상태
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deleteAccountPassword, setDeleteAccountPassword] = useState("");
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  // Authorization & Data Loading
  useLayoutEffect(() => {
    const checkAuthAndInit = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) {
          router.push("/");
          return;
        }

        const role = data.session.user.user_metadata?.role;
        if (role !== "owner") {
          router.push("/");
          return;
        }

        const user = data.session.user;
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, brand_id, avatar_url, avatar_updated_at")
          .eq("id", user.id)
          .maybeSingle<{
            full_name: string | null;
            brand_id: string | null;
            avatar_url: string | null;
            avatar_updated_at: string | null;
          }>();

        // 소속 프랜차이즈는 profiles.brand_id와 기존 franchises 목록 API로만 확인한다.
        let franchiseName: string | null = null;
        if (profile?.brand_id) {
          const response = await fetch("/api/franchises");
          if (response.ok) {
            const result = (await response.json()) as { franchises?: { id: string; name: string }[] };
            franchiseName = result.franchises?.find((item) => item.id === profile.brand_id)?.name ?? null;
          }
        }

        let finalAvatarUrl: string | null = null;
        if (profile?.avatar_url) {
          // cache busting은 이제 filename에 포함됨 (avatar-{timestamp}.jpg)
          // 따라서 query string 불필요, 원본 URL만 사용
          finalAvatarUrl = profile.avatar_url;
        }

        setUserInfo({
          name: profile?.full_name || user.user_metadata?.name || "",
          email: user.email || "",
          franchiseName,
          avatarUrl: finalAvatarUrl,
          userId: user.id,
        });

        // 기존 구현: localStorage에서 알림 설정 로드
        const savedPrefs = localStorage.getItem(NOTIFICATION_PREFS_KEY);
        if (savedPrefs) {
          try {
            setNotificationPrefs(JSON.parse(savedPrefs));
          } catch {
            // JSON 파싱 실패 시 기본값 유지
          }
        }

        setIsReady(true);
      } catch (e) {
        console.error("Auth initialization failed:", e);
        router.push("/");
      }
    };

    checkAuthAndInit();
  }, [router]);

  // 현재 매장 로드 (기존 구현과 같은 API/선택 매장 규칙)
  useEffect(() => {
    const loadStoreInfo = async () => {
      if (!isReady) return;

      try {
        setIsLoadingStore(true);
        const response = await fetch("/api/signup/store-membership");
        const result = await response.json();

        if (response.ok && result.success && Array.isArray(result.data)) {
          const storedStoreId = sessionStorage.getItem("selectedStoreId");
          const approved = (result.data as StoreMembership[]).filter(
            (m) => m.status === "approved" && m.role === "owner"
          );

          if (approved.length > 0) {
            const selectedStore = approved.find((s) => s.storeId === storedStoreId) || approved[0];
            setStoreName(selectedStore.storeName);
          }
        }
      } catch (e) {
        console.error("Failed to load store info:", e);
        setError("매장 정보를 불러올 수 없습니다.");
      } finally {
        setIsLoadingStore(false);
      }
    };

    loadStoreInfo();
  }, [isReady]);

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

  // 알림 설정 저장 (기존 구현: 이 기기의 localStorage)
  const handleNotificationChange = (key: keyof NotificationPreferences) => {
    const updated = {
      ...notificationPrefs,
      [key]: !notificationPrefs[key],
    };
    setNotificationPrefs(updated);
    try {
      localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(updated));
      setPrefsFeedback({ type: "success", message: "이 기기에 저장되었습니다." });
    } catch {
      setPrefsFeedback({ type: "error", message: "이 브라우저에서는 알림 설정을 저장할 수 없습니다." });
    }
    setTimeout(() => setPrefsFeedback(null), 2000);
  };

  const startEditName = () => {
    setNameDraft(userInfo.name);
    setNameFeedback(null);
    setIsEditingName(true);
  };

  const handleSaveName = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSavingName) return;

    const name = nameDraft.trim();
    if (!name) {
      setNameFeedback({ type: "error", message: "이름을 입력해주세요." });
      return;
    }

    setIsSavingName(true);
    setNameFeedback(null);
    try {
      const response = await fetch("/api/boss/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = (await response.json()) as { name?: string; error?: string };
      if (!response.ok || !result.name) {
        throw new Error(result.error || "이름을 저장하지 못했습니다.");
      }

      const savedName = result.name;
      setUserInfo((current) => ({ ...current, name: savedName }));
      setIsEditingName(false);
      setNameFeedback({ type: "success", message: "이름이 변경되었습니다." });
      // 헤더가 읽는 세션의 user_metadata도 새 이름으로 갱신한다.
      void createClient().auth.refreshSession();
    } catch (e) {
      setNameFeedback({ type: "error", message: e instanceof Error ? e.message : "이름을 저장하지 못했습니다." });
    } finally {
      setIsSavingName(false);
    }
  };

  const handleAvatarFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

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
        setUserInfo((prev) => ({ ...prev, avatarUrl: result.avatarUrl || null }));
        setAvatarPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setAvatarFeedback({ type: "success", message: "프로필 사진이 저장되었습니다." });

        // Header에 avatar 변경 이벤트 전송
        window.dispatchEvent(
          new CustomEvent("ownerAvatarUpdated", {
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
    if (!userInfo.avatarUrl) return;
    if (!window.confirm("프로필 사진을 삭제할까요?")) return;

    setAvatarFeedback(null);

    try {
      const result = await deleteProfileAvatarClient();

      if (result.success) {
        setUserInfo((prev) => ({ ...prev, avatarUrl: null }));
        setAvatarPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setAvatarFeedback({ type: "success", message: "프로필 사진이 삭제되었습니다." });

        // Header에 avatar 변경 이벤트 전송
        window.dispatchEvent(
          new CustomEvent("ownerAvatarUpdated", {
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

  const resetPasswordForm = () => {
    setNewPassword("");
    setConfirmPassword("");
  };

  const cancelChangePassword = () => {
    resetPasswordForm();
    setIsChangingPassword(false);
  };

  const handleChangePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSavingPassword) return;

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setPasswordFeedback({ type: "error", message: `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.` });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: "error", message: "새 비밀번호와 비밀번호 확인이 일치하지 않습니다." });
      return;
    }

    setIsSavingPassword(true);
    setPasswordFeedback(null);
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password: newPassword });
      if (updateError) {
        const message = /different from the old password/i.test(updateError.message)
          ? "현재 비밀번호와 다른 비밀번호를 입력해주세요."
          : /reauthentication|recent/i.test(updateError.message)
            ? "보안을 위해 다시 로그인한 뒤 비밀번호를 변경해주세요."
            : "비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해주세요.";
        throw new Error(message);
      }

      resetPasswordForm();
      setIsChangingPassword(false);
      setPasswordFeedback({ type: "success", message: "비밀번호가 변경되었습니다." });
    } catch (e) {
      setPasswordFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "비밀번호를 변경하지 못했습니다.",
      });
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (isDeletingAccount) return;

    setIsDeletingAccount(true);
    setDeleteAccountError(null);

    try {
      const response = await fetch("/api/boss/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: deleteAccountPassword }),
        credentials: "include",
      });

      const result = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(result.error || result.message || "회원 탈퇴 요청에 실패했습니다.");
      }

      // 탈퇴 성공: Auth 세션 로그아웃
      await createClient().auth.signOut();
      sessionStorage.clear();
      router.push("/");
    } catch (e) {
      setDeleteAccountError(e instanceof Error ? e.message : "회원 탈퇴에 실패했습니다.");
    } finally {
      setIsDeletingAccount(false);
    }
  };

  if (!isReady) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex">
      <OwnerSidebar activeMenu="settings" onLogout={handleLogout} />

      <div className="flex-1 min-w-0 flex flex-col lg:ml-[240px]">
        <OwnerHeader userName={userInfo.name} storeName={storeName} onLogout={handleLogout} />

        <main className="flex-1 overflow-y-auto p-6 lg:p-8 max-w-7xl mx-auto w-full">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">환경설정</h1>
            <p className="text-base text-[var(--color-text-secondary)]">
              계정 정보와 서비스 이용 설정을 관리할 수 있습니다.
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3" role="alert">
              <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* 1. 계정 정보 */}
          <section aria-labelledby="account-heading" className={cardClass}>
            <h2 id="account-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
              계정 정보
            </h2>
            <p className="mb-4 text-base text-[var(--color-text-primary)] opacity-70">
              내 프로필과 계정 정보를 확인합니다.
            </p>

            {/* === 프로필 섹션 === */}
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 mb-8">
              {/* Avatar: 왼쪽 고정 */}
              <div className="flex-shrink-0">
                <ProfileAvatar
                  name={userInfo.name}
                  avatarUrl={avatarPreview || userInfo.avatarUrl}
                  size="xl"
                />
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
                    {userInfo.name || "등록된 이름 없음"}
                  </h3>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-xs font-medium text-[var(--color-primary)]">
                    점주
                  </span>
                </div>

                {/* 이메일 */}
                <div>
                  <p className="text-xs text-[var(--color-text-tertiary)] mb-1">이메일</p>
                  <p className="text-sm font-medium text-[var(--color-text-primary)] break-all">
                    {userInfo.email || "등록된 이메일 없음"}
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
                      className="text-sm font-medium text-[var(--color-text-primary)] hover:text-[var(--color-primary)] transition-colors underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded px-1 py-1 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isUploadingAvatar ? "저장 중..." : "저장"}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelAvatarPreview}
                      disabled={isUploadingAvatar}
                      className="text-sm font-medium text-[var(--color-text-primary)] hover:text-[var(--color-primary)] transition-colors underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded px-1 py-1 disabled:cursor-not-allowed disabled:opacity-60"
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
          </section>

          {/* 2. 가입 정보 */}
          <section aria-labelledby="signup-heading" className={cardClass}>
            <h2 id="signup-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
              가입 정보
            </h2>
            <p className="mb-6 text-base text-[var(--color-text-primary)] opacity-70">
              가입 시 등록한 정보입니다. 이름과 비밀번호만 변경할 수 있습니다.
            </p>

            {/* 가입 정보 필드 */}
            <div className="space-y-4 mb-6">
              {/* 이름 - 수정 가능 */}
              {isEditingName ? (
                <form onSubmit={handleSaveName} className="flex flex-col gap-2">
                  <label htmlFor="owner-name" className="block text-sm font-medium text-[var(--color-text-secondary)]">
                    이름
                  </label>
                  <div className="flex gap-3">
                    <input
                      id="owner-name"
                      type="text"
                      value={nameDraft}
                      maxLength={NAME_MAX_LENGTH}
                      onChange={(event) => setNameDraft(event.target.value)}
                      autoFocus
                      className="h-11 flex-1 rounded-lg border border-[var(--color-border)] bg-white px-4 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                    />
                    <button
                      type="button"
                      onClick={() => setIsEditingName(false)}
                      disabled={isSavingName}
                      className={secondaryButtonClass}
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingName}
                      className={primaryButtonClass}
                    >
                      {isSavingName ? "저장 중..." : "저장"}
                    </button>
                  </div>
                  <FeedbackMessage feedback={nameFeedback} />
                </form>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                    이름
                  </label>
                  <input
                    type="text"
                    value={userInfo.name || "등록된 이름 없음"}
                    disabled
                    className="w-full px-4 py-3 rounded-lg bg-[var(--color-bg-default)] border border-[var(--color-border)] text-[var(--color-text-primary)] cursor-not-allowed opacity-70"
                  />
                  <FeedbackMessage feedback={nameFeedback} />
                </div>
              )}

              {/* 이메일 - 읽기 전용 */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  이메일
                </label>
                <input
                  type="email"
                  value={userInfo.email || "등록된 이메일 없음"}
                  disabled
                  className="w-full px-4 py-3 rounded-lg bg-[var(--color-bg-default)] border border-[var(--color-border)] text-[var(--color-text-primary)] cursor-not-allowed opacity-70"
                />
              </div>

              {/* 소속 프랜차이즈 - 읽기 전용 */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  소속 프랜차이즈
                </label>
                <input
                  type="text"
                  value={userInfo.franchiseName || "연결된 프랜차이즈 정보 없음"}
                  disabled
                  className="w-full px-4 py-3 rounded-lg bg-[var(--color-bg-default)] border border-[var(--color-border)] text-[var(--color-text-primary)] cursor-not-allowed opacity-70"
                />
              </div>

              {/* 현재 매장 - 읽기 전용 */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  현재 매장
                </label>
                <input
                  type="text"
                  value={isLoadingStore ? "불러오는 중..." : storeName || "승인된 매장 없음"}
                  disabled
                  className="w-full px-4 py-3 rounded-lg bg-[var(--color-bg-default)] border border-[var(--color-border)] text-[var(--color-text-primary)] cursor-not-allowed opacity-70"
                />
              </div>

              {/* 역할 - 읽기 전용 */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  역할
                </label>
                <input
                  type="text"
                  value="점주"
                  disabled
                  className="w-full px-4 py-3 rounded-lg bg-[var(--color-bg-default)] border border-[var(--color-border)] text-[var(--color-text-primary)] cursor-not-allowed opacity-70"
                />
              </div>
            </div>

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
                  if (isChangingPassword) {
                    cancelChangePassword();
                  } else {
                    setPasswordFeedback(null);
                    setIsChangingPassword(true);
                  }
                }}
                className="h-11 px-5 rounded-lg border border-[var(--color-border)] bg-white text-sm font-medium text-[var(--color-text-primary)] hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
              >
                {isChangingPassword ? "취소" : "비밀번호 변경"}
              </button>
            </div>

            {/* 비밀번호 변경 폼 */}
            {isChangingPassword && (
              <div className="mt-6 pt-6 border-t border-[var(--color-border)] space-y-4">
                <form onSubmit={handleChangePassword} noValidate>
                  <div>
                    <label htmlFor="new-password" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                      새 비밀번호
                    </label>
                    <input
                      id="new-password"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder={`최소 ${PASSWORD_MIN_LENGTH}자 이상`}
                      className="w-full h-11 px-4 rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
                      disabled={isSavingPassword}
                    />
                  </div>

                  <div>
                    <label htmlFor="confirm-password" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                      새 비밀번호 확인
                    </label>
                    <input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder="새 비밀번호를 다시 입력하세요"
                      className="w-full h-11 px-4 rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
                      disabled={isSavingPassword}
                    />
                  </div>

                  <div className="flex gap-3 justify-end pt-2">
                    <button
                      type="button"
                      onClick={cancelChangePassword}
                      disabled={isSavingPassword}
                      className={secondaryButtonClass}
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingPassword}
                      className={primaryButtonClass}
                    >
                      {isSavingPassword ? "변경 중..." : "변경"}
                    </button>
                  </div>
                </form>

                <FeedbackMessage feedback={passwordFeedback} />
              </div>
            )}

            {!isChangingPassword && <FeedbackMessage feedback={passwordFeedback} />}
          </section>

          {/* 3. 알림 설정 */}
          <section aria-labelledby="notification-heading" className={cardClass}>
            <h2 id="notification-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
              알림 설정
            </h2>
            <p className="mb-6 text-base text-[var(--color-text-primary)] opacity-70">
              받고 싶은 알림을 선택합니다.
            </p>

            <div className="divide-y divide-[var(--color-border)]">
              {NOTIFICATION_OPTIONS.map((option, index) => (
                <div key={option.key} className={`flex items-center justify-between py-4 ${index === 0 ? 'pt-0' : ''}`}>
                  <div>
                    <p className="text-base font-medium text-[var(--color-text-primary)]">{option.label}</p>
                    <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{option.description}</p>
                  </div>
                  <Toggle
                    checked={notificationPrefs[option.key]}
                    onChange={() => handleNotificationChange(option.key)}
                    label={option.label}
                  />
                </div>
              ))}
            </div>

            <FeedbackMessage feedback={prefsFeedback} />
          </section>

          {/* 4. 화면 설정 */}
          <section aria-labelledby="display-heading" className={cardClass}>
            <h2 id="display-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
              화면 설정
            </h2>
            <p className="text-base text-[var(--color-text-primary)] opacity-70 mb-6">
              일잇다의 화면 테마를 선택합니다.
            </p>
            <ThemeSelector />
          </section>

          {/* 5. 회원 탈퇴 */}
          <section aria-labelledby="delete-account-heading" className={cardClass}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 id="delete-account-heading" className="text-xl font-bold text-[var(--color-text-primary)]">
                  회원 탈퇴
                </h2>
                <p className="text-base text-[var(--color-text-secondary)] mt-1">
                  일잇다 서비스 이용을 종료하고 계정을 삭제합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteAccountConfirm(true)}
                className="h-11 px-5 rounded-lg border border-red-200 bg-white text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap inline-flex items-center gap-1.5 sm:flex-shrink-0"
              >
                <LogOut size={16} aria-hidden="true" />
                회원 탈퇴
              </button>
            </div>
          </section>
        </main>
      </div>

      {/* 회원 탈퇴 확인 다이얼로그 */}
      {showDeleteAccountConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-lg">
            <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-3">회원 탈퇴</h2>
            <p className="text-base text-[var(--color-text-secondary)] mb-6">
              계정을 완전히 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </p>

            {deleteAccountError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-sm text-red-700">{deleteAccountError}</p>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleDeleteAccount();
              }}
              className="space-y-4"
            >
              <div>
                <label htmlFor="delete-password" className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                  현재 비밀번호 확인
                </label>
                <input
                  id="delete-password"
                  type="password"
                  value={deleteAccountPassword}
                  onChange={(e) => setDeleteAccountPassword(e.target.value)}
                  placeholder="현재 비밀번호를 입력하세요"
                  disabled={isDeletingAccount}
                  className="w-full h-11 px-4 rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
                />
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteAccountConfirm(false);
                    setDeleteAccountPassword("");
                    setDeleteAccountError(null);
                  }}
                  disabled={isDeletingAccount}
                  className={secondaryButtonClass}
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isDeletingAccount || !deleteAccountPassword}
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-5 text-sm font-medium text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
                >
                  {isDeletingAccount ? "탈퇴 중..." : "탈퇴"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
