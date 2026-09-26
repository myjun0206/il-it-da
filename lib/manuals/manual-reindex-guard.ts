/**
 * 재처리(재색인) 직전에 서버가 다시 확인하는 조건. 클라이언트가 보낸
 * franchiseId/storeId/scopeType은 쓰지 않고, DB에서 읽은 매뉴얼 행과 인증으로 확정된
 * 범위만 비교한다. 순수 함수라 실제 DB 없이 그대로 실행해 검증할 수 있다.
 */

export type ReindexRejectionReason =
  | "not_found"
  | "parent_card"
  | "not_approved"
  | "out_of_scope";

export interface ReindexManualRow {
  id: string;
  status: string;
  franchise_id: string | null;
  store_id: string | null;
}

export type ReindexScope =
  | { kind: "hq"; franchiseId: string | null }
  | { kind: "store"; storeId: string };

export type ReindexDecision = { allowed: true } | { allowed: false; reason: ReindexRejectionReason };

export function checkManualReindexAllowed(
  manual: ReindexManualRow | null | undefined,
  scope: ReindexScope,
  hasChildren: boolean,
): ReindexDecision {
  if (!manual) {
    return { allowed: false, reason: "not_found" };
  }
  // 실제 자식을 거느린 주제 카드만 거부한다. parent_manual_id가 null이어도 자식이 없으면
  // 그 자체가 검색되는 단독 매뉴얼이므로 재처리 대상이다.
  if (hasChildren) {
    return { allowed: false, reason: "parent_card" };
  }
  if (manual.status !== "approved") {
    return { allowed: false, reason: "not_approved" };
  }

  if (scope.kind === "store") {
    return manual.store_id === scope.storeId
      ? { allowed: true }
      : { allowed: false, reason: "out_of_scope" };
  }

  // HQ 공통 매뉴얼은 store 전용이 아니어야 하고(018의 hq 조건과 동일), 같은 franchise여야 한다.
  // franchiseId가 없는 레거시 HQ 계정은 범위를 특정할 수 없으므로 fail-closed 한다.
  if (manual.store_id !== null || !scope.franchiseId || manual.franchise_id !== scope.franchiseId) {
    return { allowed: false, reason: "out_of_scope" };
  }

  return { allowed: true };
}

/** 원본 DB/OpenAI 오류 대신 사용자에게 보여줄 고정 문구. */
export const REINDEX_REJECTION_MESSAGES: Record<ReindexRejectionReason, string> = {
  not_found: "해당 매뉴얼을 찾을 수 없어요.",
  parent_card: "상위 항목은 검색 준비 대상이 아니에요.",
  not_approved: "아직 검색 대상이 아닌 매뉴얼이에요.",
  out_of_scope: "이 매뉴얼에 대한 권한이 없어요.",
};

export const REINDEX_FAILED_MESSAGE = "검색 준비를 다시 하지 못했어요. 잠시 후 다시 시도해 주세요.";

export const REINDEX_STATUS_BY_REASON: Record<ReindexRejectionReason, number> = {
  not_found: 404,
  parent_card: 400,
  not_approved: 400,
  out_of_scope: 403,
};
