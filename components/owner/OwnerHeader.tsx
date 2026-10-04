"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import NotificationCenter from "@/components/common/NotificationCenter";
import ProfileMenu from "@/components/common/ProfileMenu";
import StoreSwitcher, { type SwitcherStore } from "@/components/common/StoreSwitcher";
import { persistSelectedStore, resolveOwnerCurrentStore } from "@/lib/owner/current-store";
import { createClient } from "@/lib/supabase/client";

interface OwnerHeaderProps {
  userName: string;
  storeName: string;
  /** 각 Owner 페이지가 사이드바에 넘기는 기존 로그아웃 핸들러를 그대로 재사용한다. */
  onLogout: () => void;
}

// 매장 전환 후 새로고침된 화면에서 한 번 보여줄 안내 (탭 단위)
const SWITCH_TOAST_KEY = "ownerStoreSwitchedTo";

export default function OwnerHeader({
  userName,
  storeName,
  onLogout: _onLogout,
}: OwnerHeaderProps) {
  const router = useRouter();
  const [stores, setStores] = useState<SwitcherStore[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [currentStoreId, setCurrentStoreId] = useState<string | null>(null);
  const [currentStoreName, setCurrentStoreName] = useState(storeName);
  const [isLoadingStores, setIsLoadingStores] = useState(true);
  const [toastMessage, setToastMessage] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // 점주 공통 현재 매장 결정(approved owner membership → store). 모든 점주 화면이 같은 규칙을 쓴다.
  useEffect(() => {
    let isCancelled = false;
    void resolveOwnerCurrentStore().then((resolution) => {
      if (isCancelled) return;
      if (resolution.status === "ready") {
        setStores(resolution.stores.map((store) => ({ id: store.storeId, name: store.storeName })));
        setPendingCount(resolution.pending.length);
        setCurrentStoreId(resolution.current?.storeId ?? null);
        if (resolution.current) setCurrentStoreName(resolution.current.storeName);
      }
      setIsLoadingStores(false);

      try {
        const switchedTo = sessionStorage.getItem(SWITCH_TOAST_KEY);
        if (switchedTo) {
          sessionStorage.removeItem(SWITCH_TOAST_KEY);
          setToastMessage(`${switchedTo}으로 전환했습니다.`);
        }
      } catch {
        // sessionStorage를 쓸 수 없으면 안내만 생략한다.
      }
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  // avatarUrl 로드
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

    window.addEventListener("ownerAvatarUpdated", handleAvatarUpdate as EventListener);
    return () => {
      window.removeEventListener("ownerAvatarUpdated", handleAvatarUpdate as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(""), 2500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const handleSelectStore = (storeId: string) => {
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store || store.id === currentStoreId) return;

    // 선택값을 공통 저장소에 남기고, 현재 화면을 다시 불러와 홈·직원 관리·지점 매뉴얼·공지 등
    // 모든 매장 데이터가 같은 매장 기준으로 다시 조회되게 한다. (각 API는 서버에서 approved owner를 재검증)
    persistSelectedStore({ storeId: store.id, storeName: store.name });
    try {
      sessionStorage.setItem(SWITCH_TOAST_KEY, store.name);
    } catch {
      // 안내 표시만 생략
    }
    window.location.reload();
  };

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-[var(--color-border)] h-16 shrink-0">
      <div className="flex items-center justify-between gap-4 pl-16 pr-6 h-full lg:pl-6">
        {/* Left: 현재 운영 매장 빠른 전환 */}
        <div className="w-full max-w-xs">
          <StoreSwitcher
            compact
            label="현재 운영 매장"
            manageLabel="운영 매장 관리"
            stores={stores}
            pendingCount={pendingCount}
            selectedStoreId={currentStoreId}
            isLoading={isLoadingStores}
            onSelect={handleSelectStore}
            onManageStores={() => router.push("/boss/stores")}
          />
        </div>

        {/* Right */}
        <div className="flex shrink-0 items-center gap-6">
          {/* Notification Center */}
          <NotificationCenter notificationPageUrl="/boss/notifications" />

          {/* Profile */}
          <ProfileMenu
            userName={userName}
            subtitle={currentStoreName || storeName ? `${currentStoreName || storeName} · 점주` : "점주"}
            roleLabel="점주"
            avatarUrl={avatarUrl}
          />
        </div>
      </div>

      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-[var(--color-text-primary)] px-4 py-3 text-sm font-medium text-[var(--color-bg-surface)] shadow-md lg:left-[calc(50%+120px)]"
        >
          <CheckCircle2 size={16} aria-hidden="true" />
          {toastMessage}
        </div>
      )}
    </header>
  );
}
