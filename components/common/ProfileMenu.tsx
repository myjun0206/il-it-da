"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import ProfileAvatar from "@/components/common/ProfileAvatar";
import type { StaffStore } from "@/lib/staff/approved-stores";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";

interface ProfileMenuProps {
  userName: string;
  /** 헤더 이름 아래 보조 문구 (예: "메가MGC커피 · 본사 관리자") */
  subtitle: string;
  /** 드롭다운 배지에 표시할 역할명 */
  roleLabel: string;
  settingsHref: string;
  /** 프로필 사진 URL (없으면 initials 표시) */
  avatarUrl?: string | null;
  /** 드롭다운에 표시할 현재 소속 정보 (예: 직원의 현재 근무 매장). 없으면 생략 */
  context?: { label: string; value: string };
  /** 승인된 근무 매장 목록 (직원용) */
  stores?: StaffStore[];
  /** 현재 기본 매장 ID (직원용) */
  defaultStoreId?: string | null;
  /** 기본 매장 변경 핸들러 (직원용) */
  onSetDefaultStore?: (storeId: string) => Promise<void>;
  /** 각 페이지의 기존 로그아웃 핸들러를 그대로 받는다. */
  onLogout: () => void;
}

// HQ/Owner 헤더 우측의 사용자 정보 + 계정 드롭다운 (환경설정 / 로그아웃)
export default function ProfileMenu({
  userName,
  subtitle,
  roleLabel,
  settingsHref,
  avatarUrl,
  context,
  stores,
  defaultStoreId,
  onSetDefaultStore,
  onLogout,
}: ProfileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const approvedStores = stores ?? [];
  const hasMultipleStores = approvedStores.length > 1;
  const currentDefaultStore = approvedStores.find((s) => s.id === defaultStoreId);

  const handleSelectStore = async (storeId: string) => {
    if (!onSetDefaultStore || isSettingDefault) return;
    setIsSettingDefault(true);
    try {
      await onSetDefaultStore(storeId);
      setStoreDropdownOpen(false);
    } finally {
      setIsSettingDefault(false);
    }
  };

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
            
            {/* 기본 매장 선택 */}
            {approvedStores.length > 0 && (
              <div className="mt-4 relative">
                <button
                  type="button"
                  onClick={() => setStoreDropdownOpen(!storeDropdownOpen)}
                  disabled={isSettingDefault || !hasMultipleStores}
                  className="w-full rounded-lg bg-[var(--color-bg-default)] px-3 py-2 text-left hover:bg-[var(--color-primary-light)]/15 transition-colors disabled:cursor-default disabled:hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <p className="text-xs text-[var(--color-text-tertiary)]">기본 매장</p>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className="flex-1 text-sm font-medium text-[var(--color-text-primary)] break-keep">
                      {currentDefaultStore ? formatStoreDisplayName(currentDefaultStore.name) : ""}
                    </p>
                    {hasMultipleStores && (
                      <ChevronDown
                        size={16}
                        className={`text-[var(--color-text-secondary)] transition-transform flex-shrink-0 ${storeDropdownOpen ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                </button>

                {storeDropdownOpen && hasMultipleStores && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-[var(--color-border)] bg-white shadow-md overflow-hidden">
                    {approvedStores.map((store) => {
                      const isSelected = store.id === defaultStoreId;
                      return (
                        <button
                          key={store.id}
                          type="button"
                          onClick={() => void handleSelectStore(store.id)}
                          disabled={isSettingDefault}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-primary-light)]/15 transition-colors text-left disabled:opacity-60 disabled:cursor-not-allowed first:border-t-0 border-t border-[var(--color-border)]"
                        >
                          <Check
                            size={16}
                            className={`flex-shrink-0 ${
                              isSelected ? "text-[var(--color-primary)]" : "text-transparent"
                            }`}
                            strokeWidth={2.5}
                            aria-hidden="true"
                          />
                          <span className="break-keep">{formatStoreDisplayName(store.name)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            
            {/* Legacy context (HQ/Owner용) */}
            {!approvedStores.length && context && (
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
