/**
 * 점주의 "직원 소속 해제" (DELETE /api/boss/employees/[id]).
 *
 * 점주 권한 확인 → 대상 검증 → 멤버십 삭제 → 마스터 승인 상태 재계산을 035의
 * remove_staff_membership_by_owner RPC 한 번(한 트랜잭션)으로 처리한다.
 * 앱 코드에서 삭제와 프로필 갱신을 나눠 실행하던 방식은 한쪽만 반영된 불일치를 남길 수 있어 쓰지 않는다.
 * 035가 적용되지 않은 DB에서는 그 방식으로 되돌아가지 않고 "기능 준비 중"(503)을 돌려준다.
 *
 * - 행을 삭제하므로 해제된 직원은 같은 매장에 다시 신청할 수 있다(새 행·새 id).
 * - 오래된 요청은 id가 다른 새 멤버십을 지우지 않는다.
 * - 직원 Auth 계정·아바타·다른 매장 멤버십·대화 행·공유 데이터는 건드리지 않는다.
 * - 권한·대상은 세션 사용자와 DB 조회로만 판단한다. 클라이언트가 보낸 사용자 id는 받지 않는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const REMOVE_STAFF_MEMBERSHIP_RPC = "remove_staff_membership_by_owner";

export type RemoveStaffMembershipCode =
  | "INVALID_REQUEST"
  | "FORBIDDEN"
  | "NOT_STAFF"
  | "NOT_APPROVED"
  | "SELF_REMOVAL"
  | "PROFILE_MISSING"
  | "FEATURE_UNAVAILABLE"
  | "SERVER_ERROR";

export type RemoveStaffMembershipResult =
  | {
      status: 200;
      body: {
        success: true;
        /** true면 이번 요청 전에 이미 해제돼 있었다(중복 클릭·재시도·오래된 요청). */
        alreadyRemoved: boolean;
      };
    }
  | {
      status: 400 | 403 | 409 | 500 | 503;
      body: {
        success: false;
        error: string;
        code: RemoveStaffMembershipCode;
        /** false: 트랜잭션이 롤백돼 소속·승인 상태가 그대로다. null: DB 응답을 받지 못해 결과를 알 수 없다. */
        removed: false | null;
      };
    };

export interface RemoveStaffMembershipInput {
  /** 세션에서만 온다. */
  ownerUserId: string;
  /** URL의 멤버십 id. RPC가 store_id·role·status로 다시 확인한다. */
  membershipId: string;
  /** 점주가 보고 있는 매장. 점주 권한 검증과 조회·삭제 범위에 모두 쓴다. */
  storeId: string;
}

function failure(
  status: 400 | 403 | 409 | 500 | 503,
  code: RemoveStaffMembershipCode,
  error: string,
  removed: false | null = false,
): RemoveStaffMembershipResult {
  return { status, body: { success: false, error, code, removed } };
}

function logSafe(code: string, error: unknown): void {
  const name = error instanceof Error ? error.name : "UnknownError";
  const dbCode = (error as { code?: unknown } | null)?.code;
  console.error(`[OWNER_REMOVE_STAFF] ${code}`, { name, dbCode: typeof dbCode === "string" ? dbCode : undefined });
}

/** 035 미적용(함수 없음)인지. PostgREST는 PGRST202, Postgres는 42883을 쓴다. */
export function isMissingRemoveStaffRpc(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "PGRST202" || code === "42883";
}

type RpcError = { code?: string; message?: string } | null;

const UNCERTAIN_MESSAGE =
  "소속 해제 결과를 확인하지 못했습니다. 목록을 새로고침해 확인한 뒤, 필요하면 다시 시도해 주세요(이미 해제됐다면 중복으로 처리되지 않습니다).";

/**
 * Postgres가 직접 돌려준 SQLSTATE라서 함수 트랜잭션이 롤백됐다고 확정할 수 있는지.
 * PGRST*(PostgREST 자체 오류), 코드 없음(네트워크·게이트웨이 응답), 연결 예외(08)·종료(57P0x)는
 * 커밋 여부를 확정할 수 없으므로 false.
 */
function isDefiniteRollback(code: unknown): boolean {
  if (typeof code !== "string" || !/^[0-9A-Z]{5}$/.test(code)) return false;
  if (code.startsWith("08") || code.startsWith("57P0")) return false;
  return true;
}

function mapRpcError(error: RpcError): RemoveStaffMembershipResult {
  if (isMissingRemoveStaffRpc(error)) {
    // 함수가 없어 아무것도 실행되지 않았다.
    return failure(503, "FEATURE_UNAVAILABLE", "직원 소속 해제 기능이 아직 준비되지 않았습니다. 관리자에게 문의해 주세요.");
  }
  const message = typeof error?.message === "string" ? error.message : "";
  if (error?.code === "P0001" && message.includes("STAFF_PROFILE_")) {
    logSafe("PROFILE_MISSING", error);
    return failure(500, "PROFILE_MISSING", "직원 계정 정보를 찾지 못해 소속을 해제하지 않았습니다. 관리자에게 문의해 주세요.");
  }
  if (error?.code === "22P02") {
    return failure(400, "INVALID_REQUEST", "유효하지 않은 요청입니다.");
  }
  logSafe("RPC_FAILED", error);
  if (isDefiniteRollback(error?.code)) {
    return failure(500, "SERVER_ERROR", "소속 해제 중 오류가 발생해 아무것도 변경하지 않았습니다. 다시 시도해 주세요.");
  }
  return failure(500, "SERVER_ERROR", UNCERTAIN_MESSAGE, null);
}

export async function removeStaffMembershipByOwner(
  adminClient: SupabaseClient,
  input: RemoveStaffMembershipInput,
): Promise<RemoveStaffMembershipResult> {
  const ownerUserId = input.ownerUserId?.trim();
  const membershipId = input.membershipId?.trim();
  const storeId = input.storeId?.trim();

  if (!ownerUserId || !membershipId || !storeId) {
    return failure(400, "INVALID_REQUEST", "유효하지 않은 요청입니다.");
  }

  let data: unknown;
  let error: RpcError;
  try {
    ({ data, error } = await adminClient.rpc(REMOVE_STAFF_MEMBERSHIP_RPC, {
      p_owner_user_id: ownerUserId,
      p_membership_id: membershipId,
      p_store_id: storeId,
    }));
  } catch (e) {
    logSafe("RPC_THREW", e);
    return failure(500, "SERVER_ERROR", UNCERTAIN_MESSAGE, null);
  }

  if (error) return mapRpcError(error);

  switch (data) {
    case "removed":
      return { status: 200, body: { success: true, alreadyRemoved: false } };
    case "already_removed":
      return { status: 200, body: { success: true, alreadyRemoved: true } };
    case "forbidden":
      return failure(403, "FORBIDDEN", "이 매장의 직원을 관리할 권한이 없습니다.");
    case "not_staff":
      return failure(400, "NOT_STAFF", "직원 소속만 해제할 수 있습니다.");
    case "self_removal":
      return failure(400, "SELF_REMOVAL", "본인의 소속은 해제할 수 없습니다.");
    case "not_approved":
      return failure(409, "NOT_APPROVED", "근무 중인 직원만 소속을 해제할 수 있습니다. 목록을 새로고침해 주세요.");
    case "invalid_request":
      return failure(400, "INVALID_REQUEST", "유효하지 않은 요청입니다.");
    default:
      logSafe("RPC_UNEXPECTED_RESULT", null);
      return failure(500, "SERVER_ERROR", UNCERTAIN_MESSAGE, null);
  }
}
