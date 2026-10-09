"use client";

import { useEffect, useState } from "react";
import NotificationCenter from "@/components/common/NotificationCenter";
import ProfileMenu from "@/components/common/ProfileMenu";
import StoreSelector from "@/components/staff/StoreSelector";
import { useStaffShell } from "@/components/staff/StaffShellContext";
import { createClient } from "@/lib/supabase/client";

// 직원 공통 Header: StoreSelector(기본 매장 전환) + NotificationCenter(알림) + ProfileMenu(계정 메뉴)
// 이름/역할/근무 매장은 모두 StaffShell 공통 상태에서 읽는다(별도 매장 state 없음).
export default function StaffHeader() {
  const { userName, roleLabel, isStoresLoading, stores, defaultStoreId, saveStorePreferences } = useStaffShell();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

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
      <div className="flex min-w-0 items-center justify-end gap-2 pl-16 pr-4 sm:pr-6 h-full lg:pl-6">
        {/* 알림 */}
        <div className="flex shrink-0 items-center">
          <NotificationCenter notificationPageUrl="/staff/notifications" />
        </div>

        {/* 기본 매장 선택 */}
        <StoreSelector stores={stores} defaultStoreId={defaultStoreId} isStoresLoading={isStoresLoading} onSetDefaultStore={handleSetDefaultStore} />

        {/* 직원 프로필 */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <ProfileMenu
            userName={userName || " "}
            subtitle={roleLabel}
            roleLabel={roleLabel}
            avatarUrl={avatarUrl}
          />
        </div>
      </div>
    </header>
  );
}
