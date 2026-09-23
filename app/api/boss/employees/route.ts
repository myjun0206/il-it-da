import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface StaffMemberResponse {
  membershipId: string;
  userId: string;
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
      .select("*")
      .eq("store_id", storeId)
      .eq("role", "staff");

    if (staffError) {
      console.error("[GET /api/boss/employees] Staff memberships query error:", staffError);
      return NextResponse.json(
        { success: false, error: "직원 목록 조회 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // 5. 각 staff의 user_id로 auth.users에서 이름과 이메일 조회
    const staffMembers: StaffMemberResponse[] = [];

    if (staffMemberships && staffMemberships.length > 0) {
      for (const membership of staffMemberships) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: userList, error: userLookupError } = await adminClient.auth.admin.listUsers();

          if (userLookupError) {
            console.error(`[GET /api/boss/employees] Failed to fetch user info for ${membership.user_id}:`, userLookupError);
            continue;
          }

          // Find the specific user
          const staffUser = userList?.users?.find((u) => u.id === membership.user_id);

          if (!staffUser) {
            console.warn(`[GET /api/boss/employees] User not found: ${membership.user_id}`);
            continue;
          }

          const name = (staffUser.user_metadata as Record<string, unknown>)?.name as string | undefined || "알 수 없음";
          const email = staffUser.email || "";

          staffMembers.push({
            membershipId: membership.id,
            userId: membership.user_id,
            name,
            email,
            status: membership.status,
            requestedAt: membership.requested_at,
            approvedAt: membership.approved_at || undefined,
          });
        } catch (e) {
          console.error(`[GET /api/boss/employees] Error processing user ${membership.user_id}:`, e);
          // Continue processing other staff members
        }
      }
    }

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
