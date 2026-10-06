import { NextResponse } from "next/server";

import {
  canRecordNoticeRead,
  type NoticeAudience,
  type NoticeMembership,
  type NoticeRole,
  type NoticeTargetType,
} from "@/lib/notices/notice-authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type NoticeReadRow = {
  id: string;
  franchise_id: string;
  author_id: string | null;
  target_type: NoticeTargetType;
  target_store_id: string | null;
  audience: NoticeAudience;
};

type MembershipRow = {
  store_id: string;
  franchise_id: string | null;
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id: noticeId } = await params;
    if (!noticeId?.trim()) {
      return NextResponse.json({ error: "공지를 찾을 수 없습니다." }, { status: 404 });
    }

    const sessionClient = await createClient();
    const { data: { user }, error: authError } = await sessionClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle<{ role: string }>();

    if (profileError) {
      return NextResponse.json({ error: "사용자 권한을 확인하지 못했습니다." }, { status: 500 });
    }
    if (profile?.role !== "owner" && profile?.role !== "staff") {
      return NextResponse.json({ error: "공지 수신 대상 사용자만 읽음 처리할 수 있습니다." }, { status: 403 });
    }
    const role: Exclude<NoticeRole, "hq"> = profile.role;

    const { data: notice, error: noticeError } = await adminClient
      .from("notices")
      .select("id, franchise_id, author_id, target_type, target_store_id, audience")
      .eq("id", noticeId)
      .maybeSingle<NoticeReadRow>();

    if (noticeError) {
      console.error("POST /api/notices/[id]/read lookup error:", noticeError);
      return NextResponse.json({ error: "공지를 확인하지 못했습니다." }, { status: 500 });
    }
    if (!notice) {
      return NextResponse.json({ error: "공지를 찾을 수 없습니다." }, { status: 404 });
    }

    const { data: memberships, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("store_id, franchise_id")
      .eq("user_id", user.id)
      .eq("role", role)
      .eq("status", "approved");

    if (membershipError) {
      console.error("POST /api/notices/[id]/read membership lookup error:", membershipError);
      return NextResponse.json({ error: "매장 권한을 확인하지 못했습니다." }, { status: 500 });
    }

    const membershipRows = (memberships ?? []) as MembershipRow[];
    if (membershipRows.length === 0) {
      return NextResponse.json({ error: "승인된 매장 권한이 없습니다." }, { status: 403 });
    }

    const storeIds = [...new Set([
      ...membershipRows.map((membership) => membership.store_id),
      ...(notice.target_store_id ? [notice.target_store_id] : []),
    ])];
    const { data: stores, error: storesError } = await adminClient
      .from("stores")
      .select("id, franchise_id")
      .in("id", storeIds);

    if (storesError) {
      console.error("POST /api/notices/[id]/read store lookup error:", storesError);
      return NextResponse.json({ error: "매장 정보를 확인하지 못했습니다." }, { status: 500 });
    }

    const storesById = new Map((stores ?? []).map((store) => [store.id, store]));
    const authorizedMemberships: NoticeMembership[] = membershipRows.flatMap((membership) => {
      const store = storesById.get(membership.store_id);
      if (
        !store?.franchise_id
        || (membership.franchise_id && membership.franchise_id !== store.franchise_id)
      ) {
        return [];
      }

      return [{
        storeId: membership.store_id,
        franchiseId: store.franchise_id,
        role,
        status: "approved",
      }];
    });

    if (notice.target_type === "store") {
      const targetStore = notice.target_store_id ? storesById.get(notice.target_store_id) : null;
      if (!targetStore?.franchise_id || targetStore.franchise_id !== notice.franchise_id) {
        return NextResponse.json({ error: "공지의 매장 범위가 올바르지 않습니다." }, { status: 403 });
      }
    }

    if (!canRecordNoticeRead(user.id, role, {
      franchiseId: notice.franchise_id,
      targetType: notice.target_type,
      targetStoreId: notice.target_store_id,
      audience: notice.audience,
      authorId: notice.author_id,
    }, authorizedMemberships)) {
      return NextResponse.json({ error: "이 공지를 읽을 권한이 없습니다." }, { status: 403 });
    }

    const { data: inserted, error: insertError } = await adminClient
      .from("notice_reads")
      .upsert(
        { notice_id: notice.id, user_id: user.id },
        { onConflict: "notice_id,user_id", ignoreDuplicates: true },
      )
      .select("notice_id")
      .maybeSingle<{ notice_id: string }>();

    if (insertError) {
      console.error("POST /api/notices/[id]/read insert error:", insertError);
      return NextResponse.json({ error: "읽음 상태를 저장하지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json({ success: true, alreadyRead: !inserted });
  } catch (error) {
    console.error("POST /api/notices/[id]/read error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}