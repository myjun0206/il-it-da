import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createNotification } from "@/lib/notifications";
import { ensureBrandProfileForApprovedMembership } from "@/lib/signup/store-membership-service";

export const runtime = "nodejs";

interface UpdateMembershipRequest {
  status: "approved" | "rejected";
}

interface UpdateMembershipResponse {
  success: boolean;
  membershipId?: string;
  error?: string;
}

async function syncProfileApprovalStatus(adminClient: ReturnType<typeof createAdminClient>, userId: string): Promise<void> {
  const { data: memberships, error } = await adminClient
    .from("store_memberships")
    .select("status, approved_at, approved_by")
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  const hasApproved = (memberships ?? []).some((membership) => membership.status === "approved");
  const hasPending = (memberships ?? []).some((membership) => membership.status === "pending");
  const firstApproved = (memberships ?? []).find((membership) => membership.status === "approved");
  const approvalStatus = hasApproved ? "approved" : hasPending ? "pending" : "rejected";

  const { error: profileUpdateError } = await adminClient
    .from("profiles")
    .update({
      approval_status: approvalStatus,
      approved_at: approvalStatus === "approved" ? firstApproved?.approved_at ?? new Date().toISOString() : null,
      approved_by: approvalStatus === "approved" ? firstApproved?.approved_by ?? null : null,
    })
    .eq("id", userId);

  if (profileUpdateError) {
    throw profileUpdateError;
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<UpdateMembershipResponse>> {
  try {
    const { id: membershipId } = await params;

    if (!membershipId) {
      return NextResponse.json(
        { success: false, error: "유효하지 않은 요청입니다." },
        { status: 400 }
      );
    }

    // 1. 현재 인증된 owner 확보
    const serverClient = await createClient();
    const { data: { user }, error: userError } = await serverClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // 2. 요청 본문에서 새로운 status 추출
    const body = (await request.json()) as UpdateMembershipRequest;
    const newStatus = body.status;

    if (!newStatus || !["approved", "rejected"].includes(newStatus)) {
      return NextResponse.json(
        { success: false, error: "유효하지 않은 상태 변경입니다." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // 3. membership 조회 및 owner 권한 검증
    const { data: membership, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("*")
      .eq("id", membershipId)
      .maybeSingle();

    if (membershipError) {
      console.error("[PUT /api/boss/employees/[id]] Membership query error:", membershipError);
      return NextResponse.json(
        { success: false, error: "직원 정보 조회 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    if (!membership) {
      return NextResponse.json(
        { success: false, error: "직원을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 점주는 직원(staff) membership만 승인/거절한다. (점주 승인은 HQ 권한)
    if (membership.role !== "staff") {
      return NextResponse.json(
        { success: false, error: "이 직원을 관리할 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 4. 현재 owner가 해당 store의 approved owner인지 검증 (store_id 기준)
    const { data: ownerMembership, error: ownerError } = await adminClient
      .from("store_memberships")
      .select("*")
      .eq("user_id", user.id)
      .eq("store_id", membership.store_id)
      .eq("role", "owner")
      .eq("status", "approved")
      .maybeSingle();

    if (ownerError) {
      console.error("[PUT /api/boss/employees/[id]] Owner check error:", ownerError);
      return NextResponse.json(
        { success: false, error: "권한 검증 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    if (!ownerMembership) {
      return NextResponse.json(
        { success: false, error: "이 직원을 관리할 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 5. membership 상태 업데이트
    const updateData: Record<string, unknown> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    // approved/rejected에 따라 timestamp 설정
    if (newStatus === "approved") {
      updateData.approved_at = new Date().toISOString();
      updateData.approved_by = user.id;
    } else if (newStatus === "rejected") {
      updateData.rejected_at = new Date().toISOString();
      updateData.rejected_by = user.id;
    }

    const { error: updateError } = await adminClient
      .from("store_memberships")
      .update(updateData)
      .eq("id", membershipId);

    if (updateError) {
      console.error("[PUT /api/boss/employees/[id]] Update error:", updateError);
      return NextResponse.json(
        { success: false, error: "상태 변경 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    try {
      await syncProfileApprovalStatus(adminClient, membership.user_id);
      if (newStatus === "approved") {
        const brandProfileSynced = await ensureBrandProfileForApprovedMembership(
          adminClient,
          membership.user_id,
          membership.store_id,
        );
        if (!brandProfileSynced) {
          return NextResponse.json(
            { success: false, error: "브랜드 프로필 동기화에 실패했습니다." },
            { status: 500 },
          );
        }
      }
    } catch (profileUpdateError) {
      console.error("[PUT /api/boss/employees/[id]] Profile approval sync error:", profileUpdateError);
      return NextResponse.json(
        { success: false, error: "프로필 승인 상태 변경 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // Generate notification for staff approval decision (async)
    // 알림 문구에는 매장 UUID 대신 실제 매장명을 쓴다. (조회 실패 시 일반 문구)
    const { data: store } = await adminClient
      .from("stores")
      .select("store_name")
      .eq("id", membership.store_id)
      .maybeSingle<{ store_name: string | null }>();
    const storeLabel = store?.store_name?.trim() || "매장";
    const title = newStatus === "approved" ? "근무 매장 승인이 완료되었습니다." : "근무 매장 신청이 거절되었습니다.";
    const message = newStatus === "approved"
      ? `${storeLabel}에서 근무 신청을 승인했습니다.`
      : `${storeLabel}에서 근무 신청을 거절했습니다.`;

    createNotification({
      recipientUserId: membership.user_id,
      type: "staff_approval_decision",
      title,
      message,
      targetUrl: newStatus === "approved" ? "/staff" : undefined,
      relatedId: membershipId,
    }).catch((e) => console.error("Failed to create staff approval notification:", e));

    return NextResponse.json({
      success: true,
      membershipId,
    });
  } catch (e) {
    console.error("[PUT /api/boss/employees/[id]] Unexpected error:", e);
    return NextResponse.json(
      { success: false, error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
