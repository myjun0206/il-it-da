import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  expectedMasterApprovalStatus,
  groupMembershipStatusesByUser,
  needsApprovalCompletion,
} from "@/lib/signup/approval-recovery";

export const runtime = "nodejs";

interface StaffMemberResponse {
  membershipId: string;
  userId: string;
  storeId: string;
  name: string;
  email: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  approvedAt?: string;
}

interface EmployeesListResponse {
  success: boolean;
  data?: {
    pending: StaffMemberResponse[];
    approved: StaffMemberResponse[];
    summary: {
      total: number;
      pending: number;
      approved: number;
    };
  };
  error?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse<EmployeesListResponse>> {
  try {
    // 1. 현재 인증된 owner 확보
    const serverClient = await createClient();
    const { data: { user }, error: userError } = await serverClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // 2. 쿼리에서 storeId 추출
    const storeId = request.nextUrl.searchParams.get("storeId");
    if (!storeId) {
      return NextResponse.json(
        { success: false, error: "매장을 선택해주세요." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // 3. owner가 해당 store의 approved owner membership을 가지고 있는지 검증
    const { data: ownerMembership, error: ownerError } = await adminClient
      .from("store_memberships")
      .select("*")
      .eq("user_id", user.id)
      .eq("store_id", storeId)
      .eq("role", "owner")
      .eq("status", "approved")
      .maybeSingle();

    if (ownerError) {
      console.error("[GET /api/boss/employees] Owner membership check error:", ownerError);
      return NextResponse.json(
        { success: false, error: "권한 검증 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    if (!ownerMembership) {
      return NextResponse.json(
        { success: false, error: "이 매장에 대한 접근 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 4. 해당 store의 role=staff 멤버십 조회 (pending + approved + rejected)
    const { data: staffMemberships, error: staffError } = await adminClient
      .from("store_memberships")
      .select("id, user_id, store_id, role, status, requested_at, approved_at")
      .eq("store_id", storeId)
      .eq("role", "staff");

    if (staffError) {
      console.error("[GET /api/boss/employees] Staff memberships query error:", staffError);
      return NextResponse.json(
        { success: false, error: "직원 목록 조회 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    const staffUserIds = [...new Set((staffMemberships ?? []).map((membership) => membership.user_id))];
    const { data: profiles, error: profileError } = staffUserIds.length
      ? await adminClient
          .from("profiles")
          .select("user_id, full_name, email, approval_status")
          .in("user_id", staffUserIds)
          .is("brand_id", null)
      : { data: [], error: null };

    if (profileError) {
      console.error("[GET /api/boss/employees] Staff profile query failed", { code: profileError.code });
      return NextResponse.json(
        { success: false, error: "직원 프로필 조회 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    const profilesByUserId = new Map(
      (profiles ?? []).map((profile) => [profile.user_id, { name: profile.full_name, email: profile.email }]),
    );
    const masterStatusByUserId = new Map(
      (profiles ?? []).map((profile) => [profile.user_id, profile.approval_status ?? null]),
    );

    // 승인은 됐지만 후속 단계(브랜드 프로필, 마스터 승인 상태)가 끝나지 않은 "부분 승인"을 구분한다.
    // 조회가 실패하면 복구 불필요로 위장하지 않고 고정 오류로 끊는다.
    const { data: storeRow, error: storeRowError } = await adminClient
      .from("stores")
      .select("franchise_id")
      .eq("id", storeId)
      .maybeSingle<{ franchise_id: string | null }>();

    if (storeRowError) {
      console.error("[GET /api/boss/employees] Store brand query failed", { code: storeRowError.code });
      return NextResponse.json(
        { success: false, error: "직원 목록 조회 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    const storeBrandId = storeRow?.franchise_id ?? null;

    const { data: brandProfiles, error: brandProfileError } = storeBrandId && staffUserIds.length
      ? await adminClient
          .from("profiles")
          .select("user_id")
          .in("user_id", staffUserIds)
          .eq("brand_id", storeBrandId)
      : { data: [], error: null };

    if (brandProfileError) {
      console.error("[GET /api/boss/employees] Brand profile query failed", { code: brandProfileError.code });
      return NextResponse.json(
        { success: false, error: "직원 목록 조회 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    const { data: allStaffMemberships, error: allStaffMembershipError } = staffUserIds.length
      ? await adminClient
          .from("store_memberships")
          .select("user_id, status")
          .in("user_id", staffUserIds)
      : { data: [], error: null };

    if (allStaffMembershipError) {
      console.error("[GET /api/boss/employees] Membership status query failed", {
        code: allStaffMembershipError.code,
      });
      return NextResponse.json(
        { success: false, error: "직원 목록 조회 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    const membershipsByUser = groupMembershipStatusesByUser(allStaffMemberships ?? []);

    const brandProfileUserIds = new Set(
      ((brandProfiles ?? []) as { user_id: string }[]).map((profile) => profile.user_id),
    );
    const staffMembers: StaffMemberResponse[] = (staffMemberships ?? []).map((membership) => {
      const profile = profilesByUserId.get(membership.user_id);
      return {
        membershipId: membership.id,
        userId: membership.user_id,
        storeId: membership.store_id,
        name: profile?.name || "이름 미등록",
        email: profile?.email || "",
        status: membership.status,
        requestedAt: membership.requested_at,
        approvedAt: membership.approved_at || undefined,
        needsBrandProfileRecovery: needsApprovalCompletion({
          membershipStatus: membership.status,
          hasBrandProfile: storeBrandId ? brandProfileUserIds.has(membership.user_id) : null,
          masterApprovalStatus: masterStatusByUserId.get(membership.user_id) ?? null,
          expectedMasterStatus: expectedMasterApprovalStatus(
            membershipsByUser.get(membership.user_id) ?? [],
          ),
        }),
      };
    });

    console.info("[GET /api/boss/employees] Staff memberships loaded", {
      ownerUserId: user.id,
      storeId,
      count: staffMembers.length,
      pending: staffMembers.filter((member) => member.status === "pending").length,
      approved: staffMembers.filter((member) => member.status === "approved").length,
    });

    // 6. pending과 approved로 분류
    const pending = staffMembers.filter((m) => m.status === "pending");
    const approved = staffMembers.filter((m) => m.status === "approved");

    return NextResponse.json({
      success: true,
      data: {
        pending,
        approved,
        summary: {
          total: pending.length + approved.length,
          pending: pending.length,
          approved: approved.length,
        },
      },
    });
  } catch (e) {
    console.error("[GET /api/boss/employees] Unexpected error:", e);
    return NextResponse.json(
      { success: false, error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
