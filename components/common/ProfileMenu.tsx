"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface ProfileMenuProps {
  userName: string;
  /** 헤더 이름 아래 보조 문구 (예: "메가MGC커피 · 본사 관리자") */
  subtitle: string;
  /** 드롭다운 배지에 표시할 역할명 */
  roleLabel: string;
  settingsHref: string;
  /** 각 페이지의 기존 로그아웃 핸들러를 그대로 받는다. */
  onLogout: () => void;
}

// HQ/Owner 헤더 우측의 사용자 정보 + 계정 드롭다운 (환경설정 / 로그아웃)
export default function ProfileMenu({ userName, subtitle, roleLabel, settingsHref, onLogout }: ProfileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadEmail = async () => {
      const { data } = await createClient().auth.getUser();
      setEmail(data.user?.email ?? "");
    };

    void loadEmail();
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={menuRef} className="relative pl-6 border-l border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="profile-menu"
        className="flex min-h-[44px] items-center gap-3 rounded-lg px-2 -mx-2 transition-colors hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <span className="text-right">
          <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{userName}</span>
          <span className="block text-xs text-[var(--color-text-secondary)]">{subtitle}</span>
        </span>
        <span className="w-8 h-8 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center">
          <span className="text-xs font-bold text-[var(--color-primary)]">{userName.charAt(0)}</span>
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`text-[var(--color-text-secondary)] transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          id="profile-menu"
          role="menu"
          aria-label="계정 메뉴"
          className="absolute right-0 top-full z-50 mt-3 w-[300px] rounded-xl border border-[var(--color-border)] bg-white p-2 shadow-md"
        >
          <div className="px-3 pb-3 pt-2">
            <p className="text-base font-semibold text-[var(--color-text-primary)] break-all">{userName}</p>
            {email && <p className="mt-0.5 text-sm text-[var(--color-text-secondary)] break-all">{email}</p>}
            <span className="mt-2 inline-flex rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
              {roleLabel}
            </span>
          </div>
          <div className="my-1 border-t border-[var(--color-border)]" role="separator" />
          <Link
            href={settingsHref}
            role="menuitem"
            onClick={() => setIsOpen(false)}
            className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-primary-light)]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <Settings size={18} aria-hidden="true" className="text-[var(--color-text-secondary)]" />
            환경설정
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onLogout();
            }}
            className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
          >
            <LogOut size={18} aria-hidden="true" />
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
