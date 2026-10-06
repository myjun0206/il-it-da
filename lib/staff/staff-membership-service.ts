import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMasterApprovalUpdate } from "@/lib/signup/approval-recovery";
import { PROFILE_AVATAR_BUCKET } from "@/lib/supabase/storage-profile-avatar";

const STORAGE_LIST_PAGE_SIZE = 1000;

/**
 * 사용자가 비밀번호 로그인 가능한 계정(이메일/비밀번호)을 보유하고 있는지 판별한다.
 * identities에 email이 있거나 app_metadata에 email provider가 포함되어 있는지 확인한다.
 */
export function hasPasswordLogin(user: {
  identities?: Array<{ provider?: string }> | null;
  app_metadata?: { provider?: string; providers?: string[] } | null;
}): boolean {
  const identities = user.identities ?? [];
  const providers = [
    ...identities.map((i) => i.provider),
    ...(user.app_metadata?.providers ?? []),
    user.app_metadata?.provider,
  ].filter((p): p is string => typeof p === "string");

  return providers.includes("email");
}

/**
 * 탈퇴 또는 로그아웃 시 직원의 로컬 세션스토리지 키만 선택적으로 정리한다.
 * sessionStorage.clear()를 호출해 무관한 탭/브라우저 상태까지 지우지 않는다.
 */
export function clearStaffSessionKeys(userId?: string | null): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.removeItem("staffSelectedStoreId");
    sessionStorage.removeItem("staffConversationId");
    sessionStorage.removeItem("staffStoreEditDraft");
    sessionStorage.removeItem("signupStoreApprovals");
    sessionStorage.removeItem("pendingStores");
    if (userId) {
      sessionStorage.removeItem(`ilitda.escalationPopupSeen:${userId}`);
    }
  } catch {
    // sessionStorage 접근 불가 환경 무시
  }
}

export interface WithdrawStaffMembershipInput {
  userId: string;
  /** membershipId (storeId는 구 클라이언트 호환용) */
  identifier: string;
}

/**
 * 남은 멤버십을 기준으로 마스터 profiles.approval_status를 다시 계산해 저장한다.
 * 조회 실패를 빈 목록으로 바꾸지 않는다(그러면 승인 매장이 있는데도 rejected로 기록된다). 실패하면 throw.
 */
export async function syncStaffMasterApprovalStatus(adminClient: SupabaseClient, userId: string): Promise<void> {
  const { data: remainingMemberships, error: remainingError } = await adminClient
    .from("store_memberships")
    .select("id, status, approved_at, approved_by")
    .eq("user_id", userId);

  if (remainingError) throw remainingError;

  const { error: profileUpdateError } = await adminClient
    .from("profiles")
    .update(buildMasterApprovalUpdate(remainingMemberships ?? []))
    .eq("id", userId);

  if (profileUpdateError) throw profileUpdateError;
}

export type WithdrawStaffMembershipResult =
  | {
      success: true;
      status: 200;
      deletedMembershipId: string;
      storeId: string;
    }
  | {
      success: false;
      status: 400 | 404 | 409 | 500;
      error: string;
      code?: "NOT_FOUND" | "NOT_PENDING" | "NOT_APPROVED" | "INVALID_STATUS" | "AMBIGUOUS_IDENTIFIER";
    };

/**
 * 직원 본인의 근무 매장 신청을 취소하거나 승인된 근무 매장에서 해제(탈퇴)한다.
 * - 로그인 사용자 본인의 membership이어야 하고 (user_id = auth user)
 * - role = staff
 * - status = pending (신청 취소) 또는 status = approved (근무 매장 해제)
 * - identifier는 membershipId가 계약이며, storeId는 호환용으로만 허용한다 (모호하면 400 AMBIGUOUS_IDENTIFIER).
 * - 탈퇴 후 마스터 profiles.approval_status를 남은 멤버십 상태에 맞게 동기화한다.
 * - 부분 실패(동기화 누락) 시 재요청으로 마스터 상태를 복구할 수 있다.
 * - 마지막 매장을 탈퇴해도 회원 계정은 삭제하지 않는다.
 */
