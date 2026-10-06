import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { canCreateNotice, type NoticeAudience, type NoticeTargetType } from "@/lib/notices/notice-authorization";
import {
  validateNoticeContentUpdateRequest,
  validateNoticeDeleteRequest,
} from "@/lib/notices/validate-notice-mutation";
import { withNoticeViewCounts, type NoticeReadRecord } from "@/lib/notices/with-read-status";
import type { HqNoticeItem } from "@/lib/types/notice";

export const runtime = "nodejs";

const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 5000;

type NoticeRow = {
  id: string;
  author_id: string | null;
  target_type: NoticeTargetType;
  target_store_id: string | null;
  audience: NoticeAudience;
  title: string;
  content: string;
  created_at: string;
};

type HqNoticeMutationContext = {
  adminClient: ReturnType<typeof createAdminClient>;
  franchiseId: string;
};

type HqNoticeMutationAuthorization =
  | { success: true; context: HqNoticeMutationContext }
  | { success: false; response: NextResponse };

type CreateNoticeBody = {
  targetType?: unknown;
  targetStoreId?: unknown;
  audience?: unknown;
  title?: unknown;
  content?: unknown;
};

// migration 021이 아직 적용되지 않아 notices 테이블이 없는 경우
function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

async function authorizeHqNoticeMutation(
  hqUser: NonNullable<Awaited<ReturnType<typeof requireHqUser>>>,
  noticeId: string,
): Promise<HqNoticeMutationAuthorization> {
  if (!hqUser.franchiseId) {
    return {
      success: false,
      response: NextResponse.json({ error: "소속 프랜차이즈 정보를 확인할 수 없습니다." }, { status: 403 }),
    };
  }

  const adminClient = createAdminClient();
  const { data: notice, error } = await adminClient
    .from("notices")
    .select("id, author_id")
    .eq("id", noticeId)
    .eq("franchise_id", hqUser.franchiseId)
    .maybeSingle<{ id: string; author_id: string | null }>();

  if (error) {
    return { success: false, response: NextResponse.json({ error: "공지를 확인하지 못했습니다." }, { status: 500 }) };
  }
  if (!notice) {
    return { success: false, response: NextResponse.json({ error: "공지를 찾을 수 없습니다." }, { status: 404 }) };
  }
  if (notice.author_id !== hqUser.userId) {
    return { success: false, response: NextResponse.json({ error: "작성자만 공지를 변경할 수 있습니다." }, { status: 403 }) };
  }

  return { success: true, context: { adminClient, franchiseId: hqUser.franchiseId } };
}

