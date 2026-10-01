import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    // 현재 사용자의 세션 확인
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, code: "UNAUTHORIZED", message: "본인 인증이 필요합니다." },
        { status: 401 }
      );
    }

    const userId = user.id;
    const userEmail = user.email;

    // 서비스 역할 클라이언트로 사용자 계정 삭제 준비
    // store_memberships는 on delete cascade에 의해 자동 삭제됨
    // 하지만 명시적으로 삭제하고 피드백을 제공하기 위해 먼저 조회

    // 1. 해당 사용자의 모든 store_memberships 조회 (로깅 및 피드백용)
    const { data: memberships, error: membershipError } = await supabase
      .from("store_memberships")
      .select("id, store_id, status, role")
      .eq("user_id", userId);

    if (membershipError) {
      console.error("매장 소속 조회 실패:", membershipError);
      return NextResponse.json(
        { success: false, code: "QUERY_ERROR", message: "사용자 정보 조회에 실패했습니다." },
        { status: 500 }
      );
    }

    const approvedCount = memberships?.filter((m) => m.status === "approved").length ?? 0;
    const pendingCount = memberships?.filter((m) => m.status === "pending").length ?? 0;

    // 2. Service role 클라이언트로 auth.users 삭제
    // Supabase SDK에서는 현재 사용자만 직접 삭제 가능하므로 admin API 호출 필요
    // 하지만 클라이언트 SDK에서 deleteUser는 현재 사용자만 삭제 가능
    // Supabase Admin API를 사용하려면 직접 HTTP 요청을 해야 함

    // Supabase Admin API 엔드포인트
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Supabase 환경 변수가 설정되지 않았습니다.");
      return NextResponse.json(
        { success: false, code: "CONFIG_ERROR", message: "서버 설정 오류입니다." },
        { status: 500 }
      );
    }

    // Admin API를 통한 사용자 삭제
    const deleteUserResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!deleteUserResponse.ok) {
      const errorBody = await deleteUserResponse.text();
      console.error("사용자 삭제 실패:", deleteUserResponse.status, errorBody);

      // 특정 오류 코드 처리
      if (deleteUserResponse.status === 404) {
        return NextResponse.json(
          { success: false, code: "NOT_FOUND", message: "사용자를 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { success: false, code: "DELETE_ERROR", message: "계정 삭제에 실패했습니다." },
        { status: 500 }
      );
    }

    // 3. 로그 기록 (선택사항)
    // 사용자 삭제 로그를 별도 테이블에 저장할 수 있음
    // 예: audit_logs, deleted_accounts 등

    return NextResponse.json({
      success: true,
      message: "회원 탈퇴가 완료되었습니다.",
      stats: {
        approvedStoresCount: approvedCount,
        pendingRequestsCount: pendingCount,
        userEmail: userEmail,
      },
    });
  } catch (error) {
    console.error("회원 탈퇴 처리 중 오류:", error);
    return NextResponse.json(
      {
        success: false,
        code: "INTERNAL_ERROR",
        message: "회원 탈퇴 처리 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
