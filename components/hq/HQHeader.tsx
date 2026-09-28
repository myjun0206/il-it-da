"use client";

import React from "react";
import NotificationCenter from "@/components/common/NotificationCenter";
import ProfileMenu from "@/components/common/ProfileMenu";

interface HQHeaderProps {
  userName: string;
  franchiseName: string;
  /** 각 HQ 페이지가 사이드바에 넘기는 기존 로그아웃 핸들러를 그대로 재사용한다. */
  onLogout: () => void;
}

export default function HQHeader({
  userName,
  franchiseName,
  onLogout,
}: HQHeaderProps) {
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
            onLogout={onLogout}
          />
        </div>
      </div>
    </header>
  );
}
