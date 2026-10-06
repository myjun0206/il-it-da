import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createPasswordVerificationClient, verifyPasswordWithIsolatedClient } from "@/lib/auth/verify-password";
import { deleteStaffAccount, hasPasswordLogin } from "@/lib/staff/staff-membership-service";

export const runtime = "nodejs";

/**
 * 직원 본인의 회원 탈퇴 (계정 삭제).
 * - 세션 사용자 본인만 탈퇴 가능
 * - profiles.role === 'staff' 직원 전용 (점주·본사는 차단)
 * - 비밀번호 로그인 계정인 경우 서버에서도 비밀번호 일치 검증 필수
 * - OAuth 계정(비밀번호 없음)은 비밀번호 검증 생략
 * - Storage 아바타 정리 후 auth.admin.deleteUser(userId)를 통해 auth.users 삭제
 * - DB FK ON DELETE CASCADE에 의해 profiles, store_memberships, conversations,
 *   conversation_messages, notifications가 연쇄 자동 삭제된다.
 * - question_logs(질문 로그), manuals(공유 매뉴얼), stores(매장), notices(공지)는 보존된다.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const serverClient = await createClient();
    const {
      data: { user },
      error: authError,
    } = await serverClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, code: "UNAUTHORIZED", error: "로그인이 필요합니다." },
        { status: 401 },
      );
    }

    let body: { password?: unknown } = {};
    try {
      body = (await req.json()) as { password?: unknown };
    } catch {
      // body가 없는 요청 허용 (OAuth 사용자용)
    }

    // 1. 비밀번호 로그인 계정인 경우 서버에서도 비밀번호 검증 필수
    const isPasswordUser = hasPasswordLogin(user);

    if (isPasswordUser) {
      const password = typeof body.password === "string" ? body.password : "";
      if (!password) {
        return NextResponse.json(
          { success: false, code: "PASSWORD_REQUIRED", error: "본인 확인을 위해 비밀번호를 입력해주세요." },
          { status: 400 },
        );
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey || !user.email) {
        return NextResponse.json(
          { success: false, code: "CONFIG_ERROR", error: "서버 설정 오류입니다." },
          { status: 500 },
        );
      }

      // 쿠키 세션 client(serverClient)로 로그인하면 현재 세션이 교체되므로 분리된 client로만 검증한다.
      const isValid = await verifyPasswordWithIsolatedClient(
        createPasswordVerificationClient(supabaseUrl, supabaseAnonKey),
        user.email,
        password,
      );

      if (!isValid) {
        return NextResponse.json(
          { success: false, code: "INVALID_PASSWORD", error: "비밀번호가 일치하지 않습니다." },
          { status: 400 },
        );
      }
    }

    let adminClient;
    try {
      adminClient = createAdminClient();
    } catch (e) {
      console.error("[STAFF_DELETE_ACCOUNT] Failed to create admin client:", e);
      return NextResponse.json(
        { success: false, code: "CONFIG_ERROR", error: "서버 설정 오류입니다." },
        { status: 500 },
      );
    }

    const result = await deleteStaffAccount(adminClient, { userId: user.id });

    if (!result.success) {
      return NextResponse.json(
        { success: false, code: result.code, error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error("[STAFF_DELETE_ACCOUNT] Unexpected error:", error);
    return NextResponse.json(
      {
        success: false,
        code: "INTERNAL_ERROR",
        error: "회원 탈퇴 처리 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
