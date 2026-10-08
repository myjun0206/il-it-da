import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { canCreateNotice, canReadNotice } from "@/lib/notices/notice-authorization";
import { searchNoticeRows } from "@/lib/notices/search-notices";
import { getNoticeSortOrder, sortNoticeRows } from "@/lib/notices/sort-notices";
import { paginateNoticeRows, parseNoticePagination } from "@/lib/notices/pagination";
import { validateOwnerNoticeCreateRequest } from "@/lib/notices/validate-owner-notice-create-request";
import {
  validateNoticeContentUpdateRequest,
  validateNoticeDeleteRequest,
} from "@/lib/notices/validate-notice-mutation";
import {
  filterNoticeRowsByRead,
  parseNoticeReadFilter,
  withNoticeReadStatus,
  withNoticeViewCounts,
} from "@/lib/notices/with-read-status";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface NoticeItem {
  id: string;
  title: string;
  content: string;
  category: "운영 안내" | "매뉴얼" | "교육" | "시스템" | "기타";
  isImportant: boolean;
  createdAt: string;
  updatedAt: string;
  franchiseName: string;
  isMine: boolean;
  isRead: boolean;
  viewCount: number;
}

interface NoticesResponse {
  success: boolean;
  data?: {
    notices: NoticeItem[];
    summary: {
      total: number;
      important: number;
    };
  };
  error?: string;
}

const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 5000;

function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

type OwnerMutationActor = {
  userId: string;
  adminClient: ReturnType<typeof createAdminClient>;
};

type OwnerMutationActorResult =
  | { success: true; actor: OwnerMutationActor }
  | { success: false; response: NextResponse };

