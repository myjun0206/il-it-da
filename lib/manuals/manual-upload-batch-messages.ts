import type { ClaimBatchResult } from "@/lib/manuals/manual-upload-batch";

/** 내부 hash/batch id/UUID/DB 오류는 절대 담지 않는 고정 문구. */
export const DUPLICATE_CONTENT_MESSAGE =
  "이미 같은 내용의 매뉴얼이 등록되어 있어요. 기존 매뉴얼을 확인하거나 내용을 수정한 뒤 다시 시도해 주세요.";
export const PROCESSING_MESSAGE = "매뉴얼을 저장하고 있어요. 잠시 후 목록에서 확인해 주세요.";
export const NEEDS_RECOVERY_MESSAGE =
  "이전 저장이 끝나지 않았어요. 매뉴얼 목록을 확인한 뒤 담당자에게 문의해 주세요.";
export const REJECTED_MESSAGE = "저장 요청 정보가 올바르지 않아요. 파일을 다시 올려 주세요.";
export const MISSING_KEY_MESSAGE = "저장 요청 정보가 만료됐어요. 파일을 다시 올려 주세요.";

export type BlockedClaimKind = Exclude<ClaimBatchResult["kind"], "claimed" | "already_completed">;

/** 중복/처리 중은 모두 409, 잘못된 요청 정보는 400. 저장이 실패한 것이 아니므로 500을 쓰지 않는다. */
export const CLAIM_BLOCKED_RESPONSES: Record<BlockedClaimKind, { status: number; error: string }> = {
  duplicate_content: { status: 409, error: DUPLICATE_CONTENT_MESSAGE },
  processing: { status: 409, error: PROCESSING_MESSAGE },
  needs_recovery: { status: 409, error: NEEDS_RECOVERY_MESSAGE },
  rejected: { status: 400, error: REJECTED_MESSAGE },
};
