import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CancelResponse = { success: boolean; error?: string; code?: "NOT_FOUND" | "NOT_PENDING" };

/**
 * 직원 본인의 "승인 대기" 근무 매장 신청만 취소한다.
 * - 로그인 사용자 본인의 membership이어야 하고 (user_id = auth user)
 * - role = staff, status = pending 인 경우에만 삭제한다.
 * 승인(approved)/거절(rejected)된 membership은 이 API로 지울 수 없다.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<CancelResponse>> {
  const { id: membershipId } = await params;

  const serverClient = await createClient();
  const { data: userData, error: userError } = await serverClient.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ success: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    const adminClient = createAdminClient();
    const { data: membership, error: lookupError } = await adminClient
      .from("store_memberships")
      .select("id, user_id, role, status")
      .eq("id", membershipId)
      .eq("user_id", userData.user.id)
      .eq("role", "staff")
      .maybeSingle<{ id: string; user_id: string; role: string; status: string }>();

    if (lookupError) throw lookupError;
    if (!membership) {
      return NextResponse.json(
        { success: false, error: "신청 내역을 찾을 수 없습니다.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }
    if (membership.status !== "pending") {
      return NextResponse.json(
        { success: false, error: "승인 대기 중인 신청만 취소할 수 있습니다.", code: "NOT_PENDING" },
        { status: 409 },
      );
    }

    // status 조건까지 걸어, 그 사이 점주가 승인한 경우에는 지우지 않는다.
    const { data: deleted, error: deleteError } = await adminClient
      .from("store_memberships")
      .delete()
      .eq("id", membership.id)
      .eq("user_id", userData.user.id)
      .eq("role", "staff")
      .eq("status", "pending")
      .select("id");

    if (deleteError) throw deleteError;
    if (!deleted || deleted.length === 0) {
      return NextResponse.json(
        { success: false, error: "승인 대기 중인 신청만 취소할 수 있습니다.", code: "NOT_PENDING" },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/staff/memberships/[id] error:", error);
    return NextResponse.json({ success: false, error: "신청을 취소하지 못했습니다." }, { status: 500 });
  }
}
