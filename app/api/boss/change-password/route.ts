import { NextResponse } from "next/server";

import { createPasswordVerificationClient, verifyPasswordWithIsolatedClient } from "@/lib/auth/verify-password";
import { requireServerRole } from "@/lib/auth/require-server-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const PASSWORD_MIN_LENGTH = 8;

type ChangePasswordResponse = {
  success: boolean;
  code?: string;
  message?: string;
};

function jsonResponse(body: ChangePasswordResponse, status: number): NextResponse<ChangePasswordResponse> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function logSafePasswordChangeError(code: string, error: unknown): void {
  console.error(`[BOSS_PASSWORD_CHANGE] ${code}`, {
    name: error instanceof Error ? error.name : "UnknownError",
  });
}

export async function POST(request: Request): Promise<NextResponse<ChangePasswordResponse>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, code: "INVALID_REQUEST", message: "요청 형식이 올바르지 않습니다." }, 400);
  }

  const currentPassword =
    body && typeof body === "object" && "currentPassword" in body ? body.currentPassword : undefined;
  const newPassword =
    body && typeof body === "object" && "newPassword" in body ? body.newPassword : undefined;

  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return jsonResponse({ success: false, code: "MISSING_CURRENT_PASSWORD", message: "현재 비밀번호를 입력해주세요." }, 400);
  }
  if (typeof newPassword !== "string" || newPassword.length === 0) {
    return jsonResponse({ success: false, code: "MISSING_NEW_PASSWORD", message: "새 비밀번호를 입력해주세요." }, 400);
  }
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return jsonResponse({
      success: false,
      code: "WEAK_PASSWORD",
      message: `새 비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`,
    }, 400);
  }
  if (currentPassword === newPassword) {
    return jsonResponse({ success: false, code: "PASSWORD_UNCHANGED", message: "새 비밀번호는 현재 비밀번호와 달라야 합니다." }, 400);
  }

  try {
    const access = await requireServerRole("owner");
    if (access.status === "UNAUTHENTICATED") {
      return jsonResponse({ success: false, code: "UNAUTHENTICATED", message: "로그인이 만료되었습니다. 다시 로그인해주세요." }, 401);
    }
    if (access.status !== "AUTHORIZED") {
      return jsonResponse({ success: false, code: "FORBIDDEN", message: "점주 계정만 비밀번호를 변경할 수 있습니다." }, 403);
    }

    const adminClient = createAdminClient();
    const { data: authData, error: authError } = await adminClient.auth.admin.getUserById(access.userId);
    const email = authData.user?.email;
    if (authError || !email) {
      logSafePasswordChangeError("USER_LOOKUP_FAILED", authError);
      return jsonResponse({ success: false, code: "USER_LOOKUP_FAILED", message: "계정 정보를 확인하지 못했습니다." }, 500);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      logSafePasswordChangeError("CONFIGURATION_MISSING", null);
      return jsonResponse({ success: false, code: "CONFIGURATION_ERROR", message: "서버 설정 오류입니다." }, 500);
    }

    const isCurrentPasswordValid = await verifyPasswordWithIsolatedClient(
      createPasswordVerificationClient(supabaseUrl, supabaseAnonKey),
      email,
      currentPassword,
    );
    if (!isCurrentPasswordValid) {
      return jsonResponse({ success: false, code: "INVALID_CURRENT_PASSWORD", message: "현재 비밀번호가 일치하지 않습니다." }, 401);
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(access.userId, {
      password: newPassword,
    });
    if (updateError) {
      logSafePasswordChangeError("PASSWORD_UPDATE_FAILED", updateError);
      return jsonResponse({ success: false, code: "PASSWORD_UPDATE_FAILED", message: "비밀번호 변경에 실패했습니다. 다시 시도해주세요." }, 500);
    }

    return jsonResponse({ success: true, message: "비밀번호가 변경되었습니다." }, 200);
  } catch (error) {
    logSafePasswordChangeError("UNEXPECTED_ERROR", error);
    return jsonResponse({ success: false, code: "INTERNAL_ERROR", message: "비밀번호 변경 중 오류가 발생했습니다." }, 500);
  }
}