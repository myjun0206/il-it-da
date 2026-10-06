"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Check, Store } from "lucide-react";
import NotificationCenter from "@/components/common/NotificationCenter";
import ProfileMenu from "@/components/common/ProfileMenu";
import { createClient } from "@/lib/supabase/client";
import type { HqStoreSummary } from "@/lib/types/store";

interface HQHeaderProps {
  userName: string;
  franchiseName: string;
  /** HQ에서 관리 가능한 매장 목록 */
  stores?: HqStoreSummary[];
  /** 현재 선택된 기본 매장 ID */
  selectedStoreId?: string | null;
  /** 매장 로딩 중 여부 */
  isStoresLoading?: boolean;
  /** 기본 매장 변경 핸들러 */
  onSetDefaultStore?: (storeId: string) => Promise<void>;
  /** 로그아웃 핸들러 (더 이상 사용되지 않음, 하위 호환성 유지) */
  onLogout?: () => Promise<void>;
}

export default function HQHeader({
  userName,
  franchiseName,
  stores = [],
  selectedStoreId = null,
  isStoresLoading = false,
  onSetDefaultStore,
  onLogout,
}: HQHeaderProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isStoreDropdownOpen, setIsStoreDropdownOpen] = useState(false);
  const [isSettingDefaultStore, setIsSettingDefaultStore] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  const currentStore = stores.find((s) => s.id === selectedStoreId);
  const hasMultipleStores = stores.length > 1;

  const handleSelectStore = async (storeId: string) => {
    if (!onSetDefaultStore || isSettingDefaultStore || isStoresLoading) return;
    setIsSettingDefaultStore(true);
    try {
      await onSetDefaultStore(storeId);
      setIsStoreDropdownOpen(false);
    } finally {
      setIsSettingDefaultStore(false);
    }
  };

  // 드롭다운 닫기: 외부 클릭 또는 Escape
  useEffect(() => {
    if (!isStoreDropdownOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
        setIsStoreDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsStoreDropdownOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isStoreDropdownOpen]);

  useEffect(() => {
    let isCancelled = false;
    const supabase = createClient();

    void (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (isCancelled || !userData.user) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("avatar_url, avatar_updated_at")
          .eq("id", userData.user.id)
          .maybeSingle<{ avatar_url: string | null; avatar_updated_at: string | null }>();

        if (!isCancelled) {
          // cache busting은 이제 filename에 포함됨 (avatar-{timestamp}.jpg)
          // 따라서 query string 불필요, 원본 URL만 사용
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

  // Settings에서 avatar 변경 이벤트 수신
  useEffect(() => {
    const handleAvatarUpdate = (event: CustomEvent) => {
      const newAvatarUrl = event.detail?.avatarUrl;
      if (newAvatarUrl && typeof newAvatarUrl === "string") {
        setAvatarUrl(newAvatarUrl);
      } else if (newAvatarUrl === null) {
        setAvatarUrl(null);
      }
    };

    window.addEventListener("hqAvatarUpdated", handleAvatarUpdate as EventListener);
    return () => {
      window.removeEventListener("hqAvatarUpdated", handleAvatarUpdate as EventListener);
    };
  }, []);

  return (
    <header className="sticky top-0 z-20 bg-white border-b border-[var(--color-border)] h-16 shrink-0">
      <div className="flex items-center justify-end gap-3 sm:gap-4 px-6 h-full">
        {/* 알림 */}
        <NotificationCenter notificationPageUrl="/hq/notifications" />

        {/* 기본 매장 선택 영역 */}
        <div ref={selectorRef} className="relative">
          <button
            type="button"
            onClick={() => hasMultipleStores && setIsStoreDropdownOpen((prev) => !prev)}
            disabled={isStoresLoading || isSettingDefaultStore || !hasMultipleStores}
            aria-haspopup={hasMultipleStores ? "menu" : undefined}
            aria-expanded={isStoreDropdownOpen}
            aria-controls={hasMultipleStores ? "hq-store-selector-menu" : undefined}
            className={`
              flex items-center gap-2 px-3 py-2 rounded-lg transition-colors
              ${hasMultipleStores ? "hover:bg-[var(--color-primary-light)]/10 cursor-pointer" : "cursor-default"}
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]
            `}
          >
            {/* 현재 기본 매장명 */}
            <span className="max-w-[200px] text-sm font-medium text-[var(--color-text-primary)] truncate">
              {isStoresLoading ? "매장 불러오는 중..." : currentStore ? currentStore.name : franchiseName}
            </span>

            {/* Chevron 아이콘: 여러 매장일 때만 표시 */}
            {hasMultipleStores && (
              <ChevronDown
                size={16}
                aria-hidden="true"
                className={`text-[var(--color-text-secondary)] transition-transform flex-shrink-0 ${isStoreDropdownOpen ? "rotate-180" : ""}`}
              />
            )}
          </button>

          {/* 드롭다운 메뉴: 여러 매장이 있고 열려있을 때만 표시 */}
          {isStoreDropdownOpen && hasMultipleStores && (
            <div
              id="hq-store-selector-menu"
              role="menu"
              aria-label="기본 매장 선택"
              className="absolute right-0 top-full z-50 mt-2 w-[280px] rounded-xl border border-[var(--color-border)] bg-white shadow-md overflow-hidden"
            >
              {/* 헤더: "기본 매장" 라벨 */}
              <div className="px-3 py-3 border-b border-[var(--color-border)]">
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">기본 매장</p>
              </div>

              {/* 매장 목록 */}
              <div className="max-h-[320px] overflow-y-auto">
                {stores.map((store) => {
                  const isSelected = store.id === selectedStoreId;
                  return (
                    <button
                      key={store.id}
                      type="button"
                      onClick={() => void handleSelectStore(store.id)}
                      disabled={isStoresLoading || isSettingDefaultStore}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-primary-light)]/10 transition-colors text-left disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <div className="w-5 flex-shrink-0 flex items-center justify-center">
                        <Check
                          size={16}
                          className={`${isSelected ? "text-[var(--color-primary)]" : "text-transparent"}`}
                          strokeWidth={2.5}
                          aria-hidden="true"
                        />
                      </div>
                      <span className="flex-1 break-keep">{store.name}</span>
                    </button>
                  );
                })}
              </div>

              {/* Divider */}
              <div className="border-t border-[var(--color-border)]" />

              {/* 지점 관리 링크 */}
              <Link
                href="/hq/stores"
                onClick={() => setIsStoreDropdownOpen(false)}
                className="flex h-11 items-center gap-2 px-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-primary-light)]/10 transition-colors"
              >
                <Store size={16} aria-hidden="true" className="text-[var(--color-text-secondary)]" />
                <span className="flex-1">지점 관리</span>
                <ChevronRight size={16} aria-hidden="true" className="text-[var(--color-text-tertiary)]" />
              </Link>
            </div>
          )}
        </div>

        {/* 프로필 메뉴 (HQ용) */}
        <ProfileMenu
          userName={userName}
          subtitle="본사 관리자"
          roleLabel="본사 관리자"
          avatarUrl={avatarUrl}
        />
      </div>
    </header>
  );
}
