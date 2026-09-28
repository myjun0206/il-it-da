"use client";

import React from "react";
import NotificationCenter from "@/components/common/NotificationCenter";
import ProfileMenu from "@/components/common/ProfileMenu";

interface OwnerHeaderProps {
  userName: string;
  storeName: string;
  /** 각 Owner 페이지가 사이드바에 넘기는 기존 로그아웃 핸들러를 그대로 재사용한다. */
  onLogout: () => void;
}

export default function OwnerHeader({
  userName,
  storeName,
  onLogout,
}: OwnerHeaderProps) {
  return (
    <header className="sticky top-0 z-50 bg-white border-b border-[var(--color-border)] h-16 shrink-0">
      <div className="flex items-center justify-end px-6 h-full">
        {/* Right */}
        <div className="flex items-center gap-6">
          {/* Notification Center */}
          <NotificationCenter />

          {/* Profile */}
          <ProfileMenu
            userName={userName}
            subtitle={storeName ? `${storeName} · 점주` : "점주"}
            roleLabel="점주"
            settingsHref="/boss/settings"
            onLogout={onLogout}
          />
        </div>
      </div>
    </header>
  );
}
