import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export interface StaffNoticeItem {
  id: string;
  targetType: "all" | "store";
  targetStoreName: string | null; // "본사 전체" (all일 때) 또는 매장명 (store일 때)
  title: string;
  content: string;
  createdAt: string;
}

type NoticeRow = {
  id: string;
  target_type: "all" | "store";
  target_store_id: string | null;
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

    // 2. Staff 권한 확인 및 franchise_id 조회
    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, franchise_id")
      .eq("id", userId)
      .maybeSingle<{ role: string; franchise_id: string }>();

    if (profileError || !profile) {
      return NextResponse.json({ error: "사용자 정보를 찾을 수 없습니다." }, { status: 403 });
    }

    if (profile.role !== "staff") {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    if (!profile.franchise_id) {
      return NextResponse.json({ notices: [] });
    }

    // 3. 사용자의 approved store IDs 조회
    const { data: memberships, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("store_id")
      .eq("user_id", userId)
      .eq("status", "approved")
      .eq("franchise_id", profile.franchise_id);

    if (membershipError) {
      console.error("Error fetching memberships:", membershipError);
      return NextResponse.json({ error: "매장 정보를 불러오지 못했습니다." }, { status: 500 });
    }

    const approvedStoreIds = (memberships ?? []).map((m: { store_id: string }) => m.store_id);

    // 4. 공지 조회
    // - target_type = 'all' (본사 공지)
    // - target_type = 'store' AND target_store_id IN (approvedStoreIds)
    const baseQuery = adminClient
      .from("notices")
      .select("id, target_type, target_store_id, title, content, created_at")
      .eq("franchise_id", profile.franchise_id)
      .order("created_at", { ascending: false });

    let noticesData: NoticeRow[] = [];

    // 본사 공지
    const { data: hqNotices, error: hqError } = await baseQuery.eq("target_type", "all");

    if (hqError && !isMissingTableError(hqError)) {
      console.error("Error fetching HQ notices:", hqError);
      return NextResponse.json({ error: "공지사항을 불러오지 못했습니다." }, { status: 500 });
    }

    noticesData = (hqNotices ?? []) as NoticeRow[];

    // 매장 공지
    if (approvedStoreIds.length > 0) {
      const { data: storeNotices, error: storeError } = await adminClient
        .from("notices")
        .select("id, target_type, target_store_id, title, content, created_at")
        .eq("franchise_id", profile.franchise_id)
        .eq("target_type", "store")
        .in("target_store_id", approvedStoreIds)
        .order("created_at", { ascending: false });

      if (storeError && !isMissingTableError(storeError)) {
        console.error("Error fetching store notices:", storeError);
        return NextResponse.json({ error: "공지사항을 불러오지 못했습니다." }, { status: 500 });
      }

      noticesData = [...noticesData, ...(storeNotices ?? [])]
        .sort((a: NoticeRow, b: NoticeRow) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 1000) as NoticeRow[];
    }

    // 5. Store 이름 조회 (metadata)
    const storeIds = [
      ...new Set(
        (noticesData ?? [])
          .filter((row: NoticeRow) => row.target_type === "store" && row.target_store_id)
          .map((row: NoticeRow) => row.target_store_id)
      ),
    ].filter((id): id is string => Boolean(id));

    const storeNames = new Map<string, string>();
    if (storeIds.length > 0) {
      const { data: stores } = await adminClient
        .from("stores")
        .select("id, store_name")
        .in("id", storeIds)
        .eq("franchise_id", profile.franchise_id);

      for (const store of stores ?? []) {
        storeNames.set(store.id, store.store_name);
      }
    }

    // 7. 응답 구성
    const notices: StaffNoticeItem[] = (noticesData ?? []).map((row: NoticeRow) => ({
      id: row.id,
      targetType: row.target_type,
      targetStoreName:
        row.target_type === "all"
          ? "본사 전체"
          : row.target_store_id
            ? storeNames.get(row.target_store_id) ?? null
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
