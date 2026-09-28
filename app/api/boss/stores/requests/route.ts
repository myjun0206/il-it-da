import { NextResponse, type NextRequest } from "next/server";

import { logSafeAuthError } from "@/lib/auth/safe-auth-log";
import { submitStoreMembershipRequest } from "@/lib/signup/store-membership-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveFranchiseIdForStoreName } from "@/lib/supabase/resolve-store-franchise";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type OwnerStoreRequestCode = "NOT_OWNER" | "NO_BRAND" | "BRAND_MISMATCH" | "STORE_NOT_FOUND";

type OwnerStoreRequestResponse = {
  success: boolean;
  membershipId?: string;
  created?: boolean;
  membershipStatus?: string;
  code?: OwnerStoreRequestCode;
  error?: string;
};

/**
 * 승인된 점주의 "추가 운영 매장" 신청.
 * - 로그인 사용자의 profiles.role = owner, approval_status = approved 여야 한다.
 * - 신청 매장의 브랜드(franchise, 기존 매장명 → 프랜차이즈 resolver)가 점주 본인의 profiles.brand_id와 같아야 한다.
 * - 매장 조회/생성과 owner pending membership 생성, HQ 알림은 가입 신청과 같은 서비스를 재사용한다.
 *   (중복이면 기존 membership을 그대로 반환하고, 승인은 기존 HQ 승인 화면/API에서만 한다)
 */
export async function POST(request: NextRequest): Promise<NextResponse<OwnerStoreRequestResponse>> {
  const serverClient = await createClient();
  const { data: userData, error: userError } = await serverClient.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ success: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: { storeId?: unknown; storeName?: unknown };
  try {
    body = (await request.json()) as { storeId?: unknown; storeName?: unknown };
  } catch {
    return NextResponse.json({ success: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const storeName = typeof body.storeName === "string" ? body.storeName.trim() : "";
  if (!storeName) {
    return NextResponse.json({ success: false, error: "매장을 선택해 주세요." }, { status: 400 });
  }

  try {
    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, approval_status, brand_id, full_name")
      .eq("id", userData.user.id)
      .maybeSingle<{ role: string; approval_status: string | null; brand_id: string | null; full_name: string | null }>();

    if (profileError) throw profileError;
    if (profile?.role !== "owner" || profile.approval_status !== "approved") {
      return NextResponse.json(
        { success: false, code: "NOT_OWNER", error: "승인된 점주만 운영 매장을 추가할 수 있습니다." },
        { status: 403 },
      );
    }
    if (!profile.brand_id) {
      return NextResponse.json(
        { success: false, code: "NO_BRAND", error: "소속 브랜드 정보가 없어 운영 매장을 추가할 수 없습니다." },
        { status: 403 },
      );
    }

    // 신청 매장의 브랜드를 기존 resolver(프랜차이즈 테이블 기준)로 판별하고, 점주 브랜드 UUID와 비교한다.
    const storeFranchiseId = await resolveFranchiseIdForStoreName(adminClient, storeName);
    if (!storeFranchiseId || storeFranchiseId !== profile.brand_id) {
      return NextResponse.json(
        { success: false, code: "BRAND_MISMATCH", error: "소속 브랜드의 매장만 운영 신청할 수 있습니다." },
        { status: 403 },
      );
    }

    const result = await submitStoreMembershipRequest(adminClient, {
      userId: userData.user.id,
      userName: profile.full_name || userData.user.user_metadata?.name || userData.user.email || "점주",
      role: "owner",
      storeId: typeof body.storeId === "string" ? body.storeId : undefined,
      storeName,
      franchiseId: profile.brand_id,
      currentApprovalStatus: profile.approval_status,
    });

    return NextResponse.json(
      {
        success: result.success,
        membershipId: result.membershipId,
        created: result.created,
        membershipStatus: result.membershipStatus,
        code: result.code,
        error: result.success ? undefined : "운영 신청을 처리하지 못했습니다.",
      },
      { status: result.status },
    );
  } catch (error) {
    logSafeAuthError("OWNER_STORE_REQUEST_FAILED", error);
    return NextResponse.json({ success: false, error: "운영 신청을 처리하지 못했습니다." }, { status: 500 });
  }
}
