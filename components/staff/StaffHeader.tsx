"use client";

import React from "react";
import { Bell } from "lucide-react";

interface StaffHeaderProps {
  userName: string;
  storeName: string;
}

export default function StaffHeader({
  userName,
  storeName,
}: StaffHeaderProps) {
  return (
    <header className="sticky top-0 z-50 bg-white border-b border-[var(--color-border)] h-16 shrink-0">
      <div className="flex items-center justify-end px-6 h-full">
        {/* Right */}
        <div className="flex items-center gap-6">
          {/* Notification */}
          <button className="relative p-2 rounded-lg hover:bg-[var(--color-bg-surface)] transition-colors">
            <Bell size={20} className="text-[var(--color-text-secondary)]" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          </button>

          {/* Profile */}
          <div className="flex items-center gap-3 pl-6 border-l border-[var(--color-border)]">
            <div className="text-right">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                {userName}
              </p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                {storeName} · 직원
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
