import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { createClient } from "@/lib/supabase/server";
import { createNotification } from "@/lib/notifications";

export const runtime = "nodejs";

interface UpdateApprovalRequest {
  membershipId: string;
  action: "approve" | "reject";
}

interface StoreMembership {
  id: string;
  user_id: string;
  store_id: string;
  role: "owner" | "staff";
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const hqUser = await requireHqUser();

    if (!hqUser) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: HQ profile required" },
        { status: 401 }
      );
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status") as "pending" | "approved" | "rejected" | null;

    // Use admin client to bypass RLS
    const adminClient = createAdminClient();

    // Build query - HQ can only view OWNER memberships, never STAFF
    let query = adminClient
      .from("store_memberships")
      .select(
        `
        id,
        user_id,
        store_id,
        role,
        status,
        requested_at,
        approved_at,
        approved_by,
        rejected_at,
        rejected_by
      `
      )
      .eq("role", "owner");

    // Apply status filter if provided
    if (status && ["pending", "approved", "rejected"].includes(status)) {
      query = query.eq("status", status);
    }

    // Order by requested_at descending
    query = query.order("requested_at", { ascending: false });

    const { data: memberships, error } = await query;

    if (error) {
      console.error("Failed to fetch memberships:", error);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to fetch approvals",
          details: error.message,
        },
        { status: 500 }
      );
    }

    // Fetch user and store details separately
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let approvals: Array<{ membership: StoreMembership & { user_name: string; store_name: string } }> = [];
    if (memberships && Array.isArray(memberships) && memberships.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userIds = [...new Set((memberships as any[]).map((m) => m.user_id))];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storeIds = [...new Set((memberships as any[]).map((m) => m.store_id))];

      // Fetch profiles
      const { data: users } = await adminClient
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);

      // Fetch stores
      const { data: stores } = await adminClient
        .from("stores")
        .select("id, store_name")
        .in("id", storeIds);

      // 프로필 맵 생성 (full_name으로)
      const profileMap = new Map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        users?.map((u: any) => [u.id, u.full_name]) || []
      );

      const storeMap = new Map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stores?.map((s: any) => [s.id, s.store_name]) || []
      );

      // Auth user 정보 조회 (fallback용)
      // userIds별로 auth user 정보를 가져온다
      const authUserMap = new Map<string, { name?: string; email?: string }>();

      // Supabase Admin API를 사용해서 auth users 정보 조회
      // 참고: Supabase는 일괄 조회 API가 없으므로 개별 조회 필요
      // 대신 효율성을 위해 전체 auth users를 조회해서 필요한 것만 필터링
      try {
        // Supabase Admin API: list all users (이 엔드포인트는 service_role 필요)
        // 현재는 클라이언트에서 직접 하기 어려우므로 다른 접근 필요

        // 대체 방법: membership의 각 user_id에 대해
        // profile에 full_name이 없으면, auth metadata를 확인
        // 하지만 server에서 개별 user를 조회하는 API가 없으므로
        // 일단 profile 정보로 충분한지 확인하고
        // 필요시 별도 로직 추가

        // 현재는 profiles 정보를 우선 사용
      } catch (e) {
        console.error("Error fetching auth users:", e);
      }

      // Combine data
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      approvals = (memberships as any[]).map((m) => ({
        membership: {
          ...m,
          user_name: profileMap.get(m.user_id) || authUserMap.get(m.user_id)?.name || authUserMap.get(m.user_id)?.email || "Unknown User",
          store_name: storeMap.get(m.store_id) || "Unknown Store",
        },
      }));

      // Diagnostic log
      console.log("[GET /api/hq/approvals] Total memberships:", memberships.length);
      if (memberships.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        memberships.forEach((m: any) => {
          const storeName = storeMap.get(m.store_id) || "Unknown Store";
          const userName = profileMap.get(m.user_id) || authUserMap.get(m.user_id)?.name || authUserMap.get(m.user_id)?.email || "Unknown User";
          console.log(`  membershipId=${m.id}, user_id=${m.user_id}, store_id=${m.store_id}, status=${m.status}, storeName="${storeName}", userName="${userName}"`);
        });
      }

      // Show approved memberships specifically
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const approvedMemberships = (memberships as any[]).filter((m: any) => m.status === "approved");
      if (approvedMemberships.length > 0) {
        console.log("[GET /api/hq/approvals] APPROVED memberships:");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        approvedMemberships.forEach((m: any) => {
          const storeName = storeMap.get(m.store_id) || "Unknown Store";
          console.log(`  membershipId=${m.id}, user_id=${m.user_id}, store_id=${m.store_id}, storeName="${storeName}"`);
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: approvals,
    });
  } catch (e) {
    console.error("GET /api/hq/approvals error:", e);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        details: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const hqUser = await requireHqUser();

    if (!hqUser) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: HQ profile required" },
        { status: 401 }
      );
    }

    // Parse request body
    const body = (await request.json()) as UpdateApprovalRequest;

    if (!body.membershipId || typeof body.membershipId !== "string") {
      return NextResponse.json(
        { success: false, error: "membershipId is required" },
        { status: 400 }
      );
    }

    if (!body.action || (body.action !== "approve" && body.action !== "reject")) {
      return NextResponse.json(
        { success: false, error: "action must be 'approve' or 'reject'" },
        { status: 400 }
      );
    }

    // Use admin client to bypass RLS
    const adminClient = createAdminClient();

    // Fetch current membership to verify it exists and get current status
    const { data: membership, error: fetchError } = await adminClient
      .from("store_memberships")
      .select("*")
      .eq("id", body.membershipId)
      .single();

    if (fetchError || !membership) {
      return NextResponse.json(
        {
          success: false,
          error: "Membership not found",
          details: fetchError?.message,
        },
        { status: 404 }
      );
    }

    // HQ can only approve/reject OWNER memberships
    if (membership.role !== "owner") {
      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: HQ can only approve owner memberships",
        },
        { status: 403 }
      );
    }

    // Verify membership is currently pending (can only approve/reject pending requests)
    if (membership.status !== "pending") {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot change status of ${membership.status} membership`,
        },
        { status: 400 }
      );
    }

    // Build update object based on action
    const now = new Date().toISOString();
    let updateData: Partial<StoreMembership>;

    if (body.action === "approve") {
      updateData = {
        status: "approved",
        approved_at: now,
        approved_by: hqUser.userId,
        rejected_at: null,
        rejected_by: null,
      };
    } else {
      // reject
      updateData = {
        status: "rejected",
        rejected_at: now,
        rejected_by: hqUser.userId,
        approved_at: null,
        approved_by: null,
      };
    }

    // Update membership
    const { data: updated, error: updateError } = await adminClient
      .from("store_memberships")
      .update(updateData)
      .eq("id", body.membershipId)
      .select()
      .single();

    if (updateError) {
      console.error("Failed to update membership:", updateError);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to update membership",
          details: updateError.message,
        },
        { status: 500 }
      );
    }

    // Generate notification for approval decision (async)
    const action = body.action;
    const title = action === "approve" ? "점주 가입이 승인되었습니다." : "점주 가입이 거절되었습니다.";
    const message = action === "approve"
      ? "축하합니다! 점주 가입 신청이 승인되었습니다."
      : "죄송합니다. 점주 가입 신청이 거절되었습니다.";

    createNotification({
      recipientUserId: updated.user_id,
      type: "approval_decision",
      title,
      message,
      targetUrl: action === "approve" ? "/boss" : undefined,
      relatedId: updated.id,
    }).catch((e) => console.error("Failed to create approval notification:", e));

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (e) {
    console.error("PUT /api/hq/approvals error:", e);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        details: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
