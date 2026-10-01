"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import type { StaffStore } from "@/lib/staff/approved-stores";
import {
  readSelectedStaffStoreId,
  writeSelectedStaffStoreId,
  writeStaffConversationId,
} from "@/lib/staff/selected-store";
import {
  applyStoreOrder,
  resolveDefaultStoreId,
  sanitizeStorePreferences,
  type StaffStorePreferences,
} from "@/lib/staff/store-preferences";
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
  /** 활성 매장: 지금 AI 챗봇·지점 매뉴얼·공지에 적용되는 매장 (탭 단위 선택) */
  selectedStore: StaffStore | null;
  /** 기본 매장: 사용자가 지정한 대표 근무 매장 (계정에 저장, 로그인 직후 활성 매장의 초깃값) */
  defaultStoreId: string | null;
  isStoresLoading: boolean;
  storesError: string;
  reloadStores: () => void;
  /**
   * 기본 매장/표시 순서를 계정에 저장한다. 기본 매장이 바뀌면 활성 매장도 그 매장으로 전환한다.
   * 승인 완료된 매장만 지정할 수 있다(서버에서 다시 검증). 성공 여부를 돌려준다.
   */
  saveStorePreferences: (preferences: StaffStorePreferences) => Promise<boolean>;
  /** approved 목록 안의 매장만 선택된다. 매장이 바뀌면 이어 보던 AI 대화 ID는 비운다(대화는 매장에 고정). */
  selectStore: (storeId: string) => StaffStore | null;
  logout: () => Promise<void>;
}

const ROLE_LABELS: Record<string, string> = { staff: "직원" };

const StaffShellContext = createContext<StaffShellValue | null>(null);

type MembershipRow = StaffPendingStore & { role: string; status: string };

type StoresState = {
  /** 승인 완료 매장 (사용자 지정 순서) */
  stores: StaffStore[];
  pendingStores: StaffPendingStore[];
  selectedStore: StaffStore | null;
  defaultStoreId: string | null;
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
    defaultStoreId: null,
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
        const [approvedResponse, membershipResponse, preferencesResponse] = await Promise.all([
          fetch("/api/staff/stores", { signal: controller.signal, credentials: "include" }),
          fetch("/api/signup/store-membership", { signal: controller.signal, credentials: "include" }),
          // 기본 매장/표시 순서 (조회 실패 시 기본 규칙으로 동작: 첫 승인 매장, 서버 순서)
          fetch("/api/staff/store-preferences", { signal: controller.signal, credentials: "include" }).catch(() => null),
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

        let rawPreferences: unknown = null;
        try {
          if (preferencesResponse?.ok) {
            rawPreferences = ((await preferencesResponse.json()) as { preferences?: unknown }).preferences ?? null;
          }
        } catch {
          rawPreferences = null;
        }
        if (controller.signal.aborted) return;

        const approvedStores = approvedPayload.stores;
        const preferences = sanitizeStorePreferences(
          rawPreferences,
          approvedStores.map((store) => store.id),
        );
        const stores = applyStoreOrder(approvedStores, preferences.order);
        const defaultStoreId = resolveDefaultStoreId(stores, preferences);

        const storedStoreId = readSelectedStaffStoreId();
        // 활성 매장: 이 탭에서 고른 매장이 여전히 승인 매장이면 유지, 아니면 기본 매장(없으면 첫 승인 매장).
        const selectedStore =
          stores.find((store) => store.id === storedStoreId) ??
          stores.find((store) => store.id === defaultStoreId) ??
          stores[0] ??
          null;
        writeSelectedStaffStoreId(selectedStore?.id ?? null);

        setStoresState({ stores, pendingStores, selectedStore, defaultStoreId, isStoresLoading: false, storesError: "" });
      } catch {
        if (controller.signal.aborted) return;
        setStoresState({
          stores: [],
          pendingStores: [],
          selectedStore: null,
          defaultStoreId: null,
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

  const saveStorePreferences = useCallback(
    async (preferences: StaffStorePreferences) => {
      try {
        const response = await fetch("/api/staff/store-preferences", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preferences),
        });
        const payload = (await response.json()) as { preferences?: unknown };
        if (!response.ok || !payload.preferences) return false;

        setStoresState((current) => {
          const saved = sanitizeStorePreferences(
            payload.preferences,
            current.stores.map((store) => store.id),
          );
          const stores = applyStoreOrder(current.stores, saved.order);
          const defaultStoreId = resolveDefaultStoreId(stores, saved);
          // 기본 매장을 바꾸면 활성 매장도 함께 전환한다. (대화는 매장에 고정이므로 이어 보던 대화 ID는 비운다)
          let selectedStore = current.selectedStore;
          if (defaultStoreId && defaultStoreId !== current.defaultStoreId && defaultStoreId !== selectedStore?.id) {
            selectedStore = stores.find((store) => store.id === defaultStoreId) ?? selectedStore;
            writeStaffConversationId(null);
            writeSelectedStaffStoreId(selectedStore?.id ?? null);
          }
          return { ...current, stores, defaultStoreId, selectedStore };
        });
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  // Sidebar 하단 로그아웃과 ProfileMenu 로그아웃이 같은 함수를 쓴다.
  const logout = useCallback(async () => {
    try {
      await createClient().auth.signOut();
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      writeStaffConversationId(null);
      // 다음 로그인은 기본 매장에서 시작한다.
      writeSelectedStaffStoreId(null);
      router.push("/");
    }
  }, [router]);

  const value = useMemo<StaffShellValue>(
    () => ({ userName, roleLabel, ...storesState, reloadStores, selectStore, saveStorePreferences, logout }),
    [userName, roleLabel, storesState, reloadStores, selectStore, saveStorePreferences, logout],
  );

  return <StaffShellContext.Provider value={value}>{children}</StaffShellContext.Provider>;
}

export function useStaffShell(): StaffShellValue {
  const value = useContext(StaffShellContext);
  if (!value) throw new Error("useStaffShell must be used inside StaffShellProvider");
  return value;
}
