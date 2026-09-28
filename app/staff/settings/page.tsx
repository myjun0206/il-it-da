"use client";

import { useEffect, useState, useRef } from "react";
import { AlertCircle, CheckCircle2, Trash2 } from "lucide-react";

import ThemeSelector from "@/components/common/ThemeSelector";
import ProfileAvatar from "@/components/common/ProfileAvatar";
import { useStaffShell } from "@/components/staff/StaffShellContext";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";
import { createClient } from "@/lib/supabase/client";
import { uploadProfileAvatarClient, deleteProfileAvatarClient } from "@/lib/supabase/storage-profile-avatar";

// 직원 환경설정 (최소 구성): 계정 정보 확인 · 화면 테마 · 로그아웃. 점주/HQ 설정 화면과 같은 카드·행 스타일.
const cardClass = "bg-white border border-[var(--color-border)] rounded-xl p-6 mb-6 shadow-sm";
const rowClass =
  "flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-6 border-t border-[var(--color-border)] first:border-t-0 first:pt-0 last:pb-0";
const rowLabelClass = "w-40 shrink-0 text-sm font-medium text-[var(--color-text-secondary)]";
const secondaryButtonClass =
  "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border-2 border-[var(--color-border)] bg-white px-4 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60";
const primaryButtonClass =
  "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

type Feedback = { type: "success" | "error"; message: string } | null;

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

export default function StaffSettingsPage() {
  const { userName, roleLabel, selectedStore, stores, isStoresLoading, logout } = useStaffShell();
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFeedback, setAvatarFeedback] = useState<Feedback>(null);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();

        if (!isCancelled && userData.user) {
          setUserId(userData.user.id);
          setEmail(userData.user.email ?? "");

          // avatar_url 조회
          const { data: profile } = await supabase
            .from("profiles")
            .select("avatar_url")
            .eq("id", userData.user.id)
            .maybeSingle<{ avatar_url: string | null }>();

          if (!isCancelled) {
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

  const handleAvatarFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setAvatarPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
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
        setAvatarUrl(result.avatarUrl);
        setAvatarPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setAvatarFeedback({ type: "success", message: "프로필 사진이 저장되었습니다." });
        void createClient().auth.refreshSession();
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
        void createClient().auth.refreshSession();
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

  const rows = [
    { label: "이름", value: userName || "등록된 이름 없음" },
    { label: "이메일", value: email || "등록된 이메일 없음" },
    {
      label: "현재 근무 매장",
      value: isStoresLoading ? "불러오는 중..." : selectedStore ? formatStoreDisplayName(selectedStore.name) : "승인된 근무 매장 없음",
    },
    { label: "근무 매장 수", value: isStoresLoading ? "불러오는 중..." : `${stores.length}곳` },
    { label: "역할", value: roleLabel || "-" },
  ];

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">환경설정</h1>
          <p className="text-base text-[var(--color-text-secondary)]">계정 정보와 화면 설정을 확인할 수 있습니다.</p>
        </div>

        <section aria-labelledby="account-heading" className={cardClass}>
          <h2 id="account-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-1">
            계정 정보
          </h2>
          <p className="mb-5 text-sm text-[var(--color-text-secondary)]">서비스에서 사용하는 내 정보입니다.</p>

          {/* 프로필 사진 */}
          <div className={rowClass}>
            <span className={rowLabelClass}>프로필 사진</span>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1">
              <ProfileAvatar
                name={userName}
                avatarUrl={avatarPreview || avatarUrl}
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
                    onClick={() => {
                      setAvatarPreview(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
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
                  {avatarUrl && (
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

          <dl>
            {rows.map((row) => (
              <div key={row.label} className={rowClass}>
                <dt className={rowLabelClass}>{row.label}</dt>
                <dd className="text-base font-medium text-[var(--color-text-primary)] break-all">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-[var(--color-text-secondary)] mt-5 pt-5 border-t border-[var(--color-border)]">
            현재 근무 매장은 AI 챗봇 또는 지점 매뉴얼의 매장 선택에서 바꿀 수 있고, 근무 매장 추가는 근무 매장 메뉴에서 신청할 수 있습니다.
          </p>
        </section>

        <section aria-labelledby="display-heading" className={cardClass}>
          <h2 id="display-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-1">
            화면 설정
          </h2>
          <p className="mb-5 text-sm text-[var(--color-text-secondary)]">
            일잇다 화면의 테마를 설정합니다. 시스템 설정은 기기의 라이트/다크 설정을 따릅니다.
          </p>
          <ThemeSelector />
        </section>

        <section aria-labelledby="security-heading" className={cardClass}>
          <h2 id="security-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-1">
            보안
          </h2>
          <p className="mb-5 text-sm text-[var(--color-text-secondary)]">현재 로그인된 계정과 세션을 관리합니다.</p>
          <div className={rowClass}>
            <span className={rowLabelClass}>로그인 계정</span>
            <span className="text-base font-medium text-[var(--color-text-primary)] break-all">{email || "등록된 이메일 없음"}</span>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center self-start rounded-lg border-2 border-red-200 bg-transparent px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 sm:ml-auto sm:self-auto"
            >
              로그아웃
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
