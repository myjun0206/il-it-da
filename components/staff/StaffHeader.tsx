"use client";

import { useEffect, useState } from "react";
import NotificationCenter from "@/components/common/NotificationCenter";
import ProfileMenu from "@/components/common/ProfileMenu";
import { useStaffShell } from "@/components/staff/StaffShellContext";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";
import { createClient } from "@/lib/supabase/client";

// 직원 공통 Header: HQ/Owner와 같은 알림(NotificationCenter)과 계정 메뉴(ProfileMenu)를 쓴다.
// 이름/역할/현재 근무 매장은 모두 StaffShell 공통 상태에서 읽는다(별도 매장 state 없음).
export default function StaffHeader() {
  const { userName, roleLabel, selectedStore, isStoresLoading, logout, stores, defaultStoreId, saveStorePreferences } = useStaffShell();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const storeLabel = selectedStore ? formatStoreDisplayName(selectedStore.name) : isStoresLoading ? "" : "근무 매장 없음";
  const subtitle = [storeLabel, roleLabel].filter(Boolean).join(" · ");

  const handleSetDefaultStore = async (storeId: string) => {
    await saveStorePreferences({ defaultStoreId: storeId, order: stores.map((s) => s.id) });
  };

  useEffect(() => {
    let isCancelled = false;
    const supabase = createClient();

    void (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (isCancelled || !userData.user) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("avatar_url, avatar_updated_at")
          .eq("id", userData.user.id)
          .maybeSingle<{ avatar_url: string | null; avatar_updated_at: string | null }>();

        if (!isCancelled) {
          // cache busting은 이제 filename에 포함됨 (avatar-{timestamp}.jpg)
          // 따라서 query string 불필요, 원본 URL만 사용
          setAvatarUrl(profile?.avatar_url || null);
        }
      } catch (e) {
        console.error("Failed to load avatar:", e);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Settings에서 avatar 변경 이벤트 수신
  useEffect(() => {
    const handleAvatarUpdate = (event: CustomEvent) => {
      const newAvatarUrl = event.detail?.avatarUrl;
      if (newAvatarUrl && typeof newAvatarUrl === "string") {
        setAvatarUrl(newAvatarUrl);
      } else if (newAvatarUrl === null) {
        setAvatarUrl(null);
      }
    };

    window.addEventListener("staffAvatarUpdated", handleAvatarUpdate as EventListener);
    return () => {
      window.removeEventListener("staffAvatarUpdated", handleAvatarUpdate as EventListener);
    };
  }, []);

  return (
    <header className="sticky top-0 z-20 bg-white border-b border-[var(--color-border)] h-16 shrink-0">
      <div className="flex items-center justify-end gap-3 sm:gap-6 pl-16 pr-4 sm:pr-6 h-full lg:pl-6">
        <NotificationCenter notificationPageUrl="/staff/notifications" />
        <ProfileMenu
          userName={userName || " "}
          subtitle={subtitle}
          roleLabel={roleLabel}
          settingsHref="/staff/settings"
          avatarUrl={avatarUrl}
          stores={stores}
          isStoresLoading={isStoresLoading}
          defaultStoreId={defaultStoreId}
          onSetDefaultStore={handleSetDefaultStore}
          onLogout={() => void logout()}
        />
      </div>
    </header>
  );
}
