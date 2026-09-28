// 직원이 고른 "현재 근무 매장" 저장 (client 전용, 탭 단위 sessionStorage).
// 저장값은 편의용일 뿐 권한 증명이 아니다: 화면은 항상 /api/staff/stores(승인 매장) 목록 안에 있을 때만 쓰고,
// 매장 데이터 API(RAG 등)는 서버에서 approved membership을 다시 검증한다.

export const STAFF_SELECTED_STORE_KEY = "staffSelectedStoreId";

export function readSelectedStaffStoreId(): string | null {
  try {
    return sessionStorage.getItem(STAFF_SELECTED_STORE_KEY);
  } catch {
    return null;
  }
}

export function writeSelectedStaffStoreId(storeId: string | null): void {
  try {
    if (storeId) {
      sessionStorage.setItem(STAFF_SELECTED_STORE_KEY, storeId);
    } else {
      sessionStorage.removeItem(STAFF_SELECTED_STORE_KEY);
    }
  } catch {
    // sessionStorage를 쓸 수 없는 환경에서는 선택 유지만 생략한다.
  }
}

// 새로고침 후 이어 볼 AI 대화 ID (탭 단위). 서버가 본인 대화인지 다시 확인하므로 편의용 값이다.
export const STAFF_CONVERSATION_KEY = "staffConversationId";

export function readStaffConversationId(): string | null {
  try {
    return sessionStorage.getItem(STAFF_CONVERSATION_KEY);
  } catch {
    return null;
  }
}

export function writeStaffConversationId(conversationId: string | null): void {
  try {
    if (conversationId) {
      sessionStorage.setItem(STAFF_CONVERSATION_KEY, conversationId);
    } else {
      sessionStorage.removeItem(STAFF_CONVERSATION_KEY);
    }
  } catch {
    // sessionStorage를 쓸 수 없는 환경에서는 대화 유지만 생략한다.
  }
}
