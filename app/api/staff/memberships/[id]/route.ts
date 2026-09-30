import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CancelResponse = {
  success: boolean;
  error?: string;
  code?: "NOT_FOUND" | "NOT_PENDING" | "NOT_APPROVED" | "INVALID_STATUS";
};

/**
 * 직원 본인의 근무 매장 신청을 취소하거나 근무 매장에서 해제한다.
 * - 로그인 사용자 본인의 membership이어야 하고 (user_id = auth user)
 * - role = staff
 * - status = pending (신청 취소) 또는 status = approved (근무 매장 해제)
 * 거절(rejected)된 membership은 이 API로 지울 수 없다.
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

    // pending 또는 approved만 삭제 가능
    if (membership.status !== "pending" && membership.status !== "approved") {
      const errorCode =
        membership.status === "approved" ? "NOT_APPROVED" : ("INVALID_STATUS" as const);
      return NextResponse.json(
        {
          success: false,
          error:
            membership.status === "pending"
              ? "승인 대기 중인 신청만 취소할 수 있습니다."
              : "이 근무 매장을 해제할 수 없습니다.",
          code: errorCode,
        },
        { status: 409 },
      );
    }

    // double-check: 삭제 시점에 상태가 변경되지 않았는지 확인
    const { data: deleted, error: deleteError } = await adminClient
      .from("store_memberships")
      .delete()
      .eq("id", membership.id)
      .eq("user_id", userData.user.id)
      .eq("role", "staff")
      .in("status", ["pending", "approved"])
      .select("id");

    if (deleteError) throw deleteError;
    if (!deleted || deleted.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "이 매장을 더 이상 해제할 수 없습니다. (상태 변경됨)",
          code: "INVALID_STATUS",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/staff/memberships/[id] error:", error);
    return NextResponse.json(
      { success: false, error: "요청을 처리하지 못했습니다." },
      { status: 500 },
    );
  }
}
