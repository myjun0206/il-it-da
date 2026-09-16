"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Menu, X, Bell, Settings, LogOut, User, Store } from "lucide-react";
import clsx from "clsx";

interface HeaderProps {
  userRole?: string;
  userName?: string;
  onMenuToggle?: () => void;
  isMobileMenuOpen?: boolean;
}

export const Header = React.forwardRef<HTMLDivElement, HeaderProps>(
  ({ userRole = "staff", userName = "사용자", onMenuToggle, isMobileMenuOpen }, ref) => {
    const [isProfileOpen, setIsProfileOpen] = useState(false);

    const getRoleBadge = () => {
      const badges: Record<string, { label: string; color: string }> = {
        hq: { label: "본사", color: "bg-purple-100 text-purple-700" },
        owner: { label: "점주", color: "bg-blue-100 text-blue-700" },
        staff: { label: "직원", color: "bg-green-100 text-green-700" },
      };
      return badges[userRole] || badges.staff;
    };

    const badge = getRoleBadge();

    return (
      <div
        ref={ref}
        className="fixed top-0 left-0 right-0 z-[var(--zindex-fixed)] h-20 bg-[var(--color-bg-surface)] border-b border-[var(--color-border)]"
      >
        <div className="h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          {/* Left Side - Logo & Menu Toggle */}
          <div className="flex items-center gap-4">
            <button
              onClick={onMenuToggle}
              className="lg:hidden flex items-center justify-center w-10 h-10 rounded-lg hover:bg-[var(--color-bg-default)] transition-colors"
              aria-label="메뉴 토글"
            >
              {isMobileMenuOpen ? (
                <X size={20} />
              ) : (
                <Menu size={20} />
              )}
            </button>

            <Link href="/app/home" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-primary)]">
                <Store size={16} className="text-white" />
              </div>
              <span className="hidden sm:inline font-bold text-[var(--color-text-primary)]">
                일잇다
              </span>
            </Link>
          </div>

          {/* Right Side - Notifications & Profile */}
          <div className="flex items-center gap-4">
            {/* Notifications */}
            <button
              className="relative flex items-center justify-center w-10 h-10 rounded-lg hover:bg-[var(--color-bg-default)] transition-colors text-[var(--color-text-secondary)]"
              aria-label="알림"
            >
              <Bell size={20} />
              <span className="absolute top-2 right-2 flex h-2 w-2 rounded-full bg-[var(--color-status-error)]" />
            </button>

            {/* Profile Dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--color-bg-default)] transition-colors"
              >
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {userName}
                  </span>
                  <span className={clsx("text-xs px-2 py-0.5 rounded-full font-bold", badge.color)}>
                    {badge.label}
                  </span>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-primary-light)]">
                  <User size={16} className="text-[var(--color-primary)]" />
                </div>
              </button>

              {/* Dropdown Menu */}
              {isProfileOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-lg shadow-lg bg-[var(--color-bg-surface)] border border-[var(--color-border)] z-50">
                  <a
                    href="/app/profile"
                    className="flex items-center gap-3 px-4 py-3 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-default)] transition-colors border-b border-[var(--color-border)]"
                  >
                    <User size={16} />
                    프로필
                  </a>
                  <a
                    href="/app/settings"
                    className="flex items-center gap-3 px-4 py-3 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-default)] transition-colors border-b border-[var(--color-border)]"
                  >
                    <Settings size={16} />
                    설정
                  </a>
                  <button
                    onClick={() => {
                      // TODO: 로그아웃 로직
                      window.location.href = "/login";
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-[var(--color-status-error)] hover:bg-red-50 transition-colors"
                  >
                    <LogOut size={16} />
                    로그아웃
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

Header.displayName = "Header";
