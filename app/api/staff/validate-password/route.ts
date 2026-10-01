import { createPasswordVerificationClient, verifyPasswordWithIsolatedClient } from "@/lib/auth/verify-password";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * 비밀번호 검증 API
 * 현재 비밀번호가 올바른지 확인합니다.
 * 성공하면 새 비밀번호 변경 가능 상태로 변경됩니다.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. 요청 본문 파싱
    const body = (await req.json()) as {
      password?: string;
    };

    const { password } = body;

    // 2. 입력값 검증
    if (!password) {
      return NextResponse.json(
        { success: false, code: "MISSING_PASSWORD", message: "비밀번호가 필요합니다." },
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

    const userEmail = user.email;

    if (!userEmail) {
      return NextResponse.json(
        { success: false, code: "MISSING_EMAIL", message: "사용자 이메일을 가져올 수 없습니다." },
        { status: 500 }
      );
    }

    // 4. 현재 비밀번호 검증 (쿠키 세션과 분리된 일회용 client, 검증 세션은 즉시 폐기)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("Supabase 환경 변수가 설정되지 않았습니다.");
      return NextResponse.json(
        { success: false, code: "CONFIG_ERROR", message: "서버 설정 오류입니다." },
        { status: 500 }
      );
    }

    const isValid = await verifyPasswordWithIsolatedClient(
      createPasswordVerificationClient(supabaseUrl, supabaseAnonKey),
      userEmail,
      password,
    );

    if (!isValid) {
      return NextResponse.json(
        { success: false, code: "INVALID_PASSWORD", message: "현재 비밀번호가 일치하지 않습니다." },
        { status: 401 }
      );
    }

    // 5. 성공
    return NextResponse.json({
      success: true,
      message: "비밀번호 검증이 완료되었습니다.",
    });
  } catch (error) {
    console.error("비밀번호 검증 중 오류:", error);

    return NextResponse.json(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "비밀번호 검증 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
