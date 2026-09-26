import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { upsertSignupProfile, submitStoreMembershipRequest } from "@/lib/signup/store-membership-service";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";

export const runtime = "nodejs";

interface CreateMembershipRequest {
  storeId?: string;
  storeName?: string;
  role: "owner" | "staff";
  franchiseId?: string;
}

interface CreateMembershipResponse {
  success: boolean;
  membershipId?: string;
  error?: string;
  details?: string;
}

interface MembershipWithStore {
  membershipId: string;
  storeId: string;
  storeName: string;
  role: "owner" | "staff";
  status: "pending" | "approved" | "rejected";
  requestedAt?: string;
}

export async function GET(): Promise<NextResponse> {
  try {
    // 현재 인증된 사용자 확보
    const serverClient = await createClient();
    const { data: { user }, error: userError } = await serverClient.auth.getUser();

    if (userError || !user) {
      if (userError) {
        logSafeAuthError("STORE_MEMBERSHIP_GET_UNAUTHENTICATED", userError);
      }
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = user.id;

    const adminClient = createAdminClient();

    // 사용자의 모든 membership을 조회한다. 승인 상태 화면과 역할별 화면이 필요한 상태만 필터링한다.
    const { data: memberships, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("*")
      .eq("user_id", userId);

    if (membershipError) {
      logSafeAuthError("STORE_MEMBERSHIP_GET_FETCH_FAILED", membershipError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch memberships" },
        { status: 500 }
      );
    }

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    // membership의 store_id 목록으로 stores 정보 조회
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeIds = [...new Set((memberships as any[]).map((m: any) => m.store_id).filter(Boolean))];

    if (storeIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    const { data: stores, error: storeError } = await adminClient
      .from("stores")
      .select("id, store_name")
      .in("id", storeIds);

    if (storeError) {
      logSafeAuthError("STORE_MEMBERSHIP_GET_STORES_FAILED", storeError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch stores" },
        { status: 500 }
      );
    }

    // store_id → store_name 맵 생성
    const storeMap = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stores?.map((s: any) => [s.id, s.store_name]) || []
    );

    // membership과 store 정보 결합
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: MembershipWithStore[] = (memberships as any[]).map((m: any) => ({
      membershipId: m.id,
      storeId: m.store_id,
      storeName: storeMap.get(m.store_id) || "Unknown Store",
      role: m.role,
      status: m.status,
      requestedAt: m.requested_at,
    }));

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logSafeAuthError("STORE_MEMBERSHIP_GET_UNEXPECTED", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<NextResponse<CreateMembershipResponse>> {
  try {
    // 요청 본문 파싱
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { storeId, storeName, role, franchiseId } = body as CreateMembershipRequest;

    if (!role || (role !== "owner" && role !== "staff")) {
      return NextResponse.json(
        { success: false, error: "role must be 'owner' or 'staff'" },
        { status: 400 }
      );
    }

    // 서버에서 현재 인증된 사용자를 직접 가져옴 (클라이언트 userId 신뢰 안 함)
    const serverClient = await createClient();
    const { data: { user }, error: userError } = await serverClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: No authenticated user" },
        { status: 401 }
      );
    }

    const userId = user.id;

    const adminClient = createAdminClient();
    const { data: authorizedProfile, error: authorizedProfileError } = await adminClient
      .from("profiles")
      .select("role, approval_status")
      .eq("id", userId)
      .maybeSingle<{ role: string; approval_status: string | null }>();

    if (authorizedProfileError) {
      return NextResponse.json(
        { success: false, error: "Unable to verify authenticated profile" },
        { status: 500 }
      );
    }

    const hasSocialIdentity = user.identities?.some(
      (identity) => identity.provider === "google" || identity.provider === "kakao" || identity.provider === "apple" || identity.provider === "custom:naver",
    );
    const isEmailSignup = user.app_metadata?.provider === "email" && !hasSocialIdentity;
    const canCreateInitialEmailProfile =
      !authorizedProfile && isEmailSignup && user.user_metadata?.role === role;

    if (authorizedProfile?.role !== role && !canCreateInitialEmailProfile) {
      return NextResponse.json(
        { success: false, error: "Forbidden: role does not match authenticated profile" },
        { status: 403 }
      );
    }

    // profiles row 생성 또는 업데이트 (full_name이 없으면 채우기)
    const userName = user.user_metadata?.name || user.email || "Unknown User";
    const userPhone = typeof user.user_metadata?.phone === "string" ? user.user_metadata.phone : null;

    const profileResult = await upsertSignupProfile(adminClient, {
      userId,
      email: user.email ?? null,
      role,
      name: userName,
      phone: userPhone,
    });

    if (!profileResult.success) {
      return NextResponse.json(
        { success: false, error: profileResult.error, details: profileResult.details },
        { status: 500 }
      );
    }

    // 매장 조회/생성 + store_memberships row 생성 + 알림 발송
    const membershipResult = await submitStoreMembershipRequest(adminClient, {
      userId,
      userName,
      role,
      storeId,
      storeName,
      franchiseId,
      currentApprovalStatus: authorizedProfile?.approval_status ?? null,
    });

    return NextResponse.json(
      {
        success: membershipResult.success,
        membershipId: membershipResult.membershipId,
        error: membershipResult.error,
        details: membershipResult.details,
      },
      { status: membershipResult.status }
    );
  } catch (error) {
    logSafeAuthError("STORE_MEMBERSHIP_POST_UNEXPECTED", error);
    return NextResponse.json(
      { success: false, error: "Unexpected error", details: String(error) },
      { status: 500 }
    );
  }
}
