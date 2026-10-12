// HQ가 고른 "현재 기본 매장" 저장 (client 전용, 탭 단위 sessionStorage).
// 저장값은 편의용일 뿐 권한 증명이 아니다: 화면은 항상 /api/hq/stores(접근 가능 매장) 목록 안에 있을 때만 쓰고,
// 매장 데이터 API는 서버에서 HQ 권한을 다시 검증한다.

export const HQ_SELECTED_STORE_KEY = "hqSelectedStoreId";

export function readSelectedHqStoreId(): string | null {
  try {
    return sessionStorage.getItem(HQ_SELECTED_STORE_KEY);
  } catch {
    return null;
  }
}

export function writeSelectedHqStoreId(storeId: string | null): void {
  try {
    if (storeId) {
      sessionStorage.setItem(HQ_SELECTED_STORE_KEY, storeId);
    } else {
      sessionStorage.removeItem(HQ_SELECTED_STORE_KEY);
    }
  } catch {
    // sessionStorage를 쓸 수 없는 환경에서는 선택 유지만 생략한다.
  }
}
