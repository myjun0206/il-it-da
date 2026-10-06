"use client";

import React, { useEffect, useState } from "react";
import NotificationCenter from "@/components/common/NotificationCenter";
import ProfileMenu from "@/components/common/ProfileMenu";
import { createClient } from "@/lib/supabase/client";

interface HQHeaderProps {
  userName: string;
  franchiseName: string;
  /** 각 HQ 페이지가 사이드바에 넘기는 기존 로그아웃 핸들러를 그대로 재사용한다. */
  onLogout: () => void;
}

export default function HQHeader({ userName, franchiseName, onLogout: _onLogout }: HQHeaderProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

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

    window.addEventListener("hqAvatarUpdated", handleAvatarUpdate as EventListener);
    return () => {
      window.removeEventListener("hqAvatarUpdated", handleAvatarUpdate as EventListener);
    };
  }, []);

  return (
    <header className="bg-white border-b border-[var(--color-border)] h-16">
      <div className="flex items-center justify-end px-6 h-full">
        {/* Right */}
        <div className="flex items-center gap-6">
          {/* Notification Center */}
          <NotificationCenter notificationPageUrl="/hq/notifications" />

          {/* Profile */}
          <ProfileMenu
            userName={userName}
            subtitle={`${franchiseName} · 본사 관리자`}
            roleLabel="본사 관리자"
            avatarUrl={avatarUrl}
          />
        </div>
      </div>
    </header>
  );
}
