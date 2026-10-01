// 직원 근무 매장 개인 설정 (기본 매장 + 표시 순서). 순수 로직만 둔다 (server/client 공용).
//
// - 기본 매장: 사용자가 지정한 대표 근무 매장. 로그인 직후 활성 매장의 초깃값이 된다.
// - 표시 순서: 근무 매장 목록/매장 선택에 쓰는 사용자 지정 순서. 기본 매장 지정과 별개로 관리한다.
// 두 값 모두 "승인 완료된 근무 매장" 안에서만 의미가 있고, 권한 증명이 아니다.
// (매장 데이터 API는 항상 서버에서 approved membership을 다시 검증한다.)

export const STAFF_STORE_PREFERENCES_KEY = "staffStorePreferences";

export interface StaffStorePreferences {
  defaultStoreId: string | null;
  order: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 저장된 값(또는 요청값)을 승인 매장 범위로 정리한다. 승인 매장이 아닌 id는 버린다. */
export function sanitizeStorePreferences(raw: unknown, approvedStoreIds: readonly string[]): StaffStorePreferences {
  const approved = new Set(approvedStoreIds);
  const record = isRecord(raw) ? raw : {};

  const order: string[] = [];
  if (Array.isArray(record.order)) {
    for (const id of record.order) {
      if (typeof id === "string" && approved.has(id) && !order.includes(id)) order.push(id);
    }
  }

  const defaultStoreId =
    typeof record.defaultStoreId === "string" && approved.has(record.defaultStoreId) ? record.defaultStoreId : null;

  return { defaultStoreId, order };
}

/** 사용자 지정 순서대로 정렬한다. 순서에 없는 매장(새로 승인된 매장 등)은 기존 순서를 유지한 채 뒤에 붙인다. */
export function applyStoreOrder<T extends { id: string }>(stores: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return stores
    .map((store, index) => ({ store, index }))
    .sort((a, b) => {
      const rankA = rank.get(a.store.id);
      const rankB = rank.get(b.store.id);
      if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
      if (rankA !== undefined) return -1;
      if (rankB !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ store }) => store);
}

/** 기본 매장: 지정값이 승인 매장이면 그 매장, 아니면 표시 순서상 첫 매장. */
export function resolveDefaultStoreId(stores: readonly { id: string }[], preferences: StaffStorePreferences): string | null {
  if (preferences.defaultStoreId && stores.some((store) => store.id === preferences.defaultStoreId)) {
    return preferences.defaultStoreId;
  }
  return stores[0]?.id ?? null;
}
