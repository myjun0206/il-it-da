import { NextResponse } from "next/server";

import { requireServerRole } from "@/lib/auth/require-server-role";
import { fetchNoticesForStore } from "@/lib/notices/store-notices";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export interface StaffNoticeItem {
  id: string;
  /** all = 프랜차이즈 전체 지점 대상, store = 현재 매장 대상 */
  targetType: "all" | "store";
  title: string;
  content: string;
  /** 작성 주체 (본사 프랜차이즈명). 확인할 수 없으면 빈 문자열 */
  authorName: string;
  createdAt: string;
}

/**
 * 직원 공지사항 조회 (읽기 전용 — 이 route에는 쓰기 메서드가 없다).
 * GET ?storeId=<uuid>
 *
 * 1) 로그인 사용자의 profiles.role = staff 확인
 * 2) 요청 storeId에 대한 본인의 approved staff membership 확인 (pending/rejected/남의 매장 UUID는 403)
 * 3) 그 매장의 stores.franchise_id(서버 조회값) 범위에서 "전체 지점" 공지 + "이 매장" 대상 공지만 반환
 *    (점주 공지와 같은 notices 테이블·같은 조회 함수)
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const auth = await requireServerRole("staff");
    if (auth.status === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    if (auth.status !== "AUTHORIZED") {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const storeId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";
    if (!storeId) {
      return NextResponse.json({ error: "근무 매장을 선택해 주세요.", code: "STORE_REQUIRED" }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { data: membership, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("id")
      .eq("user_id", auth.userId)
      .eq("store_id", storeId)
      .eq("role", "staff")
      .eq("status", "approved")
      .maybeSingle<{ id: string }>();

    if (membershipError || !membership) {
      return NextResponse.json({ error: "이 매장의 공지사항을 볼 권한이 없습니다.", code: "STORE_FORBIDDEN" }, { status: 403 });
    }

    const { franchiseName, rows } = await fetchNoticesForStore(adminClient, storeId);
    const notices: StaffNoticeItem[] = rows.map((row) => ({
      id: row.id,
      targetType: row.target_type,
      title: row.title,
      content: row.content,
      authorName: franchiseName,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ notices });
  } catch (error) {
    console.error("GET /api/staff/notices error:", error);
    return NextResponse.json({ error: "공지사항을 불러오지 못했습니다." }, { status: 500 });
  }
}
