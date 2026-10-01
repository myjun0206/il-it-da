import { NextResponse } from "next/server";

import { requireServerRole } from "@/lib/auth/require-server-role";
import {
  STAFF_STORE_PREFERENCES_KEY,
  sanitizeStorePreferences,
  type StaffStorePreferences,
} from "@/lib/staff/store-preferences";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type AdminClient = ReturnType<typeof createAdminClient>;

/** 본인의 승인 완료된 직원 근무 매장 id (기본 매장/순서로 지정할 수 있는 범위) */
async function loadApprovedStoreIds(adminClient: AdminClient, userId: string): Promise<string[]> {
  const { data, error } = await adminClient
    .from("store_memberships")
    .select("store_id")
    .eq("user_id", userId)
    .eq("role", "staff")
    .eq("status", "approved");
  if (error) throw error;
  return (data ?? []).map((row: { store_id: string }) => row.store_id);
}

/**
 * 직원 근무 매장 개인 설정(기본 매장 + 표시 순서).
 * 로그인 사용자 본인의 auth user_metadata에만 저장한다 → 다른 직원의 설정에 영향을 줄 수 없고, 다시 로그인해도 유지된다.
 * 저장/조회 모두 "본인의 approved staff membership" 범위로 정리한다(승인 대기·제외된 매장은 자동으로 빠진다).
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireServerRole("staff");
  if (auth.status === "UNAUTHENTICATED") return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (auth.status !== "AUTHORIZED") return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });

  try {
    const adminClient = createAdminClient();
    const [approvedStoreIds, { data: userData, error: userError }] = await Promise.all([
      loadApprovedStoreIds(adminClient, auth.userId),
      adminClient.auth.admin.getUserById(auth.userId),
    ]);
    if (userError || !userData.user) throw userError ?? new Error("user not found");

    const preferences = sanitizeStorePreferences(
      userData.user.user_metadata?.[STAFF_STORE_PREFERENCES_KEY],
      approvedStoreIds,
    );
    return NextResponse.json({ preferences });
  } catch (error) {
    console.error("GET /api/staff/store-preferences error:", error);
    return NextResponse.json({ error: "근무 매장 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  const auth = await requireServerRole("staff");
  if (auth.status === "UNAUTHENTICATED") return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (auth.status !== "AUTHORIZED") return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const adminClient = createAdminClient();
    const approvedStoreIds = await loadApprovedStoreIds(adminClient, auth.userId);
    const preferences: StaffStorePreferences = sanitizeStorePreferences(body, approvedStoreIds);

    // 기본 매장은 승인 완료된 매장만 지정할 수 있다. (승인 대기/미소속 매장 id를 보내면 거부)
    const requestedDefault = (body as { defaultStoreId?: unknown } | null)?.defaultStoreId;
    if (typeof requestedDefault === "string" && requestedDefault && preferences.defaultStoreId !== requestedDefault) {
      return NextResponse.json(
        { error: "승인 완료된 근무 매장만 기본 매장으로 지정할 수 있습니다.", code: "STORE_NOT_APPROVED" },
        { status: 400 },
      );
    }

    const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(auth.userId);
    if (userError || !userData.user) throw userError ?? new Error("user not found");

    const { error: updateError } = await adminClient.auth.admin.updateUserById(auth.userId, {
      user_metadata: { ...(userData.user.user_metadata ?? {}), [STAFF_STORE_PREFERENCES_KEY]: preferences },
    });
    if (updateError) throw updateError;

    return NextResponse.json({ preferences });
  } catch (error) {
    console.error("PUT /api/staff/store-preferences error:", error);
    return NextResponse.json({ error: "근무 매장 설정을 저장하지 못했습니다." }, { status: 500 });
  }
}
