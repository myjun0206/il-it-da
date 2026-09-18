"use client";

import React from "react";
import Link from "next/link";
import { Bell, User, LogOut } from "lucide-react";

export default function HQHeader() {
  const [showNotifications, setShowNotifications] = React.useState(false);
  const [showProfile, setShowProfile] = React.useState(false);

  return (
    <header className="fixed right-0 top-0 left-60 h-16 bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] flex items-center justify-between px-8">
      {/* Left Side - Title */}
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
        본사 대시보드
      </h1>

      {/* Right Side - Actions */}
      <div className="flex items-center gap-6">
        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-default)] rounded-lg transition-colors"
          >
            <Bell size={20} />
            {/* Notification Badge */}
            <span className="absolute top-1 right-1 h-2 w-2 bg-[var(--color-status-error)] rounded-full"></span>
          </button>

          {/* Notification Dropdown */}
          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg shadow-lg p-4 z-50">
              <div className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">
                알림
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                <div className="p-2 bg-[var(--color-bg-default)] rounded text-sm">
                  <p className="font-medium text-[var(--color-text-primary)]">
                    점주 가입 승인 요청 3건
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                    2분 전
                  </p>
                </div>
                <div className="p-2 bg-[var(--color-bg-default)] rounded text-sm">
                  <p className="font-medium text-[var(--color-text-primary)]">
                    신규 문의 1건
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                    15분 전
                  </p>
                </div>
              </div>
              <Link href="/hq/notifications">
                <button className="mt-3 w-full text-center py-2 text-sm text-[var(--color-primary)] hover:bg-[var(--color-primary-light)] rounded transition-colors">
                  모든 알림 보기
                </button>
              </Link>
            </div>
          )}
        </div>

        {/* Profile */}
        <div className="relative">
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-default)] rounded-lg transition-colors"
          >
            <User size={20} />
          </button>

          {/* Profile Dropdown */}
          {showProfile && (
            <div className="absolute right-0 mt-2 w-48 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg shadow-lg p-2 z-50">
              <Link href="/hq/settings">
                <button className="w-full text-left px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-default)] rounded transition-colors flex items-center gap-2">
                  <User size={16} />
                  프로필 설정
                </button>
              </Link>
              <button className="w-full text-left px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-default)] rounded transition-colors flex items-center gap-2">
                <LogOut size={16} />
                로그아웃
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
