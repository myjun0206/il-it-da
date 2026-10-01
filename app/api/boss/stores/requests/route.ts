import { NextResponse, type NextRequest } from "next/server";

import { createDiagnosticRequestId, logDiagnosticError } from "@/lib/auth/diagnostic-error-log";
import { submitStoreMembershipRequest } from "@/lib/signup/store-membership-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveFranchiseIdForStoreName } from "@/lib/supabase/resolve-store-franchise";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type OwnerStoreRequestCode = "NOT_OWNER" | "STORE_BRAND_UNKNOWN" | "STORE_NOT_FOUND";

type OwnerStoreRequestResponse = {
  success: boolean;
  membershipId?: string;
  created?: boolean;
  membershipStatus?: string;
  code?: OwnerStoreRequestCode;
  error?: string;
  requestId?: string;
};

export const STORE_BRAND_UNKNOWN_MESSAGE =
  "이 매장의 브랜드 정보가 연결되어 있지 않아 신청할 수 없습니다. 본사에 문의해 주세요.";

/**
 * 승인된 점주의 "추가 운영 매장" 신청.
 * - 로그인 사용자의 마스터 profiles(role = owner, approval_status = approved)만 확인한다.
 *   023 이후 마스터 행의 brand_id는 항상 NULL이므로 brand_id로 신청을 막지 않는다.
 * - 신청 대상의 브랜드는 서버에서 stores.franchise_id로 확인하고, 확인되지 않으면 거절한다.
 *   (요청 본문의 브랜드 값은 읽지 않으며, 기존 매장의 브랜드를 바꾸지 않는다)
 * - 다른 브랜드 매장도 신청할 수 있다. 실제 권한은 HQ 승인 시점에 생긴다.
 * - 매장 조회/생성과 owner pending membership 생성, HQ 알림은 가입 신청과 같은 서비스를 재사용한다.
 *   (중복이면 기존 membership을 그대로 반환하고, 승인은 기존 HQ 승인 화면/API에서만 한다)
 */
export async function POST(request: NextRequest): Promise<NextResponse<OwnerStoreRequestResponse>> {
  const requestId = createDiagnosticRequestId();
  let stage = "session.get_user";
  let userId: string | null = null;
  let requestedStoreId: string | null = null;
  let hasStoreName = false;
  const hasSessionCookie = request.cookies.getAll().some(({ name }) => name === "il-it-da-auth-session" || name.startsWith("il-it-da-auth-session."));
  const proxyRequestId = request.headers.get("x-proxy-request-id") ?? undefined;
  const respond = (body: OwnerStoreRequestResponse, status: number) =>
    NextResponse.json(status >= 500 ? { ...body, requestId } : body, {
      status,
      headers: { "Cache-Control": "private, no-store, max-age=0", "X-Request-Id": requestId },
    });

  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();
    if (userError || !userData.user) {
      logDiagnosticError("OWNER_STORE_REQUEST", stage, userError ?? new Error("Supabase returned no authenticated user"), {
        requestId,
        path: "/api/boss/stores/requests",
        hasSessionCookie,
        proxyRequestId,
        sessionPresent: false,
      });
      return respond({ success: false, error: "로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요." }, 401);
    }
    userId = userData.user.id;

    stage = "request.parse";
    let body: { storeId?: unknown; storeName?: unknown };
    try {
      body = (await request.json()) as { storeId?: unknown; storeName?: unknown };
    } catch (error) {
      logDiagnosticError("OWNER_STORE_REQUEST", stage, error, {
        requestId,
        proxyRequestId,
        userId,
        hasSessionCookie,
        sessionPresent: true,
      });
      return respond({ success: false, error: "요청 형식이 올바르지 않습니다." }, 400);
    }

    const storeName = typeof body.storeName === "string" ? body.storeName.trim() : "";
    requestedStoreId = typeof body.storeId === "string" && body.storeId.trim() ? body.storeId.trim() : null;
    hasStoreName = Boolean(storeName);
    if (!storeName) {
      return respond({ success: false, error: "매장을 선택해 주세요." }, 400);
    }

    stage = "profile.lookup";
    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, approval_status, full_name")
      .eq("id", userData.user.id)
      .maybeSingle<{ role: string; approval_status: string | null; full_name: string | null }>();

    if (profileError) throw profileError;
    if (profile?.role !== "owner" || profile.approval_status !== "approved") {
      return NextResponse.json(
        { success: false, code: "NOT_OWNER", error: "승인된 점주만 운영 매장을 추가할 수 있습니다." },
        { status: 403 },
      );
    }

    // 대상 매장의 브랜드는 서버에서만 정한다. storeId가 있으면 그 매장 행의 franchise_id가 기준이고,
    // 없을 때만 기존 가입 경로와 같은 매장명 resolver를 쓴다.
    let storeFranchiseId: string | null = null;

    if (requestedStoreId) {
      stage = "store.brand_lookup";
      const { data: store, error: storeError } = await adminClient
        .from("stores")
        .select("franchise_id")
        .eq("id", requestedStoreId)
        .maybeSingle<{ franchise_id: string | null }>();

      if (storeError) throw storeError;
      storeFranchiseId = store?.franchise_id ?? null;
    } else {
      stage = "store.franchise_resolve";
      storeFranchiseId = await resolveFranchiseIdForStoreName(adminClient, storeName, { requestId, userId });
    }

    if (!storeFranchiseId) {
      return NextResponse.json(
        { success: false, code: "STORE_BRAND_UNKNOWN", error: STORE_BRAND_UNKNOWN_MESSAGE },
        { status: 400 },
      );
    }

    stage = "membership.submit";
    const result = await submitStoreMembershipRequest(adminClient, {
      userId: userData.user.id,
      userName: profile.full_name || userData.user.user_metadata?.name || userData.user.email || "점주",
      role: "owner",
      storeId: requestedStoreId ?? undefined,
      storeName,
      franchiseId: storeFranchiseId,
      currentApprovalStatus: profile.approval_status,
      diagnosticRequestId: requestId,
    });

    if (result.status >= 500) {
      logDiagnosticError("OWNER_STORE_REQUEST", stage, new Error(result.error || "Membership request failed"), {
        requestId,
        userId,
        role: "owner",
        storeId: requestedStoreId,
        franchiseId: storeFranchiseId,
        storeName,
        hasSessionCookie,
        proxyRequestId,
        sessionPresent: true,
      });
    }

    return respond(
      {
        success: result.success,
        membershipId: result.membershipId,
        created: result.created,
        membershipStatus: result.membershipStatus,
        // STORE_NO_OWNER는 직원 신청에서만 나오는 코드라 점주 신청 응답에는 싣지 않는다.
        code: result.code === "STORE_NOT_FOUND" || result.code === "STORE_BRAND_UNKNOWN" ? result.code : undefined,
        error: result.success ? undefined : "운영 신청을 처리하지 못했습니다.",
      },
      result.status,
    );
  } catch (error) {
    logDiagnosticError("OWNER_STORE_REQUEST", stage, error, {
      requestId,
      proxyRequestId,
      userId,
      role: "owner",
      storeId: requestedStoreId,
      hasStoreName,
      hasSessionCookie,
      sessionPresent: Boolean(userId),
    });
    return respond({ success: false, error: "일시적인 서버 오류로 운영 신청을 처리하지 못했습니다." }, 500);
  }
}
