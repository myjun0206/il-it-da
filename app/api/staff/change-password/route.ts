import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
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
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, code: "UNAUTHORIZED", message: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const userId = user.id;

    // 4. Admin API를 통한 비밀번호 변경
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Supabase 환경 변수가 설정되지 않았습니다.");
      return NextResponse.json(
        { success: false, code: "CONFIG_ERROR", message: "서버 설정 오류입니다." },
        { status: 500 }
      );
    }

    const updatePasswordResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: newPassword }),
    });

    if (!updatePasswordResponse.ok) {
      const errorBody = await updatePasswordResponse.text();
      console.error("비밀번호 변경 실패:", updatePasswordResponse.status, errorBody);

      if (updatePasswordResponse.status === 404) {
        return NextResponse.json(
          { success: false, code: "USER_NOT_FOUND", message: "사용자를 찾을 수 없습니다." },
          { status: 404 }
        );
      }

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
    console.error("비밀번호 변경 중 오류:", error);

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
