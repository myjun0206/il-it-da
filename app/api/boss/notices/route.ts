import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { canCreateNotice, canReadNotice } from "@/lib/notices/notice-authorization";
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

type CreateNoticeBody = {
  storeId?: unknown;
  title?: unknown;
  content?: unknown;
};

const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 5000;

function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
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
      return NextResponse.json({ success: true, data: { notices: [], summary: { total: 0, important: 0 } } });
    }
    if (ownerMembership.franchise_id && ownerMembership.franchise_id !== store.franchise_id) {
      return NextResponse.json({ success: false, error: "매장 브랜드 정보를 확인할 수 없습니다." }, { status: 403 });
    }

    const [{ data: noticeRows, error: noticeError }, { data: franchise }] = await Promise.all([
      adminClient
        .from("notices")
        .select("id, target_type, target_store_id, audience, title, content, created_at, updated_at")
        .eq("franchise_id", store.franchise_id)
        .in("audience", ["owner", "all_members"])
        .or(`target_type.eq.all,target_type.eq.franchise,target_store_id.eq.${storeId}`)
        .order("created_at", { ascending: false }),
      adminClient.from("franchises").select("name").eq("id", store.franchise_id).maybeSingle<{ name: string }>(),
    ]);

    if (noticeError) {
      // migration 021(notices 테이블)이 아직 적용되지 않은 환경에서는 공지가 없는 것으로 본다.
      if (noticeError.code === "42P01" || noticeError.code === "PGRST205") {
        return NextResponse.json({ success: true, data: { notices: [], summary: { total: 0, important: 0 } } });
      }
      throw noticeError;
    }

    const readableMemberships = [{
      storeId,
      franchiseId: store.franchise_id,
      role: "owner" as const,
      status: "approved",
    }];
    const readableRows = (noticeRows ?? []).filter((row) => canReadNotice("owner", readableMemberships, {
      franchiseId: store.franchise_id as string,
      targetType: row.target_type,
      targetStoreId: row.target_store_id,
      audience: row.audience,
    }));

    // notices 테이블에는 분류/중요 표시 컬럼이 없어 "기타"·일반 공지로 표시한다.
    const notices: NoticeItem[] = readableRows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      category: "기타",
      isImportant: false,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
      franchiseName: franchise?.name ?? "",
    }));

    return NextResponse.json({
      success: true,
      data: {
        notices,
        summary: {
          total: notices.length,
          important: 0,
        },
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

    let body: CreateNoticeBody;
    try {
      body = (await request.json()) as CreateNoticeBody;
    } catch {
      return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const storeId = typeof body.storeId === "string" ? body.storeId.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
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
    if (ownerMembership.franchise_id && ownerMembership.franchise_id !== store.franchise_id) {
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
        franchiseId: ownerMembership.franchise_id ?? store.franchise_id,
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
