// 점주 화면 공통 "현재 매장" 결정 로직 (client 전용).
//
// authenticated owner → store_memberships(role=owner, status=approved) → stores
// 흐름은 /api/signup/store-membership(서버, 로그인 사용자 본인 membership만 조회)가 담당하고,
// 여기서는 승인된 점주 매장 중 sessionStorage에 저장된 선택값이 유효하면 그것을, 아니면 첫 매장을 고른다.
// 매장명이나 브랜드명으로 매장을 추측하지 않는다.

export interface OwnerStore {
  storeId: string;
  storeName: string;
}

export type OwnerStoreResolution =
  | { status: "ready"; stores: OwnerStore[]; current: OwnerStore | null }
  | { status: "error" };

const SELECTED_STORE_ID_KEY = "selectedStoreId";
const SELECTED_STORE_NAME_KEY = "selectedStoreName";

interface MembershipResponse {
  success?: boolean;
  data?: Array<{ storeId: string; storeName: string; status: string; role: string }>;
}

function readStoredStoreId(): string | null {
  try {
    return sessionStorage.getItem(SELECTED_STORE_ID_KEY);
  } catch {
    return null;
  }
}

/** 선택 매장을 sessionStorage에 반영한다. null이면 이전 선택값을 지운다. */
export function persistSelectedStore(store: OwnerStore | null): void {
  try {
    if (store) {
      sessionStorage.setItem(SELECTED_STORE_ID_KEY, store.storeId);
      sessionStorage.setItem(SELECTED_STORE_NAME_KEY, store.storeName);
    } else {
      sessionStorage.removeItem(SELECTED_STORE_ID_KEY);
      sessionStorage.removeItem(SELECTED_STORE_NAME_KEY);
    }
  } catch {
    // sessionStorage를 쓸 수 없는 환경에서는 선택값 유지만 생략한다.
  }
}

export async function resolveOwnerCurrentStore(): Promise<OwnerStoreResolution> {
  try {
    const response = await fetch("/api/signup/store-membership", { credentials: "include" });
    const result = (await response.json()) as MembershipResponse;

    if (!response.ok || !result.success || !Array.isArray(result.data)) {
      return { status: "error" };
    }

    const stores: OwnerStore[] = result.data
      .filter((membership) => membership.status === "approved" && membership.role === "owner")
      .map(({ storeId, storeName }) => ({ storeId, storeName }));

    const storedStoreId = readStoredStoreId();
    const current = stores.find((store) => store.storeId === storedStoreId) ?? stores[0] ?? null;
    persistSelectedStore(current);

    return { status: "ready", stores, current };
  } catch (error) {
    console.error("Failed to resolve owner store:", error);
    return { status: "error" };
  }
}
