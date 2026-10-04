import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

/**
 * 비밀번호 변경 API
 * 현재 세션의 사용자 비밀번호를 변경합니다.
 * 이 API를 호출하기 전에 먼저 /api/staff/validate-password로 현재 비밀번호를 검증해야 합니다.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. 요청 본문 파싱
    const body = (await req.json()) as {
      newPassword?: string;
    };

    const { newPassword } = body;

    // 2. 입력값 검증
    if (!newPassword) {
      return NextResponse.json(
        { success: false, code: "MISSING_PASSWORD", message: "새 비밀번호가 필요합니다." },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { success: false, code: "WEAK_PASSWORD", message: "새 비밀번호는 최소 8자 이상이어야 합니다." },
        { status: 400 }
      );
    }

    // 3. 현재 세션의 사용자 확인
    const serverClient = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await serverClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, code: "UNAUTHORIZED", message: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const userId = user.id;

    // 4. Admin SDK를 통한 비밀번호 변경 (fetch 대신 Supabase admin SDK 사용)
    const adminClient = createAdminClient();
    
    const { data, error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (updateError) {
      console.error("[CHANGE_PASSWORD] Password update failed:", {
        userId,
        errorCode: updateError.code,
        errorMessage: updateError.message,
      });

      // 일반적인 에러 메시지로 사용자에게 반환
      return NextResponse.json(
        { success: false, code: "UPDATE_ERROR", message: "비밀번호 변경에 실패했습니다." },
        { status: 500 }
      );
    }

    if (!data?.user) {
      console.error("[CHANGE_PASSWORD] Password update succeeded but no user data returned:", {
        userId,
      });

      return NextResponse.json(
        { success: false, code: "UPDATE_ERROR", message: "비밀번호 변경에 실패했습니다." },
        { status: 500 }
      );
    }

    // 5. 성공
    return NextResponse.json({
      success: true,
      message: "비밀번호가 변경되었습니다.",
    });
  } catch (error) {
    console.error("[CHANGE_PASSWORD] Unexpected error:", {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "비밀번호 변경 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
