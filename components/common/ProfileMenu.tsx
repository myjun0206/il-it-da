"use client";

import React, { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import ProfileAvatar from "@/components/common/ProfileAvatar";

interface ProfileMenuProps {
  userName: string;
  /** 헤더 이름 아래 보조 문구 (예: "관리자" 등) */
  subtitle: string;
  /** 드롭다운 배지에 표시할 역할명 */
  roleLabel: string;
  /** 프로필 사진 URL (없으면 initials 표시) */
  avatarUrl?: string | null;
  /** 드롭다운에 표시할 현재 소속 정보 (예: 본사 관리자). 없으면 생략 */
  context?: { label: string; value: string };
}

// HQ/Owner/Staff 헤더 우측의 사용자 정보 드롭다운
export default function ProfileMenu({
  userName,
  subtitle,
  roleLabel,
  avatarUrl,
  context,
}: ProfileMenuProps) {
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
    <div ref={menuRef} className="relative pl-3 sm:pl-6 border-l border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="profile-menu"
        className="flex min-h-[44px] items-center gap-3 rounded-lg px-2 -mx-2 transition-colors hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        {/* 좁은 화면에서는 이름/소속 문구를 숨기고 아바타만 보여 준다. (드롭다운에 같은 정보가 있다) */}
        <span className="hidden text-right sm:block">
          <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{userName}</span>
          <span className="block text-xs text-[var(--color-text-secondary)]">{subtitle}</span>
        </span>
        <ProfileAvatar name={userName} avatarUrl={avatarUrl} size="md" />
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
            {/* 사용자 정보 + 역할 배지 */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-[var(--color-text-primary)] break-all">{userName}</p>
                {email && <p className="mt-0.5 text-sm text-[var(--color-text-secondary)] break-all">{email}</p>}
              </div>
              <span className="flex-shrink-0 inline-flex rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
                {roleLabel}
              </span>
            </div>

            {/* HQ/Owner용 소속 정보 */}
            {context && (
              <div className="mt-4 rounded-lg bg-[var(--color-bg-default)] px-3 py-2">
                <p className="text-xs text-[var(--color-text-tertiary)]">{context.label}</p>
                <p className="mt-0.5 text-sm font-medium text-[var(--color-text-primary)] break-keep">{context.value}</p>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
