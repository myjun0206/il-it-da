"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Check } from "lucide-react";

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
      className={`mt-4 flex items-center gap-2 text-base font-medium ${isSuccess ? "text-[var(--color-primary)]" : "text-red-700"}`}
    >
      <Icon size={20} aria-hidden="true" />
      {feedback.message}
    </p>
  );
}

export default function StaffSettingsPage() {
  const router = useRouter();
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

          // avatar_url 조회 (cache busting은 이제 filename에 포함됨)
          const { data: profile } = await supabase
            .from("profiles")
            .select("avatar_url, avatar_updated_at")
            .eq("id", userData.user.id)
            .maybeSingle<{ avatar_url: string | null; avatar_updated_at: string | null }>();

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
          <p className="mb-7 text-base text-[var(--color-text-primary)] opacity-70">내 프로필과 근무 정보를 확인하고 관리합니다.</p>

          {/* === 프로필 섹션 === */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-10 mb-8">
            {/* 프로필 사진 */}
            <div className="flex-shrink-0">
              <ProfileAvatar
                name={userName}
                avatarUrl={avatarPreview || avatarUrl}
                size="xxl"
              />
            </div>

            {/* 프로필 정보 및 액션 */}
            <div className="flex-1 flex flex-col justify-between">
              {/* 프로필 텍스트 정보 */}
              <div className="mb-6">
                <h3 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                  {userName || "등록된 이름 없음"}
                </h3>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center px-3 py-1 rounded-full bg-[var(--color-primary)]/10 text-sm font-medium text-[var(--color-primary)]">
                    {roleLabel || "역할 정보 없음"}
                  </span>
                </div>
                <p className="text-base text-[var(--color-text-primary)] break-all">
                  {email || "등록된 이메일 없음"}
                </p>
              </div>

              {/* 액션 버튼 */}
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
                <div className="flex gap-3 flex-wrap">
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
                <div className="flex gap-3 flex-wrap items-center">
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
                      className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border-2 border-red-300 bg-white px-4 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
                    >
                      사진 삭제
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <FeedbackMessage feedback={avatarFeedback} />

          {/* === 근무 정보 섹션 === */}
          <div className="border-t border-[var(--color-border)] pt-8 mt-8">
            {/* 제목 및 링크 */}
            <div className="flex items-center justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-[var(--color-text-primary)]">근무 매장</h3>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[var(--color-primary)]/10 text-xs font-bold text-[var(--color-primary)]">
                  {isStoresLoading ? "로드중" : `${stores.length}`}
                </span>
              </div>
              <a
                href="/staff/stores"
                className="inline-flex min-h-[44px] items-center justify-center px-4 text-base font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-lg transition-colors"
              >
                근무 매장 관리 →
              </a>
            </div>

            {/* 매장 목록 */}
            {isStoresLoading ? (
              <p className="text-base text-[var(--color-text-secondary)]">불러오는 중...</p>
            ) : stores.length > 0 ? (
              <div className="space-y-3">
                {stores.map((store) => {
                  const isCurrent = selectedStore?.id === store.id;
                  return (
                    <div
                      key={store.id}
                      className={`flex items-center justify-between gap-3 p-4 rounded-lg transition-colors ${
                        isCurrent
                          ? "bg-[var(--color-primary)]/8 border border-[var(--color-primary)]/20"
                          : "bg-[var(--color-bg-default)] border border-transparent"
                      }`}
                    >
                      <p className="text-base font-medium text-[var(--color-text-primary)]">
                        {formatStoreDisplayName(store.name)}
                      </p>
                      {isCurrent && (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-primary)]/10">
                          <Check size={16} className="text-[var(--color-primary)] flex-shrink-0" aria-hidden="true" />
                          <span className="text-xs font-medium text-[var(--color-primary)]">기본 매장</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-base text-[var(--color-text-secondary)]">승인된 근무 매장이 없습니다.</p>
            )}
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
      </div>
    </div>
  );
}
