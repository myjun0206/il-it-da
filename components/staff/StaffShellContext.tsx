"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import type { StaffStore } from "@/lib/staff/approved-stores";
import {
  readSelectedStaffStoreId,
  writeSelectedStaffStoreId,
  writeStaffConversationId,
} from "@/lib/staff/selected-store";
import { createClient } from "@/lib/supabase/client";

// 직원 화면 공통 상태 (Header · Sidebar · AI 챗봇 · 매뉴얼 · 근무 매장이 같은 값을 쓴다).
// "현재 근무 매장"은 여기 하나뿐이다: 선택지는 서버가 준 approved 매장 목록이고,
// 선택값(sessionStorage)은 편의용일 뿐이며 매장 데이터 API는 서버에서 approved membership을 다시 검증한다.

export interface StaffPendingStore {
  membershipId: string;
  storeId: string;
  storeName: string;
  requestedAt?: string;
}

interface StaffShellValue {
  userName: string;
  /** profiles.role 기준 표시 문구. role이 확인되기 전에는 빈 문자열 */
  roleLabel: string;
  stores: StaffStore[];
  pendingStores: StaffPendingStore[];
  selectedStore: StaffStore | null;
  isStoresLoading: boolean;
  storesError: string;
  reloadStores: () => void;
  /** approved 목록 안의 매장만 선택된다. 매장이 바뀌면 이어 보던 AI 대화 ID는 비운다(대화는 매장에 고정). */
  selectStore: (storeId: string) => StaffStore | null;
  logout: () => Promise<void>;
}

const ROLE_LABELS: Record<string, string> = { staff: "직원" };

const StaffShellContext = createContext<StaffShellValue | null>(null);

type MembershipRow = StaffPendingStore & { role: string; status: string };

type StoresState = {
  stores: StaffStore[];
  pendingStores: StaffPendingStore[];
  selectedStore: StaffStore | null;
  isStoresLoading: boolean;
  storesError: string;
};

export function StaffShellProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [storesState, setStoresState] = useState<StoresState>({
    stores: [],
    pendingStores: [],
    selectedStore: null,
    isStoresLoading: true,
    storesError: "",
  });

  // 로그인 사용자 + profiles.role/승인 상태 확인 (layout의 서버 role 검사와 별개로 승인 대기 계정을 안내 화면으로 보낸다)
  useEffect(() => {
    let isCancelled = false;
    const supabase = createClient();

    void (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (isCancelled) return;
        if (error || !data.user) {
          router.push("/");
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role, approval_status, full_name")
          .eq("id", data.user.id)
          .maybeSingle<{ role: string; approval_status: string | null; full_name: string | null }>();
        if (isCancelled) return;

        if (profile?.role !== "staff") {
          router.push("/");
          return;
        }
        if (profile.approval_status !== "approved") {
          router.push("/signup/approval-status");
          return;
        }

        setUserName(profile.full_name || (data.user.user_metadata?.name as string | undefined) || "");
        setRoleLabel(ROLE_LABELS[profile.role] ?? "");
      } catch {
        if (!isCancelled) router.push("/");
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [router]);

  // 근무 매장: approved는 /api/staff/stores(서버에서 approved staff membership만), 승인 대기는 본인 membership 목록
  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const [approvedResponse, membershipResponse] = await Promise.all([
          fetch("/api/staff/stores", { signal: controller.signal, credentials: "include" }),
          fetch("/api/signup/store-membership", { signal: controller.signal, credentials: "include" }),
        ]);
        if (approvedResponse.status === 401) {
          router.push("/");
          return;
        }

        const approvedPayload = (await approvedResponse.json()) as { stores?: StaffStore[] };
        if (!approvedResponse.ok || !Array.isArray(approvedPayload.stores)) throw new Error("stores");

        let pendingStores: StaffPendingStore[] = [];
        try {
          const membershipPayload = (await membershipResponse.json()) as { success?: boolean; data?: MembershipRow[] };
          if (membershipResponse.ok && membershipPayload.success && Array.isArray(membershipPayload.data)) {
            pendingStores = membershipPayload.data
              .filter((membership) => membership.role === "staff" && membership.status === "pending")
              .map(({ membershipId, storeId, storeName, requestedAt }) => ({ membershipId, storeId, storeName, requestedAt }));
          }
        } catch {
          pendingStores = [];
        }
        if (controller.signal.aborted) return;

        const stores = approvedPayload.stores;
        const storedStoreId = readSelectedStaffStoreId();
        // 저장된 선택이 여전히 승인 매장이면 유지, 아니면 첫 승인 매장으로 안전하게 대체한다.
        const selectedStore = stores.find((store) => store.id === storedStoreId) ?? stores[0] ?? null;
        writeSelectedStaffStoreId(selectedStore?.id ?? null);

        setStoresState({ stores, pendingStores, selectedStore, isStoresLoading: false, storesError: "" });
      } catch {
        if (controller.signal.aborted) return;
        setStoresState({
          stores: [],
          pendingStores: [],
          selectedStore: null,
          isStoresLoading: false,
          storesError: "승인된 근무 매장을 불러오지 못했습니다. 다시 시도해 주세요.",
        });
      }
    })();

    return () => controller.abort();
  }, [router, reloadToken]);

  const reloadStores = useCallback(() => {
    setStoresState((current) => ({ ...current, isStoresLoading: true, storesError: "" }));
    setReloadToken((value) => value + 1);
  }, []);

  const selectStore = useCallback(
    (storeId: string) => {
      const store = storesState.stores.find((candidate) => candidate.id === storeId) ?? null;
      if (!store) return null;
      if (store.id !== storesState.selectedStore?.id) {
        writeStaffConversationId(null);
        writeSelectedStaffStoreId(store.id);
        setStoresState((current) => ({ ...current, selectedStore: store }));
      }
      return store;
    },
    [storesState.stores, storesState.selectedStore],
  );

  // Sidebar 하단 로그아웃과 ProfileMenu 로그아웃이 같은 함수를 쓴다.
  const logout = useCallback(async () => {
    try {
      await createClient().auth.signOut();
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      writeStaffConversationId(null);
      router.push("/");
    }
  }, [router]);

  const value = useMemo<StaffShellValue>(
    () => ({ userName, roleLabel, ...storesState, reloadStores, selectStore, logout }),
    [userName, roleLabel, storesState, reloadStores, selectStore, logout],
  );

  return <StaffShellContext.Provider value={value}>{children}</StaffShellContext.Provider>;
}

export function useStaffShell(): StaffShellValue {
  const value = useContext(StaffShellContext);
  if (!value) throw new Error("useStaffShell must be used inside StaffShellProvider");
  return value;
}