export async function withdrawStaffMembership(
  adminClient: SupabaseClient,
  input: WithdrawStaffMembershipInput,
): Promise<WithdrawStaffMembershipResult> {
  const { userId, identifier } = input;

  if (!identifier || typeof identifier !== "string" || !identifier.trim()) {
    return {
      success: false,
      status: 400,
      error: "매장 식별자가 올바르지 않습니다.",
      code: "NOT_FOUND",
    };
  }

  const trimmedId = identifier.trim();

  // 1. 기본 계약은 membershipId. storeId는 구 클라이언트 호환용이며,
  //    같은 값이 한 행의 id이면서 다른 행의 store_id로도 매칭되면 모호하므로 거절한다.
  type MembershipLookupRow = { id: string; user_id: string; store_id: string; role: string; status: string };

  const [byIdResult, byStoreResult] = await Promise.all([
    adminClient
      .from("store_memberships")
      .select("id, user_id, store_id, role, status")
      .eq("id", trimmedId)
      .eq("user_id", userId)
      .eq("role", "staff")
      .maybeSingle<MembershipLookupRow>(),
    adminClient
      .from("store_memberships")
      .select("id, user_id, store_id, role, status")
      .eq("store_id", trimmedId)
      .eq("user_id", userId)
      .eq("role", "staff")
      .maybeSingle<MembershipLookupRow>(),
  ]);

  if (byIdResult.error || byStoreResult.error) {
    return { success: false, status: 500, error: "요청을 처리하지 못했습니다." };
  }

  const byMembershipId = byIdResult.data;
  const byStoreId = byStoreResult.data;

  if (byMembershipId && byStoreId && byMembershipId.id !== byStoreId.id) {
    return {
      success: false,
      status: 400,
      error: "매장 식별자가 모호합니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
      code: "AMBIGUOUS_IDENTIFIER",
    };
  }

  const membership: MembershipLookupRow | null = byMembershipId ?? byStoreId;

  if (!membership) {
    // 복구: 이전 시도에서 멤버십은 삭제되었으나 프로필 동기화가 누락된 경우,
    // 재요청으로 남은 멤버십을 기준으로 마스터 프로필 상태를 복구한다.
    try {
      await syncStaffMasterApprovalStatus(adminClient, userId);
    } catch (syncError) {
      console.error("[STAFF_MEMBERSHIP_WITHDRAW] Profile sync recovery error:", syncError);
    }

    return {
      success: false,
      status: 404,
      error: "신청 내역 또는 근무 매장을 찾을 수 없습니다.",
      code: "NOT_FOUND",
    };
  }

  // pending 또는 approved만 삭제 가능
  if (membership.status !== "pending" && membership.status !== "approved") {
    const errorCode =
      membership.status === "approved" ? "NOT_APPROVED" : ("INVALID_STATUS" as const);
    return {
      success: false,
      status: 409,
      error:
        membership.status === "pending"
          ? "승인 대기 중인 신청만 취소할 수 있습니다."
          : "이 근무 매장을 해제할 수 없습니다.",
      code: errorCode,
    };
  }

  // 2. 삭제 시점에 상태가 변경되지 않았는지 확인하며 원자적 삭제
  const { data: deleted, error: deleteError } = await adminClient
    .from("store_memberships")
    .delete()
    .eq("id", membership.id)
    .eq("user_id", userId)
    .eq("role", "staff")
    .in("status", ["pending", "approved"])
    .select("id");

  if (deleteError) {
    return { success: false, status: 500, error: "요청을 처리하지 못했습니다." };
  }

  if (!deleted || deleted.length === 0) {
    return {
      success: false,
      status: 409,
      error: "이 매장을 더 이상 해제할 수 없습니다. (상태 변경됨)",
      code: "INVALID_STATUS",
    };
  }

  // 3. 마스터 profiles.approval_status 동기화 (기존 공통 규칙 반영)
  try {
    await syncStaffMasterApprovalStatus(adminClient, userId);
  } catch (syncError) {
    console.error("[STAFF_MEMBERSHIP_DELETE] Profile status sync error:", syncError);
    return {
      success: false,
      status: 500,
      error: "근무 매장은 해제되었으나 프로필 상태 동기화에 실패했습니다. 다시 시도해 주세요.",
    };
  }

  return {
    success: true,
    status: 200,
    deletedMembershipId: membership.id,
    storeId: membership.store_id,
  };
}

export interface DeleteStaffAccountInput {
  userId: string;
}

export type DeleteStaffAccountResult =
  | {
      success: true;
      status: 200;
      message: string;
    }
  | {
      success: false;
      status: 401 | 403 | 404 | 500;
      error: string;
      code?: string;
    };