async function requireOwnerMutationActor(): Promise<OwnerMutationActorResult> {
  const serverClient = await createClient();
  const { data: { user }, error: userError } = await serverClient.auth.getUser();
  if (userError || !user) {
    return { success: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  }

  const adminClient = createAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  if (profileError || profile?.role !== "owner") {
    return { success: false, response: NextResponse.json({ error: "점주만 공지를 변경할 수 있습니다." }, { status: 403 }) };
  }

  return { success: true, actor: { userId: user.id, adminClient } };
}

type OwnerNoticeMutationScope = {
  storeId: string;
  franchiseId: string;
};

type OwnerNoticeMutationAuthorization =
  | { success: true; scope: OwnerNoticeMutationScope }
  | { success: false; response: NextResponse };

async function authorizeOwnerNoticeMutation(
  actor: OwnerMutationActor,
  noticeId: string,
): Promise<OwnerNoticeMutationAuthorization> {
  const { data: notice, error: noticeError } = await actor.adminClient
    .from("notices")
    .select("id, author_id, franchise_id, target_type, target_store_id, audience")
    .eq("id", noticeId)
    .maybeSingle<{
      id: string;
      author_id: string | null;
      franchise_id: string;
      target_type: string;
      target_store_id: string | null;
      audience: string;
    }>();

  if (noticeError) {
    return { success: false, response: NextResponse.json({ error: "공지를 확인하지 못했습니다." }, { status: 500 }) };
  }
  if (!notice) {
    return { success: false, response: NextResponse.json({ error: "공지를 찾을 수 없습니다." }, { status: 404 }) };
  }
  if (notice.author_id !== actor.userId) {
    return { success: false, response: NextResponse.json({ error: "작성자만 공지를 변경할 수 있습니다." }, { status: 403 }) };
  }
  if (notice.target_type !== "store" || notice.audience !== "staff" || !notice.target_store_id) {
    return { success: false, response: NextResponse.json({ error: "OWNER가 변경할 수 있는 공지가 아닙니다." }, { status: 403 }) };
  }

  const { data: membership, error: membershipError } = await actor.adminClient
    .from("store_memberships")
    .select("store_id, franchise_id")
    .eq("user_id", actor.userId)
    .eq("store_id", notice.target_store_id)
    .eq("role", "owner")
    .eq("status", "approved")
    .maybeSingle<{ store_id: string; franchise_id: string | null }>();

  if (membershipError) {
    return { success: false, response: NextResponse.json({ error: "매장 권한을 확인하지 못했습니다." }, { status: 500 }) };
  }
  if (!membership) {
    return { success: false, response: NextResponse.json({ error: "이 매장의 공지를 변경할 권한이 없습니다." }, { status: 403 }) };
  }

  const { data: store, error: storeError } = await actor.adminClient
    .from("stores")
    .select("id, franchise_id")
    .eq("id", notice.target_store_id)
    .maybeSingle<{ id: string; franchise_id: string | null }>();

  if (storeError || !store?.franchise_id) {
    return { success: false, response: NextResponse.json({ error: "매장 브랜드 정보를 확인할 수 없습니다." }, { status: 403 }) };
  }
  if (membership.franchise_id !== store.franchise_id || notice.franchise_id !== store.franchise_id) {
    return { success: false, response: NextResponse.json({ error: "매장 브랜드 정보가 일치하지 않습니다." }, { status: 403 }) };
  }

  return { success: true, scope: { storeId: store.id, franchiseId: store.franchise_id } };
}

export async function GET(request: NextRequest): Promise<NextResponse<NoticesResponse>> {
  try {
    // 1. Get current authenticated owner
    const serverClient = await createClient();
    const { data: { user }, error: userError } = await serverClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // 2. Extract storeId from query params
    const storeId = request.nextUrl.searchParams.get("storeId");
    if (!storeId) {
      return NextResponse.json(
        { success: false, error: "매장을 선택해주세요." },
        { status: 400 }
      );
    }
    const { page, limit } = parseNoticePagination(request.nextUrl.searchParams);
    const sortOrder = getNoticeSortOrder(request.nextUrl.searchParams.get("sort"));
    const readFilter = parseNoticeReadFilter(request.nextUrl.searchParams.get("read"));
    const sourceFilter = request.nextUrl.searchParams.get("source");
    const categoryFilter = request.nextUrl.searchParams.get("category");

    // 3. Validate owner has approved membership to this store
    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle<{ role: string }>();

    if (profileError || profile?.role !== "owner") {
      return NextResponse.json(
        { success: false, error: "점주만 공지사항을 조회할 수 있습니다." },
        { status: 403 },
      );
    }

    const { data: ownerMembership, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("store_id, franchise_id")
      .eq("user_id", user.id)
      .eq("store_id", storeId)
      .eq("role", "owner")
      .eq("status", "approved")
      .maybeSingle();

    if (membershipError || !ownerMembership) {
      return NextResponse.json(
        { success: false, error: "이 매장에 대한 접근 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 4. 이 매장이 속한 프랜차이즈의 본사 공지 중 "전체 지점" 또는 "이 매장" 대상만 조회한다.
    const { data: store } = await adminClient
      .from("stores")
      .select("franchise_id")
      .eq("id", storeId)
      .maybeSingle<{ franchise_id: string | null }>();

    if (!store?.franchise_id) {
      const emptyPage = paginateNoticeRows([], page, limit);
      return NextResponse.json({
        success: true,
        data: { notices: [], summary: { total: 0, important: 0 }, pagination: emptyPage.pagination },
      });
    }
    if (ownerMembership.franchise_id && ownerMembership.franchise_id !== store.franchise_id) {
      return NextResponse.json({ success: false, error: "매장 브랜드 정보를 확인할 수 없습니다." }, { status: 403 });
    }

    const [
      { data: noticeRows, error: noticeError },
      { data: ownStaffNoticeRows, error: ownStaffNoticeError },
      { data: franchise },
    ] = await Promise.all([
      adminClient
        .from("notices")
        .select("id, author_id, target_type, target_store_id, audience, title, content, created_at, updated_at")
        .eq("franchise_id", store.franchise_id)
        .in("audience", ["owner", "all_members"])
        .or(`target_type.eq.all,target_type.eq.franchise,target_store_id.eq.${storeId}`)
        .order("created_at", { ascending: false }),
      adminClient
        .from("notices")
        .select("id, author_id, target_type, target_store_id, audience, title, content, created_at, updated_at")
        .eq("franchise_id", store.franchise_id)
        .eq("target_type", "store")
        .eq("target_store_id", storeId)
        .eq("audience", "staff")
        .eq("author_id", user.id)
        .order("created_at", { ascending: false }),
      adminClient.from("franchises").select("name").eq("id", store.franchise_id).maybeSingle<{ name: string }>(),
    ]);

    if (noticeError || ownStaffNoticeError) {
      // migration 021(notices 테이블)이 아직 적용되지 않은 환경에서는 공지가 없는 것으로 본다.
      if (isMissingTableError(noticeError) || isMissingTableError(ownStaffNoticeError)) {
        const emptyPage = paginateNoticeRows([], page, limit);
        return NextResponse.json({
          success: true,
          data: { notices: [], summary: { total: 0, important: 0 }, pagination: emptyPage.pagination },
        });
      }
      throw noticeError ?? ownStaffNoticeError;
    }

    const readableMemberships = [{
      storeId,
      franchiseId: store.franchise_id,
      role: "owner" as const,
      status: "approved",
    }];
    const readableRows = [
      ...(noticeRows ?? []).filter((row) => canReadNotice("owner", readableMemberships, {
        franchiseId: store.franchise_id as string,
        targetType: row.target_type,
        targetStoreId: row.target_store_id,
        audience: row.audience,
      })),
      ...(ownStaffNoticeRows ?? []),
    ];
    const filteredRows = readableRows.filter((row) => {
      const isMine = row.author_id === user.id
        && row.target_type === "store"
        && row.target_store_id === storeId
        && row.audience === "staff";
      const sourceMatches = sourceFilter === "hq"
        ? !isMine
        : sourceFilter === "mine"
          ? isMine
          : true;
      const categoryMatches = !categoryFilter
        || categoryFilter === "전체"
        || categoryFilter === "기타";
      return sourceMatches && categoryMatches;
    });
    const searchedRows = await searchNoticeRows(
      adminClient,
      filteredRows,
      request.nextUrl.searchParams.get("search"),
    );

    let readRecords: Array<{ notice_id: string; user_id: string }> = [];
    if (searchedRows.length > 0) {
      const { data: readRows, error: readError } = await adminClient
        .from("notice_reads")
        .select("notice_id,user_id")
        .in("notice_id", searchedRows.map((row) => row.id));

      if (readError) {
        console.error("Error fetching OWNER notice read status:", readError);
        return NextResponse.json({ success: false, error: "읽음 상태를 불러오지 못했습니다." }, { status: 500 });
      }
      readRecords = readRows ?? [];
    }

    // notices 테이블에는 분류/중요 표시 컬럼이 없어 "기타"·일반 공지로 표시한다.
    const noticeItems = searchedRows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      category: "기타" as const,
      isImportant: false,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
      franchiseName: franchise?.name ?? "",
      isMine: row.author_id === user.id
        && row.target_type === "store"
        && row.target_store_id === storeId
        && row.audience === "staff",
    }));
    const readNoticeIds = readRecords
      .filter((record) => record.user_id === user.id)
      .map((record) => record.notice_id);
    const noticesWithReadStatus = withNoticeReadStatus(noticeItems, readNoticeIds);
    const readFilteredNotices = filterNoticeRowsByRead(noticesWithReadStatus, readFilter);
    const noticesWithViewCounts = withNoticeViewCounts(readFilteredNotices, readRecords);
    const sortedNotices: NoticeItem[] = sortNoticeRows(noticesWithViewCounts, sortOrder);
    const { items: notices, pagination } = paginateNoticeRows(sortedNotices, page, limit);

    return NextResponse.json({
      success: true,
      data: {
        notices,
        summary: {
          total: pagination.totalCount,
          important: 0,
        },
        pagination,
      },
    });
  } catch (error) {
    console.error("Failed to fetch notices:", error);
    return NextResponse.json(
      { success: false, error: "공지사항을 불러오지 못했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const serverClient = await createClient();
    const { data: { user }, error: userError } = await serverClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle<{ role: string }>();
    if (profileError || profile?.role !== "owner") {
      return NextResponse.json({ error: "점주만 공지를 작성할 수 있습니다." }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const requestValidation = validateOwnerNoticeCreateRequest(body);
    if (!requestValidation.success) {
      return NextResponse.json(
        {
          error: requestValidation.reason === "missing_field"
            ? "매장, 제목, 내용을 입력해주세요."
            : "OWNER 공지 요청에는 storeId, title, content만 사용할 수 있습니다.",
        },
        { status: 400 },
      );
    }

    const storeId = requestValidation.data.storeId.trim();
    const title = requestValidation.data.title.trim();
    const content = requestValidation.data.content.trim();
    if (!storeId || !title || !content) {
      return NextResponse.json({ error: "매장, 제목, 내용을 입력해주세요." }, { status: 400 });
    }
    if (title.length > TITLE_MAX_LENGTH || content.length > CONTENT_MAX_LENGTH) {
      return NextResponse.json({ error: "제목 또는 내용이 허용 길이를 초과했습니다." }, { status: 400 });
    }

    const { data: ownerMembership, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("store_id, franchise_id")
      .eq("user_id", user.id)
      .eq("store_id", storeId)
      .eq("role", "owner")
      .eq("status", "approved")
      .maybeSingle<{ store_id: string; franchise_id: string | null }>();
    if (membershipError) {
      return NextResponse.json({ error: "매장 권한을 확인하지 못했습니다." }, { status: 500 });
    }
    if (!ownerMembership) {
      return NextResponse.json({ error: "이 매장의 공지를 작성할 권한이 없습니다." }, { status: 403 });
    }

    const { data: store, error: storeError } = await adminClient
      .from("stores")
      .select("id, franchise_id")
      .eq("id", storeId)
      .maybeSingle<{ id: string; franchise_id: string | null }>();
    if (storeError || !store?.franchise_id) {
      return NextResponse.json({ error: "매장 브랜드 정보를 확인할 수 없습니다." }, { status: 403 });
    }
    if (ownerMembership.franchise_id !== store.franchise_id) {
      return NextResponse.json({ error: "매장 브랜드 정보가 일치하지 않습니다." }, { status: 403 });
    }

    const scope = {
      franchiseId: store.franchise_id,
      targetType: "store" as const,
      targetStoreId: store.id,
      audience: "staff" as const,
    };
    if (!canCreateNotice({
      role: "owner",
      franchiseId: store.franchise_id,
      memberships: [{
        storeId: ownerMembership.store_id,
        franchiseId: ownerMembership.franchise_id,
        role: "owner",
        status: "approved",
      }],
      scope,
      targetStoreFranchiseId: store.franchise_id,
    })) {
      return NextResponse.json({ error: "공지 대상 범위가 올바르지 않습니다." }, { status: 403 });
    }

    const { data: created, error: insertError } = await adminClient
      .from("notices")
      .insert({
        franchise_id: store.franchise_id,
        author_id: user.id,
        target_type: "store",
        target_store_id: store.id,
        audience: "staff",
        title,
        content,
      })
      .select("id")
      .single();
    if (insertError) {
      if (isMissingTableError(insertError)) {
        return NextResponse.json({ error: "공지 저장소가 아직 준비되지 않았습니다." }, { status: 503 });
      }
      console.error("POST /api/boss/notices insert error:", insertError);
      return NextResponse.json({ error: "공지를 등록하지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    console.error("POST /api/boss/notices error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const actorResult = await requireOwnerMutationActor();
    if (!actorResult.success) return actorResult.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const validation = validateNoticeContentUpdateRequest(body);
    if (!validation.success) {
      return NextResponse.json({ error: "id, title, content만 수정할 수 있습니다." }, { status: 400 });
    }

    const noticeId = validation.data.id.trim();
    const title = validation.data.title.trim();
    const content = validation.data.content.trim();
    if (!noticeId || !title || !content) {
      return NextResponse.json({ error: "공지 ID, 제목, 내용을 입력해주세요." }, { status: 400 });
    }
    if (title.length > TITLE_MAX_LENGTH || content.length > CONTENT_MAX_LENGTH) {
      return NextResponse.json({ error: "제목 또는 내용이 허용 길이를 초과했습니다." }, { status: 400 });
    }

    const authorization = await authorizeOwnerNoticeMutation(actorResult.actor, noticeId);
    if (!authorization.success) return authorization.response;

    const { data: updated, error } = await actorResult.actor.adminClient
      .from("notices")
      .update({ title, content, updated_at: new Date().toISOString() })
      .eq("id", noticeId)
      .eq("author_id", actorResult.actor.userId)
      .eq("franchise_id", authorization.scope.franchiseId)
      .eq("target_type", "store")
      .eq("target_store_id", authorization.scope.storeId)
      .eq("audience", "staff")
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("PATCH /api/boss/notices error:", error);
      return NextResponse.json({ error: "공지를 수정하지 못했습니다." }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json({ error: "공지를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ id: updated.id });
  } catch (error) {
    console.error("PATCH /api/boss/notices error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const actorResult = await requireOwnerMutationActor();
    if (!actorResult.success) return actorResult.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const validation = validateNoticeDeleteRequest(body);
    if (!validation.success || !validation.data.id.trim()) {
      return NextResponse.json({ error: "공지 ID가 필요합니다." }, { status: 400 });
    }

    const noticeId = validation.data.id.trim();
    const authorization = await authorizeOwnerNoticeMutation(actorResult.actor, noticeId);
    if (!authorization.success) return authorization.response;

    const { data: deleted, error } = await actorResult.actor.adminClient
      .from("notices")
      .delete()
      .eq("id", noticeId)
      .eq("author_id", actorResult.actor.userId)
      .eq("franchise_id", authorization.scope.franchiseId)
      .eq("target_type", "store")
      .eq("target_store_id", authorization.scope.storeId)
      .eq("audience", "staff")
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("DELETE /api/boss/notices error:", error);
      return NextResponse.json({ error: "공지를 삭제하지 못했습니다." }, { status: 500 });
    }
    if (!deleted) {
      return NextResponse.json({ error: "공지를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/boss/notices error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
