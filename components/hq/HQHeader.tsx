"use client";

import React from "react";
import NotificationCenter from "@/components/common/NotificationCenter";

interface HQHeaderProps {
  userName: string;
  franchiseName: string;
}

export default function HQHeader({
  userName,
  franchiseName,
}: HQHeaderProps) {
  return (
    <header className="bg-white border-b border-[var(--color-border)] h-16">
      <div className="flex items-center justify-end px-6 h-full">
        {/* Right */}
        <div className="flex items-center gap-6">
          {/* Notification Center */}
          <NotificationCenter />

          {/* Profile */}
          <div className="flex items-center gap-3 pl-6 border-l border-[var(--color-border)]">
            <div className="text-right">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                {userName}
              </p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                {franchiseName} · 본사 관리자
              </p>
            </div>
            <div className="w-8 h-8 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center">
              <span className="text-xs font-bold text-[var(--color-primary)]">
                {userName.charAt(0)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