/**
 * 직원 본인의 회원 탈퇴 (계정 삭제).
 * - 세션 사용자 본인만 탈퇴 가능
 * - profiles.role === 'staff' 직원 전용 (점주·본사 계정은 차단)
 * - Storage 아바타 파일을 Auth 삭제 전에 먼저 정리한다 (storage.objects.owner FK에 의한 Auth 삭제 차단 방지)
 * - 아바타 경로는 서버에서 검증해 `${userId}/` 하위 파일만 안전하게 제거하며, 타 사용자 파일은 절대 건드리지 않는다
 * - Storage 정리 후 Auth 삭제가 실패하면 명확한 오류를 반환해 재시도 가능하게 한다
 * - auth.admin.deleteUser(userId)를 통해 auth.users 삭제
 * - DB FK ON DELETE CASCADE에 의해 profiles, store_memberships, conversations,
 *   conversation_messages, notifications가 연쇄 자동 삭제된다
 * - question_logs(질문 로그), manuals(공유 매뉴얼), stores(매장), notices(공지)는 안전하게 보존된다
 */
export async function deleteStaffAccount(
  adminClient: SupabaseClient,
  input: DeleteStaffAccountInput,
): Promise<DeleteStaffAccountResult> {
  const { userId } = input;

  if (!userId || typeof userId !== "string" || !userId.trim()) {
    return {
      success: false,
      status: 401,
      code: "UNAUTHORIZED",
      error: "로그인이 필요합니다.",
    };
  }

  // 1. 직원 전용 권한 검증 (점주/본사 계정은 이 API로 탈퇴 불가)
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role, avatar_url")
    .eq("id", userId)
    .maybeSingle<{ role: string; avatar_url: string | null }>();

  if (profileError) {
    return {
      success: false,
      status: 500,
      code: "QUERY_ERROR",
      error: "사용자 정보를 확인하지 못했습니다.",
    };
  }

  if (!profile) {
    return {
      success: false,
      status: 404,
      code: "NOT_FOUND",
      error: "사용자 프로필을 찾을 수 없습니다.",
    };
  }

  if (profile.role !== "staff") {
    return {
      success: false,
      status: 403,
      code: "FORBIDDEN",
      error: "직원 계정만 회원 탈퇴할 수 있습니다.",
    };
  }

  // 2. Storage 아바타 파일 정리 (Auth 삭제 전에 먼저 실행)
  // 정책: 조회·삭제 중 하나라도 실패하면 계정을 삭제하지 않고 재시도 가능한 오류를 반환한다.
  // (계정을 먼저 지우면 남은 개인 파일을 본인이 다시 정리할 경로가 사라진다.)
  // 서버 검증: 반드시 본인의 userId 폴더 내 파일만 삭제하며, 타 사용자 경로는 절대 삭제하지 않는다.
  const storageFailure = {
    success: false,
    status: 500,
    code: "STORAGE_CLEANUP_FAILED",
    error: "프로필 파일 정리에 실패해 계정을 삭제하지 않았습니다. 잠시 후 다시 시도해 주세요.",
  } as const;

  const bucket = adminClient.storage.from(PROFILE_AVATAR_BUCKET);
  const safePaths: string[] = [];
  try {
    // list()의 기본 limit(100)에 걸려 파일이 남지 않도록 끝까지 페이지를 넘긴다.
    for (let offset = 0; ; offset += STORAGE_LIST_PAGE_SIZE) {
      const { data: files, error: listError } = await bucket.list(userId, {
        limit: STORAGE_LIST_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (listError) throw listError;

      for (const file of files ?? []) {
        if (file.name && !file.name.includes("..") && !file.name.includes("/")) {
          safePaths.push(`${userId}/${file.name}`);
        }
      }
      if (!files || files.length < STORAGE_LIST_PAGE_SIZE) break;
    }

    for (let i = 0; i < safePaths.length; i += STORAGE_LIST_PAGE_SIZE) {
      const { error: removeError } = await bucket.remove(safePaths.slice(i, i + STORAGE_LIST_PAGE_SIZE));
      if (removeError) throw removeError;
    }
  } catch (storageError) {
    console.error("[STAFF_DELETE_ACCOUNT] Storage cleanup failed; account not deleted:", storageError);
    return storageFailure;
  }
  const storageCleaned = safePaths.length > 0;

  // 3. Auth 사용자 삭제 (CASCADE로 DB 행들 연쇄 삭제됨)
  const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(userId);

  if (deleteUserError) {
    console.error("[STAFF_DELETE_ACCOUNT] Delete user failed:", deleteUserError.message);
    return {
      success: false,
      status: 500,
      code: "DELETE_FAILED",
      error: storageCleaned
        ? "계정 삭제에 실패했습니다. 프로필 파일은 정리되었으니 잠시 후 다시 시도해 주세요."
        : "계정 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  return {
    success: true,
    status: 200,
    message: "회원 탈퇴가 완료되었습니다.",
  };
}