export async function GET(): Promise<NextResponse> {
  try {
    const hqUser = await requireHqUser();
    if (!hqUser) {
      return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
    }

    // franchise_id가 없는 레거시 HQ 계정은 다른 브랜드 공지가 섞이지 않도록 fail closed 한다.
    if (!hqUser.franchiseId) {
      return NextResponse.json({ notices: [] });
    }

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("notices")
      .select("id, author_id, target_type, target_store_id, audience, title, content, created_at")
      .eq("franchise_id", hqUser.franchiseId)
      .in("audience", ["owner", "all_members"])
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ notices: [] });
      }
      return NextResponse.json({ error: "공지사항을 불러오지 못했습니다." }, { status: 500 });
    }

    const rows = (data ?? []) as NoticeRow[];
    const storeIds = [...new Set(rows.map((row) => row.target_store_id).filter((id): id is string => Boolean(id)))];
    const storeNames = new Map<string, string>();

    if (storeIds.length > 0) {
      const { data: stores } = await adminClient
        .from("stores")
        .select("id, store_name")
        .in("id", storeIds)
        .eq("franchise_id", hqUser.franchiseId);

      for (const store of stores ?? []) {
        storeNames.set(store.id, store.store_name);
      }
    }

    const noticeItems = rows.map((row) => ({
      id: row.id,
      targetType: row.target_type,
      targetStoreId: row.target_store_id,
      targetStoreName: row.target_store_id ? storeNames.get(row.target_store_id) ?? null : null,
      audience: row.audience,
      isMine: row.author_id === hqUser.userId,
      title: row.title,
      content: row.content,
      createdAt: row.created_at,
    }));
    let readRecords: NoticeReadRecord[] = [];
    if (noticeItems.length > 0) {
      const { data: readRows, error: readError } = await adminClient
        .from("notice_reads")
        .select("notice_id,user_id")
        .in("notice_id", noticeItems.map((notice) => notice.id));

      if (readError) {
        console.error("Error fetching HQ notice view counts:", readError);
        return NextResponse.json({ error: "공지 조회 수를 불러오지 못했습니다." }, { status: 500 });
      }
      readRecords = readRows ?? [];
    }

    const notices: HqNoticeItem[] = withNoticeViewCounts(noticeItems, readRecords);

    return NextResponse.json({ notices });
  } catch (error) {
    console.error("GET /api/hq/notices error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1~2) 로그인 + HQ role 확인
    const hqUser = await requireHqUser();
    if (!hqUser) {
      return NextResponse.json({ error: "본사 관리자만 공지를 작성할 수 있습니다." }, { status: 403 });
    }

    // 3) 공지는 항상 HQ 자신의 franchise에 귀속된다.
    if (!hqUser.franchiseId) {
      return NextResponse.json(
        { error: "소속 프랜차이즈 정보가 없어 공지를 작성할 수 없습니다." },
        { status: 403 },
      );
    }

    let body: CreateNoticeBody;
    try {
      body = (await request.json()) as CreateNoticeBody;
    } catch {
      return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const targetType = body.targetType;
    const audience = body.audience ?? "all_members";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const targetStoreId = typeof body.targetStoreId === "string" ? body.targetStoreId.trim() : "";

    if (targetType !== "all" && targetType !== "franchise" && targetType !== "store") {
      return NextResponse.json({ error: "공지 대상을 선택해주세요." }, { status: 400 });
    }
    if (audience !== "owner" && audience !== "all_members") {
      return NextResponse.json({ error: "본사 공지 대상을 확인해주세요." }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: "제목을 입력해주세요." }, { status: 400 });
    }
    if (title.length > TITLE_MAX_LENGTH) {
      return NextResponse.json({ error: `제목은 ${TITLE_MAX_LENGTH}자 이하로 입력해주세요.` }, { status: 400 });
    }
    if (!content) {
      return NextResponse.json({ error: "내용을 입력해주세요." }, { status: 400 });
    }
    if (content.length > CONTENT_MAX_LENGTH) {
      return NextResponse.json({ error: `내용은 ${CONTENT_MAX_LENGTH}자 이하로 입력해주세요.` }, { status: 400 });
    }
    if (targetType === "store" && !targetStoreId) {
      return NextResponse.json({ error: "공지를 받을 지점을 선택해주세요." }, { status: 400 });
    }
    if (targetType !== "store" && targetStoreId) {
      return NextResponse.json({ error: "전체 프랜차이즈 공지에는 지점을 지정할 수 없습니다." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    let targetStoreFranchiseId: string | null = null;

    // 4) 특정 지점 공지는 그 지점이 HQ의 franchise 소속일 때만 허용한다.
    if (targetType === "store") {
      const { data: store, error: storeError } = await adminClient
        .from("stores")
        .select("id, franchise_id")
        .eq("id", targetStoreId)
        .eq("franchise_id", hqUser.franchiseId)
        .maybeSingle();

      if (storeError) {
        return NextResponse.json({ error: "지점 정보를 확인하지 못했습니다." }, { status: 500 });
      }
      if (!store) {
        return NextResponse.json({ error: "선택한 지점을 찾을 수 없습니다." }, { status: 404 });
      }
      targetStoreFranchiseId = store.franchise_id;
    }

    const scope = {
      franchiseId: hqUser.franchiseId,
      targetType: targetType as NoticeTargetType,
      targetStoreId: targetType === "store" ? targetStoreId : null,
      audience: audience as NoticeAudience,
    };
    if (!canCreateNotice({
      role: "hq",
      franchiseId: hqUser.franchiseId,
      memberships: [],
      scope,
      targetStoreFranchiseId,
    })) {
      return NextResponse.json({ error: "공지 대상 범위가 올바르지 않습니다." }, { status: 403 });
    }

    const { data: created, error: insertError } = await adminClient
      .from("notices")
      .insert({
        franchise_id: hqUser.franchiseId,
        author_id: hqUser.userId,
        target_type: targetType,
        target_store_id: targetType === "store" ? targetStoreId : null,
        audience,
        title,
        content,
      })
      .select("id")
      .single();

    if (insertError) {
      if (isMissingTableError(insertError)) {
        return NextResponse.json(
          { error: "공지 저장소가 아직 준비되지 않았습니다. 관리자에게 DB 설정(021_hq_notices)을 요청해주세요." },
          { status: 503 },
        );
      }
      console.error("POST /api/hq/notices insert error:", insertError);
      return NextResponse.json({ error: "공지를 등록하지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 500 });
    }

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    console.error("POST /api/hq/notices error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const hqUser = await requireHqUser();
    if (!hqUser) {
      return NextResponse.json({ error: "본사 관리자만 공지를 수정할 수 있습니다." }, { status: 403 });
    }

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
      return NextResponse.json({ error: "제목과 내용을 입력해주세요." }, { status: 400 });
    }
    if (title.length > TITLE_MAX_LENGTH || content.length > CONTENT_MAX_LENGTH) {
      return NextResponse.json({ error: "제목 또는 내용이 허용 길이를 초과했습니다." }, { status: 400 });
    }

    const authorization = await authorizeHqNoticeMutation(hqUser, noticeId);
    if (!authorization.success) return authorization.response;

    const { data: updated, error } = await authorization.context.adminClient
      .from("notices")
      .update({ title, content, updated_at: new Date().toISOString() })
      .eq("id", noticeId)
      .eq("franchise_id", authorization.context.franchiseId)
      .eq("author_id", hqUser.userId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("PATCH /api/hq/notices error:", error);
      return NextResponse.json({ error: "공지를 수정하지 못했습니다." }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json({ error: "공지를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ id: updated.id });
  } catch (error) {
    console.error("PATCH /api/hq/notices error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const hqUser = await requireHqUser();
    if (!hqUser) {
      return NextResponse.json({ error: "본사 관리자만 공지를 삭제할 수 있습니다." }, { status: 403 });
    }

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
    const authorization = await authorizeHqNoticeMutation(hqUser, noticeId);
    if (!authorization.success) return authorization.response;

    const { data: deleted, error } = await authorization.context.adminClient
      .from("notices")
      .delete()
      .eq("id", noticeId)
      .eq("franchise_id", authorization.context.franchiseId)
      .eq("author_id", hqUser.userId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("DELETE /api/hq/notices error:", error);
      return NextResponse.json({ error: "공지를 삭제하지 못했습니다." }, { status: 500 });
    }
    if (!deleted) {
      return NextResponse.json({ error: "공지를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/hq/notices error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
