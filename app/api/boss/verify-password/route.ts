import { NextResponse } from "next/server";

import { requireServerRole } from "@/lib/auth/require-server-role";
import { createPasswordVerificationClient, verifyPasswordWithIsolatedClient } from "@/lib/auth/verify-password";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type VerifyPasswordResponse = {
  success: boolean;
  code?: string;
  message?: string;
};

function jsonResponse(body: VerifyPasswordResponse, status: number): NextResponse<VerifyPasswordResponse> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function logSafePasswordVerificationError(code: string, error: unknown): void {
  console.error(`[BOSS_PASSWORD_VERIFY] ${code}`, {
    name: error instanceof Error ? error.name : "UnknownError",
  });
}

export async function POST(request: Request): Promise<NextResponse<VerifyPasswordResponse>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, code: "INVALID_REQUEST", message: "요청 형식이 올바르지 않습니다." }, 400);
  }

  const currentPassword =
    body && typeof body === "object" && "currentPassword" in body ? body.currentPassword : undefined;
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return jsonResponse({ success: false, code: "MISSING_CURRENT_PASSWORD", message: "현재 비밀번호를 입력해주세요." }, 400);
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
      logSafePasswordVerificationError("USER_LOOKUP_FAILED", authError);
      return jsonResponse({ success: false, code: "USER_LOOKUP_FAILED", message: "계정 정보를 확인하지 못했습니다." }, 500);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      logSafePasswordVerificationError("CONFIGURATION_MISSING", null);
      return jsonResponse({ success: false, code: "CONFIGURATION_ERROR", message: "서버 설정 오류입니다." }, 500);
    }

    const isValid = await verifyPasswordWithIsolatedClient(
      createPasswordVerificationClient(supabaseUrl, supabaseAnonKey),
      email,
      currentPassword,
    );
    if (!isValid) {
      return jsonResponse({ success: false, code: "INVALID_CURRENT_PASSWORD", message: "현재 비밀번호가 일치하지 않습니다." }, 401);
    }

    return jsonResponse({ success: true, message: "현재 비밀번호를 확인했습니다." }, 200);
  } catch (error) {
    logSafePasswordVerificationError("UNEXPECTED_ERROR", error);
    return jsonResponse({ success: false, code: "INTERNAL_ERROR", message: "비밀번호 확인 중 오류가 발생했습니다." }, 500);
  }
}