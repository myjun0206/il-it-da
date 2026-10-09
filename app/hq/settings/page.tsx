"use client";

import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Camera, Trash2, LogOut } from "lucide-react";
import ThemeSelector from "@/components/common/ThemeSelector";
import ProfileAvatar from "@/components/common/ProfileAvatar";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { createClient } from "@/lib/supabase/client";
import { uploadProfileAvatarClient, deleteProfileAvatarClient } from "@/lib/supabase/storage-profile-avatar";

interface AccountInfo {
  name: string;
  email: string;
  franchiseName: string | null;
  avatarUrl: string | null;
  userId: string;
  // 이메일/비밀번호 로그인 수단이 있는 계정만 비밀번호를 변경할 수 있다.
  hasPasswordLogin: boolean;
}

type Feedback = { type: "success" | "error"; message: string } | null;

// 회원가입과 같은 비밀번호 정책(8자 이상)을 사용한다.
const PASSWORD_MIN_LENGTH = 8;
const NAME_MAX_LENGTH = 50;

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

export default function HqSettingsPage() {
  const router = useRouter();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameFeedback, setNameFeedback] = useState<Feedback>(null);

  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);
  
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFeedback, setAvatarFeedback] = useState<Feedback>(null);

  // 회원 탈퇴 상태
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deleteAccountPassword, setDeleteAccountPassword] = useState("");
  const [isAuthenticatingDelete, setIsAuthenticatingDelete] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  useEffect(() => {
    const loadAccount = async () => {
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        const user = userData.user;
        if (!user) {
          router.push("/");
          return;
        }

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

        const providers = [
          ...(user.identities ?? []).map((identity) => identity.provider),
          ...((user.app_metadata?.providers as string[] | undefined) ?? []),
        ];

        let finalAvatarUrl: string | null = null;
        if (profile?.avatar_url) {
          // cache busting은 이제 filename에 포함됨 (avatar-{timestamp}.jpg)
          // 따라서 query string 불필요, 원본 URL만 사용
          finalAvatarUrl = profile.avatar_url;
        }

        setAccount({
          name: profile?.full_name || user.user_metadata?.name || "",
          email: user.email ?? "",
          franchiseName,
          avatarUrl: finalAvatarUrl,
          userId: user.id,
          hasPasswordLogin: providers.includes("email"),
        });
      } catch (e) {
        console.error("Failed to load HQ account:", e);
        setError("계정 정보를 불러올 수 없습니다.");
      }
    };

    void loadAccount();
  }, [router]);

  const startEditName = () => {
    setNameDraft(account?.name ?? "");
    setNameFeedback(null);
    setIsEditingName(true);
  };

  const cancelEditName = () => {
    setIsEditingName(false);
    setNameDraft("");
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
      const response = await fetch("/api/hq/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = (await response.json()) as { name?: string; error?: string };
      if (!response.ok || !result.name) {
        throw new Error(result.error || "이름을 저장하지 못했습니다.");
      }

      const savedName = result.name;
      setAccount((current) => (current ? { ...current, name: savedName } : current));
      setIsEditingName(false);
      setNameFeedback({ type: "success", message: "이름이 변경되었습니다." });
      // 헤더/사이드바가 읽는 세션의 user_metadata도 새 이름으로 갱신한다.
      void createClient().auth.refreshSession();
    } catch (e) {
      setNameFeedback({ type: "error", message: e instanceof Error ? e.message : "이름을 저장하지 못했습니다." });
    } finally {
      setIsSavingName(false);
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

  const handleAvatarFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 미리보기
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
    if (!fileInputRef.current?.files?.[0] || !account) return;
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
        setAccount((prev) =>
          prev ? { ...prev, avatarUrl: result.avatarUrl || null } : prev
        );
        setAvatarPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setAvatarFeedback({ type: "success", message: "프로필 사진이 저장되었습니다." });

        // Header에 avatar 변경 이벤트 전송
        window.dispatchEvent(
          new CustomEvent("hqAvatarUpdated", {
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
    if (!account || !account.avatarUrl) return;
    if (!window.confirm("프로필 사진을 삭제할까요?")) return;

    setAvatarFeedback(null);

    try {
      const result = await deleteProfileAvatarClient();

      if (result.success) {
        setAccount((prev) =>
          prev ? { ...prev, avatarUrl: null } : prev
        );
        setAvatarPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setAvatarFeedback({ type: "success", message: "프로필 사진이 삭제되었습니다." });

        // Header에 avatar 변경 이벤트 전송
        window.dispatchEvent(
          new CustomEvent("hqAvatarUpdated", {
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

  const handleDeleteAccount = async () => {
    if (!account) return;
    if (isDeletingAccount) return;

    setIsDeletingAccount(true);
    setDeleteAccountError(null);

    try {
      const response = await fetch("/api/hq/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deleteAccountPassword }),
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

  const readOnlyRows = account
    ? [
        { label: "이메일", value: account.email || "등록된 이메일 없음" },
        { label: "소속 프랜차이즈", value: account.franchiseName || "연결된 프랜차이즈 정보 없음" },
        { label: "역할", value: "본사 관리자" },
      ]
    : [];

  return (
    <main className="p-6 lg:p-8 max-w-7xl mx-auto">
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

          {!account && !error ? (
            <div className={`${cardClass} text-center`}>
              <p className="py-4 text-base text-[var(--color-text-secondary)]" role="status">
                불러오는 중...
              </p>
            </div>
          ) : account ? (
            <>
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
                      name={account.name}
                      avatarUrl={avatarPreview || account.avatarUrl}
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
                        {account.name || "등록된 이름 없음"}
                      </h3>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-xs font-medium text-[var(--color-primary)]">
                        본사 관리자
                      </span>
                    </div>

                    {/* 이메일 */}
                    <div>
                      <p className="text-xs text-[var(--color-text-tertiary)] mb-1">이메일</p>
                      <p className="text-sm font-medium text-[var(--color-text-primary)] break-all">
                        {account.email || "등록된 이메일 없음"}
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
                  가입 시 등록한 정보입니다. 비밀번호만 변경할 수 있습니다.
                </p>

                {/* 가입 정보 필드 */}
                <div className="space-y-4 mb-6">
                  {/* 이름 - 수정 가능 */}
                  {isEditingName ? (
                    <form onSubmit={handleSaveName} className="flex flex-col gap-2">
                      <label htmlFor="hq-name" className="block text-sm font-medium text-[var(--color-text-secondary)]">
                        이름
                      </label>
                      <div className="flex gap-3">
                        <input
                          id="hq-name"
                          type="text"
                          value={nameDraft}
                          maxLength={NAME_MAX_LENGTH}
                          onChange={(event) => setNameDraft(event.target.value)}
                          autoFocus
                          className="h-11 flex-1 rounded-lg border border-[var(--color-border)] bg-white px-4 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                        />
                        <button
                          type="button"
                          onClick={cancelEditName}
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
                        value={account.name || "등록된 이름 없음"}
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
                      value={account.email || "등록된 이메일 없음"}
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
                      value={account.franchiseName || "연결된 프랜차이즈 정보 없음"}
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
                      value="본사 관리자"
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

              {/* 3. 회원 탈퇴 */}
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
                    onClick={() => {
                      setShowDeleteAccountConfirm(true);
                      setDeleteAccountPassword("");
                      setDeleteAccountError(null);
                    }}
                    className="h-11 px-5 rounded-lg border border-red-200 bg-white text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap inline-flex items-center gap-1.5 sm:flex-shrink-0"
                  >
                    <LogOut size={16} aria-hidden="true" />
                    회원 탈퇴
                  </button>
                </div>
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
            </>
          ) : null}

          {/* 회원 탈퇴 확인 다이얼로그 */}
          <ConfirmDialog
            isOpen={showDeleteAccountConfirm}
            title="회원 탈퇴"
            description="계정을 완전히 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다."
            confirmText="탈퇴"
            cancelText="취소"
            isDangerous
            isLoading={isDeletingAccount}
            onConfirm={() => void handleDeleteAccount()}
            onCancel={() => {
              setShowDeleteAccountConfirm(false);
              setDeleteAccountPassword("");
              setDeleteAccountError(null);
            }}
          />
        </main>
      );
    }
