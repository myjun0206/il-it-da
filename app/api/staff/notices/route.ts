import { NextResponse } from "next/server";

import { requireServerRole } from "@/lib/auth/require-server-role";
import { canReadNotice, type NoticeAudience, type NoticeMembership, type NoticeTargetType } from "@/lib/notices/notice-authorization";
import { searchNoticeRows } from "@/lib/notices/search-notices";
import { getNoticeSortOrder, sortNoticeRows } from "@/lib/notices/sort-notices";
import { paginateNoticeRows, parseNoticePagination } from "@/lib/notices/pagination";
import { fetchNoticesForStore } from "@/lib/notices/store-notices";
import {
  filterNoticeRowsByRead,
  parseNoticeReadFilter,
  withNoticeReadStatus,
  withNoticeViewCounts,
} from "@/lib/notices/with-read-status";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export interface StaffNoticeItem {
  id: string;
  /** all/franchise = 프랜차이즈 전체 지점 대상, store = 현재 매장 대상 */
  targetType: NoticeTargetType;
  sourceLabel: string;
  targetStoreName: string | null; // "프랜차이즈 전체" (all/franchise일 때) 또는 매장명 (store일 때)
  title: string;
  content: string;
  /** 작성 주체 (본사 프랜차이즈명). 확인할 수 없으면 빈 문자열 */
  authorName: string;
  createdAt: string;
  isRead: boolean;
  viewCount: number;
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

const NOTICE_ROW_COLUMNS = "id, franchise_id, target_type, target_store_id, audience, title, content, created_at";

function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/**
 * 직원 공지사항 조회 (읽기 전용 — 이 route에는 쓰기 메서드가 없다).
 * GET ?storeId=<uuid>
 *
 * 1) 로그인 사용자의 profiles.role = staff 확인
 * 2) 요청 storeId에 대한 본인의 approved staff membership 확인 (pending/rejected/남의 매장 UUID는 403)
 * 3) 그 매장의 stores.franchise_id(서버 조회값) 범위에서 "전체 지점" 공지 + "이 매장" 대상 공지만 반환
 *    (점주 공지와 같은 notices 테이블·같은 조회 함수)
 * 4) audience(점주/본사 공지)와 읽음 상태·조회수를 붙여 반환
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const auth = await requireServerRole("staff");
    if (auth.status === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    if (auth.status !== "AUTHORIZED") {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const userId = auth.userId;
    const url = new URL(request.url);
    const storeId = url.searchParams.get("storeId")?.trim() ?? "";
    const { page, limit } = parseNoticePagination(url.searchParams);
    const sortOrder = getNoticeSortOrder(url.searchParams.get("sort"));
    const readFilter = parseNoticeReadFilter(url.searchParams.get("read"));
    const sourceFilter = url.searchParams.get("source");
    const targetFilter = url.searchParams.get("target");
    if (!storeId) {
      return NextResponse.json({ error: "근무 매장을 선택해 주세요.", code: "STORE_REQUIRED" }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { data: membership, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("id, franchise_id")
      .eq("user_id", userId)
      .eq("store_id", storeId)
      .eq("role", "staff")
      .eq("status", "approved")
      .maybeSingle<{ id: string; franchise_id: string | null }>();

    if (membershipError || !membership) {
      return NextResponse.json({ error: "이 매장의 공지사항을 볼 권한이 없습니다.", code: "STORE_FORBIDDEN" }, { status: 403 });
    }

    // 공지 범위는 요청 storeId가 아니라 서버에서 조회한 매장의 franchise로 검증한다.
    const { data: store, error: storeError } = await adminClient
      .from("stores")
      .select("id, store_name, franchise_id")
      .eq("id", storeId)
      .maybeSingle<{ id: string; store_name: string; franchise_id: string | null }>();
    if (storeError) {
      console.error("Error fetching membership store:", storeError);
      return NextResponse.json({ error: "매장 정보를 불러오지 못했습니다." }, { status: 500 });
    }
    if (!store?.franchise_id) {
      const emptyPage = paginateNoticeRows([], page, limit);
      return NextResponse.json({ notices: [], pagination: emptyPage.pagination });
    }
    if (membership.franchise_id && membership.franchise_id !== store.franchise_id) {
      return NextResponse.json({ error: "이 매장의 공지사항을 볼 권한이 없습니다.", code: "STORE_FORBIDDEN" }, { status: 403 });
    }

    const approvedMemberships: NoticeMembership[] = [{
      storeId: store.id,
      franchiseId: store.franchise_id,
      role: "staff",
      status: "approved",
    }];

    const { franchiseName, rows: storeNoticeRows } = await fetchNoticesForStore(adminClient, storeId);

    // fetchNoticesForStore는 audience/franchise_id와 target_type="franchise" 공지를 주지 않으므로 한 번에 보강한다.
    const storeNoticeIds = storeNoticeRows.map((row) => row.id);
    const scopeFilter = storeNoticeIds.length > 0
      ? `id.in.(${storeNoticeIds.join(",")}),target_type.eq.franchise`
      : "target_type.eq.franchise";
    const { data: scopedRows, error: scopedError } = await adminClient
      .from("notices")
      .select(NOTICE_ROW_COLUMNS)
      .eq("franchise_id", store.franchise_id)
      .in("audience", ["all_members", "staff"])
      .or(scopeFilter)
      .order("created_at", { ascending: false });

    if (scopedError && !isMissingTableError(scopedError)) {
      console.error("Error fetching notices:", scopedError);
      return NextResponse.json({ error: "공지사항을 불러오지 못했습니다." }, { status: 500 });
    }

    const readableRows = ((scopedRows ?? []) as NoticeRow[])
      .filter((row) => canReadNotice("staff", approvedMemberships, {
        franchiseId: row.franchise_id,
        targetType: row.target_type,
        targetStoreId: row.target_store_id,
        audience: row.audience,
      }));
    const filteredRows = readableRows.filter((row) => {
      const sourceMatches = sourceFilter === "hq"
        ? row.audience !== "staff"
        : sourceFilter === "owner"
          ? row.audience === "staff"
          : true;
      const targetMatches = targetFilter === "franchise"
        ? row.target_type === "all" || row.target_type === "franchise"
        : targetFilter === "store"
          ? row.target_type === "store"
          : true;
      return sourceMatches && targetMatches;
    });
    const noticesData = await searchNoticeRows(adminClient, filteredRows, url.searchParams.get("search"));

    let readRecords: Array<{ notice_id: string; user_id: string }> = [];
    if (noticesData.length > 0) {
      const { data: readRows, error: readError } = await adminClient
        .from("notice_reads")
        .select("notice_id,user_id")
        .in("notice_id", noticesData.map((row) => row.id));

      if (readError) {
        console.error("Error fetching STAFF notice read status:", readError);
        return NextResponse.json({ error: "읽음 상태를 불러오지 못했습니다." }, { status: 500 });
      }
      readRecords = readRows ?? [];
    }

    const noticeItems = noticesData.map((row: NoticeRow) => ({
      id: row.id,
      targetType: row.target_type,
      sourceLabel: row.audience === "staff" ? "점주 공지" : "본사 공지",
      targetStoreName: row.target_type === "store" ? store.store_name : "프랜차이즈 전체",
      title: row.title,
      content: row.content,
      authorName: franchiseName,
      createdAt: row.created_at,
    }));
    const readNoticeIds = readRecords
      .filter((record) => record.user_id === userId)
      .map((record) => record.notice_id);
    const noticesWithReadStatus = withNoticeReadStatus(noticeItems, readNoticeIds);
    const readFilteredNotices = filterNoticeRowsByRead(noticesWithReadStatus, readFilter);
    const noticesWithViewCounts = withNoticeViewCounts(readFilteredNotices, readRecords);
    const sortedNotices: StaffNoticeItem[] = sortNoticeRows(noticesWithViewCounts, sortOrder);
    const cappedNotices = sortedNotices.slice(0, 1000);
    const { items: notices, pagination } = paginateNoticeRows(cappedNotices, page, limit);

    return NextResponse.json({ notices, pagination });
  } catch (error) {
    console.error("GET /api/staff/notices error:", error);
    return NextResponse.json({ error: "공지사항을 불러오지 못했습니다." }, { status: 500 });
  }
}
