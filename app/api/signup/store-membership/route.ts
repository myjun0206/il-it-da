import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { upsertSignupProfile, submitStoreMembershipRequest } from "@/lib/signup/store-membership-service";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";
import { createDiagnosticRequestId, logDiagnosticError } from "@/lib/auth/diagnostic-error-log";

export const runtime = "nodejs";

const DATABASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CreateMembershipRequest {
  storeId?: string;
  storeName?: string;
  role: "owner" | "staff";
  franchiseId?: string;
}

interface CreateMembershipResponse {
  success: boolean;
  membershipId?: string;
  created?: boolean;
  membershipStatus?: string;
  code?: string;
  error?: string;
  details?: string;
  requestId?: string;
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
  const requestId = createDiagnosticRequestId();
  let stage = "request.parse";
  let userId: string | null = null;
  let requestedRole: string | undefined;
  let requestedStoreId: string | undefined;
  let requestedStoreName: string | undefined;
  let requestedFranchiseId: string | undefined;
  let userName: string | undefined;
  let databaseTable: string | undefined;
  const logFailure = (error: unknown) => logDiagnosticError("STORE_MEMBERSHIP_POST", stage, error, {
    requestId,
    path: "/api/signup/store-membership",
    userId,
    role: requestedRole,
    storeId: requestedStoreId,
    storeName: requestedStoreName,
    franchiseId: requestedFranchiseId,
    userName,
    table: databaseTable,
    sessionPresent: Boolean(userId),
  });
  const respond = (body: CreateMembershipResponse, status: number) => NextResponse.json(
    status >= 400 ? { ...body, requestId } : body,
    { status, headers: { "Cache-Control": "private, no-store, max-age=0", "X-Request-Id": requestId } },
  );

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      logFailure(error);
      return respond({ success: false, error: "요청 형식이 올바르지 않습니다." }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return respond({ success: false, error: "요청 형식이 올바르지 않습니다." }, 400);
    }

    const fields = body as Record<string, unknown>;
    if (["storeId", "storeName", "franchiseId"].some((field) => fields[field] != null && typeof fields[field] !== "string")) {
      return respond({ success: false, error: "매장 정보 형식이 올바르지 않습니다." }, 400);
    }
    const role = fields.role;

    if (!role || (role !== "owner" && role !== "staff")) {
      return respond({ success: false, error: "신청 역할이 올바르지 않습니다." }, 400);
    }
    const { storeId, storeName, franchiseId } = body as CreateMembershipRequest;
    requestedRole = role;
    requestedStoreId = storeId?.trim() || undefined;
    requestedStoreName = storeName?.trim() || undefined;
    requestedFranchiseId = franchiseId?.trim() || undefined;
    if (
      (requestedStoreId && !DATABASE_UUID_PATTERN.test(requestedStoreId)) ||
      (requestedFranchiseId && !DATABASE_UUID_PATTERN.test(requestedFranchiseId))
    ) {
      return respond({ success: false, error: "선택한 매장 또는 브랜드 정보가 올바르지 않습니다. 다시 선택해 주세요." }, 400);
    }
    if (!requestedStoreId && !requestedStoreName) {
      return respond({ success: false, error: "신청할 매장을 선택해 주세요." }, 400);
    }

    // 서버에서 현재 인증된 사용자를 직접 가져옴 (클라이언트 userId 신뢰 안 함)
    stage = "session.get_user";
    const serverClient = await createClient();
    const { data: { user }, error: userError } = await serverClient.auth.getUser();

    if (userError || !user) {
      logFailure(userError ?? new Error("No authenticated user"));
      return respond({ success: false, error: "로그인 정보를 확인할 수 없습니다." }, 401);
    }

    userId = user.id;

    stage = "admin_client.create";
    const adminClient = createAdminClient();
    stage = "profile.authorization_lookup";
    databaseTable = "profiles";
    const { data: authorizedProfile, error: authorizedProfileError } = await adminClient
      .from("profiles")
      .select("role, approval_status")
      .eq("id", userId)
      .maybeSingle<{ role: string; approval_status: string | null }>();

    if (authorizedProfileError) {
      logFailure(authorizedProfileError);
      return respond({ success: false, error: "신청 권한을 확인하지 못했습니다." }, 500);
    }

    const hasSocialIdentity = user.identities?.some(
      (identity) => identity.provider === "google" || identity.provider === "kakao" || identity.provider === "apple" || identity.provider === "custom:naver",
    );
    const isEmailSignup = user.app_metadata?.provider === "email" && !hasSocialIdentity;
    const canCreateInitialEmailProfile =
      !authorizedProfile && isEmailSignup && user.user_metadata?.role === role;

    if (authorizedProfile?.role !== role && !canCreateInitialEmailProfile) {
      return respond({ success: false, error: "로그인한 계정의 역할과 신청 역할이 일치하지 않습니다." }, 403);
    }

    // profiles row 생성 또는 업데이트 (full_name이 없으면 채우기)
    userName = typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim()
      ? user.user_metadata.name.trim()
      : user.email || (role === "staff" ? "알바" : "점주");
    const userPhone = typeof user.user_metadata?.phone === "string" ? user.user_metadata.phone : null;

    stage = "profile.upsert";
    const profileResult = authorizedProfile?.approval_status === "approved" ? { success: true } : await upsertSignupProfile(adminClient, {
      userId,
      email: user.email ?? null,
      role,
      name: userName,
      phone: userPhone,
      diagnosticRequestId: requestId,
    });

    if (!profileResult.success) {
      logFailure(new Error(profileResult.details ?? profileResult.error ?? "Profile write failed"));
      return respond({ success: false, error: "신청자 정보를 저장하지 못했습니다." }, 500);
    }

    // 매장 조회/생성 + store_memberships row 생성 + 알림 발송
    stage = "membership.submit";
    databaseTable = "stores,store_memberships";
    const membershipResult = await submitStoreMembershipRequest(adminClient, {
      userId,
      userName,
      role,
      storeId: requestedStoreId,
      storeName: requestedStoreName,
      franchiseId: requestedFranchiseId,
      currentApprovalStatus: authorizedProfile?.approval_status ?? null,
      diagnosticRequestId: requestId,
    });

    if (membershipResult.status >= 500) {
      logFailure(new Error(membershipResult.error || "Membership request failed"));
    }

    return respond(
      {
        success: membershipResult.success,
        membershipId: membershipResult.membershipId,
        created: membershipResult.created,
        membershipStatus: membershipResult.membershipStatus,
        code: membershipResult.code,
        error: membershipResult.status >= 500 ? "근무 또는 운영 신청을 처리하지 못했습니다." : membershipResult.error,
        // 서버 오류(5xx)의 내부 DB 메시지는 클라이언트로 보내지 않는다.
        details: membershipResult.status < 500 ? membershipResult.details : undefined,
      },
      membershipResult.status,
    );
  } catch (error) {
    logFailure(error);
    return respond({ success: false, error: "일시적인 서버 오류로 신청을 처리하지 못했습니다." }, 500);
  }
}
