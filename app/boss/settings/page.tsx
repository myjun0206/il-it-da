"use client";

import React, { useLayoutEffect, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import ThemeSelector from "@/components/common/ThemeSelector";
import ProfileAvatar from "@/components/common/ProfileAvatar";
import OwnerPasswordChangeForm from "@/components/owner/OwnerPasswordChangeForm";
import OwnerAccountDeletionForm from "@/components/owner/OwnerAccountDeletionForm";
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

type Feedback = { type: "success" | "error"; message: string } | null;

const NAME_MAX_LENGTH = 50;
// 기존 구현과 같은 키: 알림 설정은 이 기기(브라우저)에만 저장된다.
const NOTIFICATION_PREFS_KEY = "notificationPreferences";

const NOTIFICATION_OPTIONS: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  { key: "staffJoinRequest", label: "직원 가입 승인 요청", description: "새로운 직원의 매장 가입 요청 알림" },
  { key: "hqNotices", label: "본사 공지사항", description: "새로운 본사 공지를 알려드립니다." },
  { key: "manualUpdates", label: "매뉴얼 관련 알림", description: "공통 매뉴얼 변경사항을 알려드립니다." },
];

const cardClass = "bg-white border border-[var(--color-border)] rounded-xl p-6 mb-6 shadow-sm";
const rowClass =
  "flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-6 border-t border-[var(--color-border)] first:border-t-0 first:pt-0 last:pb-0";
// 이름 행 아래에 이어지는 조회 전용 행: 항상 위쪽 구분선을 둔다.
const followingRowClass =
  "flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-6 border-t border-[var(--color-border)] last:pb-0";
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

  if (!isReady) {
    return null;
  }

  const readOnlyRows = [
    { label: "이메일", value: userInfo.email || "등록된 이메일 없음" },
    { label: "소속 프랜차이즈", value: userInfo.franchiseName || "연결된 프랜차이즈 정보 없음" },
    { label: "현재 매장", value: isLoadingStore ? "불러오는 중..." : storeName || "승인된 매장 없음" },
    { label: "역할", value: "점주" },
  ];

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex">
      {/* Sidebar */}
      <OwnerSidebar activeMenu="settings" onLogout={handleLogout} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:ml-[240px]">
        {/* Header */}
        <OwnerHeader userName={userInfo.name} storeName={storeName} onLogout={handleLogout} />

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-6 lg:p-8 max-w-7xl mx-auto">
            {/* 페이지 제목 */}
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">환경설정</h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                계정 정보와 서비스 이용 설정을 관리할 수 있습니다.
              </p>
            </div>

            {/* 에러 메시지 */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3" role="alert">
                <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* 1. 계정 정보 */}
            <section aria-labelledby="account-heading" className={cardClass}>
              <h2 id="account-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-1">
                계정 정보
              </h2>
              <p className="mb-5 text-sm text-[var(--color-text-secondary)]">서비스에서 사용하는 내 정보를 확인하고 관리합니다.</p>

              <div>
                {/* 프로필 사진 */}
                <div className={rowClass}>
                  <span className={rowLabelClass}>프로필 사진</span>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1">
                    <ProfileAvatar
                      name={userInfo.name}
                      avatarUrl={avatarPreview || userInfo.avatarUrl}
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
                        {userInfo.avatarUrl && (
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
                    <label htmlFor="owner-name" className={rowLabelClass}>
                      이름
                    </label>
                    <input
                      id="owner-name"
                      type="text"
                      value={nameDraft}
                      maxLength={NAME_MAX_LENGTH}
                      onChange={(event) => setNameDraft(event.target.value)}
                      autoFocus
                      className={`${inputClass} sm:max-w-sm`}
                    />
                    <div className="flex gap-2 sm:ml-auto">
                      <button
                        type="button"
                        onClick={() => setIsEditingName(false)}
                        disabled={isSavingName}
                        className={secondaryButtonClass}
                      >
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
                      {userInfo.name || "등록된 이름 없음"}
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
                <dl>
                  {readOnlyRows.map((row) => (
                    <div key={row.label} className={followingRowClass}>
                      <dt className={rowLabelClass}>{row.label}</dt>
                      <dd className="text-base font-medium text-[var(--color-text-primary)] break-all">{row.value}</dd>
                      <dd className="text-sm text-[var(--color-text-tertiary)] sm:ml-auto">변경 불가</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <FeedbackMessage feedback={nameFeedback} />

              <p className="text-sm text-[var(--color-text-secondary)] mt-5 pt-5 border-t border-[var(--color-border)]">
                이메일, 소속 프랜차이즈, 매장 및 역할 변경이 필요한 경우 본사에 문의해주세요.
              </p>
            </section>

            <OwnerPasswordChangeForm />

            {/* 2. 알림 설정 */}
            <section aria-labelledby="notification-heading" className={cardClass}>
              <h2 id="notification-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-1">
                알림 설정
              </h2>
              <p className="mb-5 text-sm text-[var(--color-text-secondary)]">받고 싶은 알림을 선택합니다.</p>

              <div>
                {NOTIFICATION_OPTIONS.map((option) => (
                  <div key={option.key} className={`${rowClass} sm:justify-between`}>
                    <div className="min-w-0">
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

              <p className="text-sm text-[var(--color-text-secondary)] mt-5 pt-5 border-t border-[var(--color-border)]">
                알림 설정은 이 기기(브라우저)에만 저장되며, 계정 단위 알림 수신 설정에는 아직 반영되지 않습니다.
              </p>
            </section>

            {/* 3. 화면 설정 */}
            <section aria-labelledby="display-heading" className={cardClass}>
              <h2 id="display-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-1">
                화면 설정
              </h2>
              <p className="mb-5 text-sm text-[var(--color-text-secondary)]">
                일잇다 화면의 테마를 설정합니다. 시스템 설정은 기기의 라이트/다크 설정을 따릅니다.
              </p>
              <ThemeSelector />
            </section>

            {/* 4. 보안 */}
            <section aria-labelledby="security-heading" className={cardClass}>
              <h2 id="security-heading" className="text-xl font-bold text-[var(--color-text-primary)] mb-1">
                보안
              </h2>
              <p className="mb-5 text-sm text-[var(--color-text-secondary)]">현재 로그인된 계정과 세션을 관리합니다.</p>
              <div className={rowClass}>
                <span className={rowLabelClass}>로그인 계정</span>
                <span className="text-base font-medium text-[var(--color-text-primary)] break-all">
                  {userInfo.email || "등록된 이메일 없음"}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex min-h-[44px] shrink-0 items-center justify-center self-start rounded-lg border-2 border-red-200 bg-transparent px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 sm:ml-auto sm:self-auto"
                >
                  로그아웃
                </button>
              </div>
              <OwnerAccountDeletionForm />
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
