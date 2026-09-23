"use client";

import React, { useLayoutEffect, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import { Button } from "@/components/common/Button";
import ThemeSelector from "@/components/common/ThemeSelector";

interface UserInfo {
  name: string;
  email: string;
  role: string;
}

interface StoreInfo {
  brand: string;
  storeName: string;
  address?: string;
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
  address?: string;
}

// 토글 스위치 컴포넌트
function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]"
      }`}
      aria-label="Toggle notification"
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [userInfo, setUserInfo] = useState<UserInfo>({
    name: "",
    email: "",
    role: "점주",
  });
  const [storeInfo, setStoreInfo] = useState<StoreInfo>({
    brand: "",
    storeName: "",
    address: "",
  });
  const [notificationPrefs, setNotificationPrefs] =
    useState<NotificationPreferences>({
      staffJoinRequest: true,
      hqNotices: true,
      manualUpdates: true,
    });
  const [savedMessage, setSavedMessage] = useState("");

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

        // 사용자 정보 설정
        const name = data.session.user.user_metadata?.name || "점주";
        const email = data.session.user.email || "";

        setUserInfo({
          name,
          email,
          role: "점주",
        });

        // localStorage에서 알림 설정 로드
        const savedPrefs = localStorage.getItem("notificationPreferences");
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

  // 매장 정보 로드
  useEffect(() => {
    const loadStoreInfo = async () => {
      if (!isReady) return;

      try {
        setIsLoading(true);
        const response = await fetch("/api/signup/store-membership");
        const result = await response.json();

        if (response.ok && result.success && Array.isArray(result.data)) {
          // 현재 선택된 매장 또는 첫 번째 approved 매장
          const storedStoreId = sessionStorage.getItem("selectedStoreId");

          const approved = (result.data as StoreMembership[]).filter(
            (m: StoreMembership) => m.status === "approved" && m.role === "owner"
          );

          if (approved.length > 0) {
            const selectedStore = approved.find(
              (s: StoreMembership) => s.storeId === storedStoreId
            ) || approved[0];

            // 브랜드명 추출 (store_name에서 점 이름 제거)
            const brandName = selectedStore.storeName.split(" ")[0] || "";

            setStoreInfo({
              brand: brandName,
              storeName: selectedStore.storeName,
              address: selectedStore.address || "주소 정보 없음",
            });
          }
        }
      } catch (e) {
        console.error("Failed to load store info:", e);
        setError("매장 정보를 불러올 수 없습니다.");
      } finally {
        setIsLoading(false);
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

  // 알림 설정 저장
  const handleNotificationChange = (key: keyof NotificationPreferences) => {
    const updated = {
      ...notificationPrefs,
      [key]: !notificationPrefs[key],
    };
    setNotificationPrefs(updated);
    localStorage.setItem("notificationPreferences", JSON.stringify(updated));

    // 임시 저장 메시지 표시
    setSavedMessage("저장되었습니다.");
    setTimeout(() => setSavedMessage(""), 2000);
  };

  if (!isReady) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex">
      {/* Sidebar */}
      <OwnerSidebar activeMenu="settings" onLogout={handleLogout} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:ml-[240px]">
        {/* Header */}
        <OwnerHeader userName={userInfo.name} storeName={storeInfo.storeName} />

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-6 lg:p-8 max-w-4xl mx-auto">
            {/* 페이지 제목 */}
            <div className="mb-8">
              <h1 className="text-3xl lg:text-4xl font-bold text-[var(--color-text-primary)] mb-2">
                환경설정
              </h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                계정과 매장 이용 환경을 관리하세요.
              </p>
            </div>

            {/* 에러 메시지 */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* 내 정보 카드 */}
            <div className="bg-white border border-[var(--color-border)] rounded-lg p-6 mb-6">
              <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-6">
                내 정보
              </h2>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                    이름
                  </label>
                  <p className="text-base text-[var(--color-text-primary)] font-medium">
                    {userInfo.name}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                    이메일
                  </label>
                  <p className="text-base text-[var(--color-text-primary)]">
                    {userInfo.email}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                    역할
                  </label>
                  <p className="text-base text-[var(--color-text-primary)]">
                    {userInfo.role}
                  </p>
                </div>
              </div>

              <p className="text-xs text-[var(--color-text-secondary)] mt-6 pt-6 border-t border-[var(--color-border)]">
                이메일과 역할은 변경할 수 없습니다. 계정 정보 변경이 필요한 경우 고객
                지원팀에 문의해주세요.
              </p>
            </div>

            {/* 매장 정보 카드 */}
            <div className="bg-white border border-[var(--color-border)] rounded-lg p-6 mb-6">
              <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-6">
                매장 정보
              </h2>

              {isLoading ? (
                <div className="text-center py-8 text-[var(--color-text-secondary)]">
                  로딩 중...
                </div>
              ) : (
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                      브랜드
                    </label>
                    <p className="text-base text-[var(--color-text-primary)] font-medium">
                      {storeInfo.brand}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                      현재 매장
                    </label>
                    <p className="text-base text-[var(--color-text-primary)] font-medium">
                      {storeInfo.storeName}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                      매장 주소
                    </label>
                    <p className="text-base text-[var(--color-text-primary)]">
                      {storeInfo.address}
                    </p>
                  </div>
                </div>
              )}

              <p className="text-xs text-[var(--color-text-secondary)] mt-6 pt-6 border-t border-[var(--color-border)]">
                매장 정보는 변경할 수 없습니다. 새로운 매장 추가가 필요한 경우 가입
                페이지에서 신청해주세요.
              </p>
            </div>

            {/* 알림 설정 카드 */}
            <div className="bg-white border border-[var(--color-border)] rounded-lg p-6 mb-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
                  알림 설정
                </h2>
                {savedMessage && (
                  <div className="flex items-center gap-2 text-xs text-[var(--color-primary)]">
                    <Check size={14} />
                    {savedMessage}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {/* 직원 가입 요청 */}
                <div className="flex items-start justify-between p-4 rounded-lg bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-default)] transition-colors">
                  <div className="flex-1 pr-4">
                    <p className="text-base font-medium text-[var(--color-text-primary)]">
                      직원 가입 요청
                    </p>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                      새로운 직원의 매장 가입 요청 알림
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <Toggle
                      checked={notificationPrefs.staffJoinRequest}
                      onChange={() => handleNotificationChange("staffJoinRequest")}
                    />
                  </div>
                </div>

                {/* 본사 공지사항 */}
                <div className="flex items-start justify-between p-4 rounded-lg bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-default)] transition-colors">
                  <div className="flex-1 pr-4">
                    <p className="text-base font-medium text-[var(--color-text-primary)]">
                      본사 공지사항
                    </p>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                      새로운 본사 공지를 알려드립니다.
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <Toggle
                      checked={notificationPrefs.hqNotices}
                      onChange={() => handleNotificationChange("hqNotices")}
                    />
                  </div>
                </div>

                {/* 공통 매뉴얼 업데이트 */}
                <div className="flex items-start justify-between p-4 rounded-lg bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-default)] transition-colors">
                  <div className="flex-1 pr-4">
                    <p className="text-base font-medium text-[var(--color-text-primary)]">
                      공통 매뉴얼 업데이트
                    </p>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                      공통 매뉴얼 변경사항을 알려드립니다.
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <Toggle
                      checked={notificationPrefs.manualUpdates}
                      onChange={() => handleNotificationChange("manualUpdates")}
                    />
                  </div>
                </div>
              </div>

              <p className="text-xs text-[var(--color-text-secondary)] mt-6 pt-6 border-t border-[var(--color-border)]">
                알림 설정은 이 기기에만 적용됩니다. 다른 기기에서는 별도로 설정할
                수 있습니다.
              </p>
            </div>

            {/* 화면 설정 카드 */}
            <div className="bg-white border border-[var(--color-border)] rounded-lg p-6 mb-6">
              <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-6">
                화면 설정
              </h2>
              <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                일잇다 화면의 테마를 설정합니다.
              </p>
              <ThemeSelector />
            </div>

            {/* 보안 카드 */}
            <div className="bg-white border border-[var(--color-border)] rounded-lg p-6 mb-6">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
                    보안
                  </h2>
                  <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                    현재 기기에서 일잇다 계정에서 로그아웃합니다.
                  </p>
                  <Button
                    onClick={handleLogout}
                    className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200"
                  >
                    로그아웃
                  </Button>
                </div>
              </div>
            </div>

            {/* 하단 여백 */}
            <div className="h-12" />
          </div>
        </main>
      </div>
    </div>
  );
}
