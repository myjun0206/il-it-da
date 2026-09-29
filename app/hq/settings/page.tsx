"use client";

import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Trash2 } from "lucide-react";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import ThemeSelector from "@/components/common/ThemeSelector";
import ProfileAvatar from "@/components/common/ProfileAvatar";
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
const rowClass =
  "flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-6 border-t border-[var(--color-border)] first:border-t-0 first:pt-0 last:pb-0";
const rowLabelClass = "w-40 shrink-0 text-sm font-medium text-[var(--color-text-secondary)]";
const inputClass =
  "h-11 w-full rounded-lg border-2 border-[var(--color-border)] bg-white px-4 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30";
const secondaryButtonClass =
  "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border-2 border-[var(--color-border)] bg-white px-4 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60";
const primaryButtonClass =
  "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

function FeedbackMessage({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  const isSuccess = feedback.type === "success";
  const Icon = isSuccess ? CheckCircle2 : AlertCircle;
  return (
    <p
      role={isSuccess ? "status" : "alert"}
      className={`mt-3 flex items-center gap-2 text-sm ${isSuccess ? "text-[var(--color-primary)]" : "text-red-700"}`}
    >
      <Icon size={16} aria-hidden="true" />
      {feedback.message}
    </p>
  );
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  isVisible,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  isVisible: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
        {label}
      </label>
      <input
        id={id}
        type={isVisible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="new-password"
        className={inputClass}
      />
    </div>
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
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFeedback, setAvatarFeedback] = useState<Feedback>(null);

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

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      router.push("/");
    }
  };

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
    setIsPasswordVisible(false);
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

  const displayName = account?.name || "본사 관리자";
  const headerFranchiseName = account?.franchiseName || displayName.split(" ")[0] || "본사";

  const readOnlyRows = account
    ? [
        { label: "이메일", value: account.email || "등록된 이메일 없음" },
        { label: "소속 프랜차이즈", value: account.franchiseName || "연결된 프랜차이즈 정보 없음" },
        { label: "역할", value: "본사 관리자" },
      ]
    : [];

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <HQSidebar
        userName={displayName}
        franchiseName={headerFranchiseName}
        onLogout={handleLogout}
        activeMenu="settings"
      />

      <div className="lg:ml-[240px]">
        <HQHeader userName={displayName} franchiseName={headerFranchiseName} onLogout={handleLogout} />

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
              {/* 1. 기본 정보 */}
              <section aria-labelledby="basic-heading" className={cardClass}>
                <h2 id="basic-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-1">
                  기본 정보
                </h2>
                <p className="mb-5 text-sm text-[var(--color-text-secondary)]">서비스에서 사용하는 내 정보를 관리합니다.</p>

                {/* 프로필 사진 */}
                <div className={rowClass}>
                  <span className={rowLabelClass}>프로필 사진</span>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1">
                    <ProfileAvatar
                      name={displayName}
                      avatarUrl={avatarPreview || account.avatarUrl}
                      size="lg"
                      className="w-12 h-12"
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
                    {avatarPreview ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleUploadAvatar}
                          disabled={isUploadingAvatar}
                          className={primaryButtonClass}
                        >
                          {isUploadingAvatar ? "저장 중..." : "저장"}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelAvatarPreview}
                          disabled={isUploadingAvatar}
                          className={secondaryButtonClass}
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isUploadingAvatar}
                          className={secondaryButtonClass}
                        >
                          사진 변경
                        </button>
                        {account.avatarUrl && (
                          <button
                            type="button"
                            onClick={handleDeleteAvatar}
                            disabled={isUploadingAvatar}
                            aria-label="프로필 사진 삭제"
                            className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Trash2 size={18} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <FeedbackMessage feedback={avatarFeedback} />

                {isEditingName ? (
                  <form onSubmit={handleSaveName} className={rowClass}>
                    <label htmlFor="hq-name" className={rowLabelClass}>
                      이름
                    </label>
                    <input
                      id="hq-name"
                      type="text"
                      value={nameDraft}
                      maxLength={NAME_MAX_LENGTH}
                      onChange={(event) => setNameDraft(event.target.value)}
                      autoFocus
                      className={`${inputClass} sm:max-w-sm`}
                    />
                    <div className="flex gap-2 sm:ml-auto">
                      <button type="button" onClick={cancelEditName} disabled={isSavingName} className={secondaryButtonClass}>
                        취소
                      </button>
                      <button type="submit" disabled={isSavingName} className={primaryButtonClass}>
                        {isSavingName ? "저장 중..." : "변경사항 저장"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className={rowClass}>
                    <span className={rowLabelClass}>이름</span>
                    <span className="text-base font-medium text-[var(--color-text-primary)] break-all">
                      {account.name || "등록된 이름 없음"}
                    </span>
                    <button
                      type="button"
                      onClick={startEditName}
                      aria-label="이름 수정"
                      className={`${secondaryButtonClass} sm:ml-auto self-start sm:self-auto`}
                    >
                      수정
                    </button>
                  </div>
                )}
                <FeedbackMessage feedback={nameFeedback} />
              </section>

              {/* 2. 계정 및 권한 정보 (조회 전용) */}
              <section aria-labelledby="account-heading" className={cardClass}>
                <h2 id="account-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-5">
                  계정 및 권한 정보
                </h2>
                <dl>
                  {readOnlyRows.map((row) => (
                    <div key={row.label} className={rowClass}>
                      <dt className={rowLabelClass}>{row.label}</dt>
                      <dd className="text-base font-medium text-[var(--color-text-primary)] break-all">{row.value}</dd>
                      <dd className="text-sm text-[var(--color-text-tertiary)] sm:ml-auto">변경 불가</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm text-[var(--color-text-secondary)] mt-5 pt-5 border-t border-[var(--color-border)]">
                  이메일, 소속 프랜차이즈 및 역할 변경이 필요한 경우 관리자에게 문의해주세요.
                </p>
              </section>

              {/* 3. 보안 */}
              <section aria-labelledby="security-heading" className={cardClass}>
                <h2 id="security-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-5">
                  보안
                </h2>

                {!account.hasPasswordLogin ? (
                  <div className={rowClass}>
                    <span className={rowLabelClass}>비밀번호</span>
                    <span className="text-sm text-[var(--color-text-secondary)]">
                      소셜 로그인 계정은 이 화면에서 비밀번호를 변경할 수 없습니다.
                    </span>
                  </div>
                ) : isChangingPassword ? (
                  <form onSubmit={handleChangePassword} noValidate>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <PasswordInput
                        id="new-password"
                        label="새 비밀번호"
                        value={newPassword}
                        onChange={setNewPassword}
                        isVisible={isPasswordVisible}
                      />
                      <PasswordInput
                        id="confirm-password"
                        label="새 비밀번호 확인"
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                        isVisible={isPasswordVisible}
                      />
                    </div>
                    <p className="mt-2 text-sm text-[var(--color-text-tertiary)]">{PASSWORD_MIN_LENGTH}자 이상 입력해주세요.</p>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setIsPasswordVisible((visible) => !visible)}
                        aria-pressed={isPasswordVisible}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                      >
                        {isPasswordVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                        {isPasswordVisible ? "비밀번호 숨기기" : "비밀번호 표시"}
                      </button>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={cancelChangePassword}
                          disabled={isSavingPassword}
                          className={secondaryButtonClass}
                        >
                          취소
                        </button>
                        <button type="submit" disabled={isSavingPassword} className={primaryButtonClass}>
                          {isSavingPassword ? "변경 중..." : "비밀번호 변경"}
                        </button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <div className={rowClass}>
                    <span className={rowLabelClass}>비밀번호</span>
                    <span className="text-base font-medium tracking-widest text-[var(--color-text-primary)]" aria-label="비밀번호 숨김">
                      ••••••••••••
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordFeedback(null);
                        setIsChangingPassword(true);
                      }}
                      className={`${secondaryButtonClass} sm:ml-auto self-start sm:self-auto`}
                    >
                      비밀번호 변경
                    </button>
                  </div>
                )}
                <FeedbackMessage feedback={passwordFeedback} />
              </section>
            </>
          ) : null}

          {/* 4. 화면 설정 */}
          <section aria-labelledby="display-heading" className={cardClass}>
            <h2 id="display-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
              화면 설정
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">일잇다 화면의 테마를 설정합니다.</p>
            <ThemeSelector />
          </section>
        </main>
      </div>
    </div>
  );
}
