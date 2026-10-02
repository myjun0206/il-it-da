import { NextResponse } from "next/server";

import { requireServerRole } from "@/lib/auth/require-server-role";
import { createPasswordVerificationClient, verifyPasswordWithIsolatedClient } from "@/lib/auth/verify-password";
import { ensureSystemOrphanOwner } from "@/lib/owner/orphan-owner";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROFILE_AVATAR_BUCKET } from "@/lib/supabase/storage-profile-avatar";

export const runtime = "nodejs";

const STORAGE_LIST_PAGE_SIZE = 1000;

type DeleteAccountResponse = {
  success: boolean;
  code?: string;
  message: string;
};

function jsonResponse(body: DeleteAccountResponse, status: number): NextResponse<DeleteAccountResponse> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function logSafeOwnerDeleteError(code: string, error: unknown): void {
  console.error(`[BOSS_DELETE_ACCOUNT] ${code}`, {
    name: error instanceof Error ? error.name : "UnknownError",
  });
}

async function removeOwnerAvatarFiles(adminClient: ReturnType<typeof createAdminClient>, userId: string): Promise<void> {
  const bucket = adminClient.storage.from(PROFILE_AVATAR_BUCKET);
  const paths: string[] = [];

  for (let offset = 0; ; offset += STORAGE_LIST_PAGE_SIZE) {
    const { data: files, error } = await bucket.list(userId, {
      limit: STORAGE_LIST_PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;

    for (const file of files ?? []) {
      if (file.name && !file.name.includes("..") && !file.name.includes("/")) {
        paths.push(`${userId}/${file.name}`);
      }
    }
    if (!files || files.length < STORAGE_LIST_PAGE_SIZE) break;
  }

  for (let index = 0; index < paths.length; index += STORAGE_LIST_PAGE_SIZE) {
    const { error } = await bucket.remove(paths.slice(index, index + STORAGE_LIST_PAGE_SIZE));
    if (error) throw error;
  }
}

export async function POST(request: Request): Promise<NextResponse<DeleteAccountResponse>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, code: "INVALID_REQUEST", message: "요청 형식이 올바르지 않습니다." }, 400);
  }

  const currentPassword =
    body && typeof body === "object" && "currentPassword" in body ? body.currentPassword : undefined;
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return jsonResponse({ success: false, code: "PASSWORD_REQUIRED", message: "본인 확인을 위해 현재 비밀번호를 입력해주세요." }, 400);
  }

  try {
    const access = await requireServerRole("owner");
    if (access.status === "UNAUTHENTICATED") {
      return jsonResponse({ success: false, code: "UNAUTHENTICATED", message: "로그인이 필요합니다." }, 401);
    }
    if (access.status !== "AUTHORIZED") {
      return jsonResponse({ success: false, code: "FORBIDDEN", message: "점주 계정만 탈퇴할 수 있습니다." }, 403);
    }

    const adminClient = createAdminClient();
    const { data: authData, error: userLookupError } = await adminClient.auth.admin.getUserById(access.userId);
    const user = authData.user;
    if (userLookupError || !user?.email) {
      logSafeOwnerDeleteError("USER_LOOKUP_FAILED", userLookupError);
      return jsonResponse({ success: false, code: "USER_LOOKUP_FAILED", message: "계정 정보를 확인하지 못했습니다." }, 500);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      logSafeOwnerDeleteError("CONFIGURATION_MISSING", null);
      return jsonResponse({ success: false, code: "CONFIGURATION_ERROR", message: "서버 설정 오류입니다." }, 500);
    }

    const passwordIsValid = await verifyPasswordWithIsolatedClient(
      createPasswordVerificationClient(supabaseUrl, supabaseAnonKey),
      user.email,
      currentPassword,
    );
    if (!passwordIsValid) {
      return jsonResponse({ success: false, code: "INVALID_PASSWORD", message: "현재 비밀번호가 일치하지 않습니다." }, 401);
    }

    // The RPC transfers every owner profile's stores and membership audit refs in one DB transaction.
    const systemOwner = await ensureSystemOrphanOwner(adminClient);

    try {
      await removeOwnerAvatarFiles(adminClient, access.userId);
    } catch (error) {
      logSafeOwnerDeleteError("AVATAR_CLEANUP_FAILED", error);
      return jsonResponse({
        success: false,
        code: "AVATAR_CLEANUP_FAILED",
        message: "프로필 파일 정리에 실패해 계정을 삭제하지 않았습니다. 다시 시도해주세요.",
      }, 500);
    }

    const { error: transferError } = await adminClient.rpc("transfer_owner_data_to_system_account", {
      p_owner_user_id: access.userId,
      p_system_user_id: systemOwner.userId,
      p_system_profile_id: systemOwner.profileId,
    });
    if (transferError) {
      logSafeOwnerDeleteError("OWNERSHIP_TRANSFER_FAILED", transferError);
      return jsonResponse({
        success: false,
        code: "OWNERSHIP_TRANSFER_FAILED",
        message: "매장 소유권 이전에 실패해 계정을 삭제하지 않았습니다. 관리자에게 문의해주세요.",
      }, 500);
    }

    // Auth Admin API uses a separate transaction from Postgres RPC. Ownership transfer commits first;
    // if Auth deletion fails, the owner can retry and the store/manual data remains intact.
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(access.userId);
    if (deleteError) {
      logSafeOwnerDeleteError("AUTH_DELETE_FAILED", deleteError);
      return jsonResponse({
        success: false,
        code: "AUTH_DELETE_FAILED",
        message: "매장과 매뉴얼은 보존 계정으로 이전했지만 회원 탈퇴를 완료하지 못했습니다. 다시 시도해주세요.",
      }, 500);
    }

    return jsonResponse({ success: true, message: "회원 탈퇴가 완료되었습니다. 매장과 매뉴얼 데이터는 보존되었습니다." }, 200);
  } catch (error) {
    logSafeOwnerDeleteError("UNEXPECTED_ERROR", error);
    return jsonResponse({ success: false, code: "INTERNAL_ERROR", message: "회원 탈퇴 처리 중 오류가 발생했습니다." }, 500);
  }
}