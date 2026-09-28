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

export default function HQHeader({ userName, franchiseName, onLogout }: HQHeaderProps) {
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
          .select("avatar_url")
          .eq("id", userData.user.id)
          .maybeSingle<{ avatar_url: string | null }>();

        if (!isCancelled) {
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

  return (
    <header className="bg-white border-b border-[var(--color-border)] h-16">
      <div className="flex items-center justify-end px-6 h-full">
        {/* Right */}
        <div className="flex items-center gap-6">
          {/* Notification Center */}
          <NotificationCenter />

          {/* Profile */}
          <ProfileMenu
            userName={userName}
            subtitle={`${franchiseName} · 본사 관리자`}
            roleLabel="본사 관리자"
            settingsHref="/hq/settings"
            avatarUrl={avatarUrl}
            onLogout={onLogout}
          />
        </div>
      </div>
    </header>
  );
}
