import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { withdrawStaffMembership } from "@/lib/staff/staff-membership-service";

export const runtime = "nodejs";

type CancelResponse = {
  success: boolean;
  error?: string;
  code?: "NOT_FOUND" | "NOT_PENDING" | "NOT_APPROVED" | "INVALID_STATUS" | "AMBIGUOUS_IDENTIFIER";
};

/**
 * 직원 본인의 근무 매장 신청을 취소하거나 근무 매장에서 해제(탈퇴)한다.
 * - 로그인 사용자 본인의 membership이어야 하고 (user_id = auth user)
 * - role = staff
 * - status = pending (신청 취소) 또는 status = approved (근무 매장 해제)
 * - id 파라미터는 membershipId가 계약이다. storeId는 구 클라이언트 호환용이며 모호하면 400으로 거절한다.
 * 거절(rejected)된 membership은 이 API로 지울 수 없다.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<CancelResponse>> {
  const { id: identifier } = await params;

  if (!identifier || typeof identifier !== "string" || !identifier.trim()) {
    return NextResponse.json(
      { success: false, error: "매장 식별자가 올바르지 않습니다.", code: "NOT_FOUND" },
      { status: 400 },
    );
  }

  const serverClient = await createClient();
  const { data: userData, error: userError } = await serverClient.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ success: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    const adminClient = createAdminClient();
    const result = await withdrawStaffMembership(adminClient, {
      userId: userData.user.id,
      identifier: identifier.trim(),
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error, code: result.code },
        { status: result.status },
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/staff/memberships/[id] error:", error);
    return NextResponse.json(
      { success: false, error: "요청을 처리하지 못했습니다." },
      { status: 500 },
    );
  }
}
