import { NextResponse } from "next/server";

import { canReadNotice, type NoticeAudience, type NoticeMembership, type NoticeTargetType } from "@/lib/notices/notice-authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export interface StaffNoticeItem {
  id: string;
  targetType: NoticeTargetType;
  targetStoreName: string | null; // "본사 전체" (all일 때) 또는 매장명 (store일 때)
  title: string;
  content: string;
  createdAt: string;
}

type NoticeRow = {
  id: string;
  franchise_id: string;
  target_type: NoticeTargetType;
  target_store_id: string | null;
  audience: NoticeAudience;
  title: string;
  content: string;
  created_at: string;
};

function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export async function GET(): Promise<NextResponse> {
  try {
    // 1. 로그인 사용자 확인
    const sessionClient = await createClient();
    const { data, error: authError } = await sessionClient.auth.getUser();

    if (authError || !data.user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const userId = data.user.id;

    // 2. Role은 profiles, 공지 범위는 승인된 store membership에서 확인한다.
    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle<{ role: string }>();

    if (profileError || !profile) {
      return NextResponse.json({ error: "사용자 정보를 찾을 수 없습니다." }, { status: 403 });
    }

    if (profile.role !== "staff") {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    // 3. 이 직원의 승인된 STAFF membership만 대상 store로 사용한다.
    const { data: memberships, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("store_id, franchise_id")
      .eq("user_id", userId)
      .eq("role", "staff")
      .eq("status", "approved")

    if (membershipError) {
      console.error("Error fetching memberships:", membershipError);
      return NextResponse.json({ error: "매장 정보를 불러오지 못했습니다." }, { status: 500 });
    }

    const requestedStoreIds = [...new Set((memberships ?? []).map((membership) => membership.store_id))];
    if (requestedStoreIds.length === 0) {
      return NextResponse.json({ notices: [] });
    }

    const { data: stores, error: storesError } = await adminClient
      .from("stores")
      .select("id, store_name, franchise_id")
      .in("id", requestedStoreIds);
    if (storesError) {
      console.error("Error fetching membership stores:", storesError);
      return NextResponse.json({ error: "매장 정보를 불러오지 못했습니다." }, { status: 500 });
    }

    const storesById = new Map((stores ?? []).map((store) => [store.id, store]));
    const approvedMemberships: NoticeMembership[] = (memberships ?? []).flatMap((membership) => {
      const store = storesById.get(membership.store_id);
      if (!store?.franchise_id || (membership.franchise_id && membership.franchise_id !== store.franchise_id)) {
        return [];
      }
      return [{
        storeId: membership.store_id,
        franchiseId: store.franchise_id,
        role: "staff",
        status: "approved",
      }];
    });
    const approvedStoreIds = [...new Set(approvedMemberships.map((membership) => membership.storeId))];
    const franchiseIds = [...new Set(approvedMemberships.map((membership) => membership.franchiseId).filter(
      (franchiseId): franchiseId is string => franchiseId !== null,
    ))];
    if (approvedStoreIds.length === 0 || franchiseIds.length === 0) {
      return NextResponse.json({ notices: [] });
    }

    // Read both franchise-wide notices (including the legacy "all" value)
    // and notices targeted to this employee's approved stores.
    const [franchiseResult, storeResult] = await Promise.all([
      adminClient
        .from("notices")
        .select("id, franchise_id, target_type, target_store_id, audience, title, content, created_at")
        .in("franchise_id", franchiseIds)
        .in("target_type", ["all", "franchise"])
        .in("audience", ["all_members", "staff"])
        .order("created_at", { ascending: false }),
      adminClient
        .from("notices")
        .select("id, franchise_id, target_type, target_store_id, audience, title, content, created_at")
        .in("target_store_id", approvedStoreIds)
        .eq("target_type", "store")
        .in("audience", ["all_members", "staff"])
        .order("created_at", { ascending: false }),
    ]);

    for (const result of [franchiseResult, storeResult]) {
      if (result.error && !isMissingTableError(result.error)) {
        console.error("Error fetching notices:", result.error);
        return NextResponse.json({ error: "공지사항을 불러오지 못했습니다." }, { status: 500 });
      }
    }

    const noticesData = [
      ...((franchiseResult.data ?? []) as NoticeRow[]),
      ...((storeResult.data ?? []) as NoticeRow[]),
    ]
      .filter((row) => canReadNotice("staff", approvedMemberships, {
        franchiseId: row.franchise_id,
        targetType: row.target_type,
        targetStoreId: row.target_store_id,
        audience: row.audience,
      }))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 1000);

    // 7. 응답 구성
    const notices: StaffNoticeItem[] = (noticesData ?? []).map((row: NoticeRow) => ({
      id: row.id,
      targetType: row.target_type,
      targetStoreName:
        row.target_type === "all"
          ? "프랜차이즈 전체"
          : row.target_store_id
            ? storesById.get(row.target_store_id)?.store_name ?? null
            : null,
      title: row.title,
      content: row.content,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ notices });
  } catch (error) {
    console.error("GET /api/staff/notices error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
