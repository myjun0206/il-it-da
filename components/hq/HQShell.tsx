"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import { createClient } from "@/lib/supabase/client";
import { readSelectedHqStoreId, writeSelectedHqStoreId } from "@/lib/hq/selected-store";
import type { HqStoreSummary } from "@/lib/types/store";

interface HQShellProps {
  children: React.ReactNode;
  activeMenu?: string;
}

/**
 * HQ 관리자 화면의 공통 레이아웃 쉘
 * - 사이드바 (좌측, 고정)
 * - 헤더 (상단, 고정)
 * - 콘텐츠 영역 (메인)
 *
 * 이 컴포넌트는 모든 HQ 페이지의 레이아웃을 통일합니다.
 * 각 페이지에서는 content만 관리하면 됩니다.
 */
export default function HQShell({ children, activeMenu: propActiveMenu }: HQShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("메가MGC커피");
  const [stores, setStores] = useState<HqStoreSummary[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [isStoresLoading, setIsStoresLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);

  /**
   * URL pathname을 기반으로 activeMenu를 자동으로 판별합니다.
   * HQSidebar의 실제 menu id를 기준으로 매핑합니다.
   */
  const computedActiveMenu = useMemo(() => {
    // propActiveMenu가 명시적으로 전달된 경우, 그것을 우선 사용
    if (propActiveMenu) {
      return propActiveMenu;
    }

    // pathname 기반 자동 판별
    if (pathname === "/hq" || pathname === "/hq/") {
      return "home";
    }

    // /hq/manuals로 시작하는 모든 경로 → "manual"
    if (pathname.startsWith("/hq/manuals")) {
      return "manual";
    }

    // /hq/stores로 시작하는 모든 경로 → "store"
    if (pathname.startsWith("/hq/stores")) {
      return "store";
    }

    // /hq/communication으로 시작하는 모든 경로 (게시글 작성 포함) → "notice"
    if (pathname.startsWith("/hq/communication")) {
      return "notice";
    }

    // /hq/settings → "settings"
    if (pathname.startsWith("/hq/settings")) {
      return "settings";
    }

    // 기타 (approvals, notifications 등) → 기본값 "home"
    return "home";
  }, [pathname, propActiveMenu]);

  // 사용자 정보 로드
  useEffect(() => {
    const loadUserInfo = async () => {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();

        if (!session?.user) {
          router.push("/");
          return;
        }

        const userName = session.user.user_metadata?.name || "본사 관리자";
        const firstName = userName.split(" ")[0] || "메가MGC커피";

        setUserName(userName);
        setFranchiseName(firstName);
      } catch (error) {
        console.error("Failed to load user info:", error);
        router.push("/");
      }
    };

    loadUserInfo();
  }, [router]);

  // 매장 목록 로드
  useEffect(() => {
    const loadStores = async () => {
      try {
        setIsStoresLoading(true);
        const response = await fetch("/api/hq/stores");
        const result = (await response.json()) as { stores?: HqStoreSummary[] };

        if (!response.ok) {
          console.error("Failed to load stores");
          return;
        }

        const storesList = result.stores ?? [];
        setStores(storesList);

        // 저장된 선택 매장 ID 복원
        const savedStoreId = readSelectedHqStoreId();
        if (savedStoreId && storesList.some((s) => s.id === savedStoreId)) {
          setSelectedStoreId(savedStoreId);
        } else if (storesList.length > 0) {
          // 저장된 ID가 없거나 유효하지 않으면 첫 번째 매장 선택
          setSelectedStoreId(storesList[0].id);
        }
      } catch (error) {
        console.error("Failed to load stores:", error);
      } finally {
        setIsStoresLoading(false);
        setIsReady(true);
      }
    };

    loadStores();
  }, []);

  const handleSetDefaultStore = async (storeId: string) => {
    try {
      setIsStoresLoading(true);
      const response = await fetch("/api/hq/set-default-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });

      if (!response.ok) {
        throw new Error("Failed to set default store");
      }

      setSelectedStoreId(storeId);
      writeSelectedHqStoreId(storeId);
    } catch (error) {
      console.error("Failed to set default store:", error);
    } finally {
      setIsStoresLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      router.push("/");
    }
  };

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* 사이드바 - 좌측 고정, 모바일에서는 오버레이 */}
      <div className="fixed left-0 top-0 h-screen z-40">
        <HQSidebar
          userName={userName}
          franchiseName={franchiseName}
          onLogout={handleLogout}
          activeMenu={computedActiveMenu}
        />
      </div>

      {/* 메인 컨텐츠 영역 */}
      <div className="flex-1 flex flex-col overflow-hidden lg:ml-[240px]">
        {/* 헤더 - 상단 고정 */}
        <HQHeader
          userName={userName}
          franchiseName={franchiseName}
          stores={stores}
          selectedStoreId={selectedStoreId}
          isStoresLoading={isStoresLoading}
          onSetDefaultStore={handleSetDefaultStore}
        />

        {/* 콘텐츠 영역 - 스크롤 가능 */}
        <main className="flex-1 overflow-y-auto bg-[var(--color-bg-default)]">
          {children}
        </main>
      </div>
    </div>
  );
}
