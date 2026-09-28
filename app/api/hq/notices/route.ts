import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import type { HqNoticeItem } from "@/lib/types/notice";

export const runtime = "nodejs";

const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 5000;

type NoticeRow = {
  id: string;
  target_type: "all" | "store";
  target_store_id: string | null;
  title: string;
  content: string;
  created_at: string;
};

type CreateNoticeBody = {
  targetType?: unknown;
  targetStoreId?: unknown;
  title?: unknown;
  content?: unknown;
};

// migration 020이 아직 적용되지 않아 notices 테이블이 없는 경우
function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
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
      .select("id, target_type, target_store_id, title, content, created_at")
      .eq("franchise_id", hqUser.franchiseId)
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

    const notices: HqNoticeItem[] = rows.map((row) => ({
      id: row.id,
      targetType: row.target_type,
      targetStoreId: row.target_store_id,
      targetStoreName: row.target_store_id ? storeNames.get(row.target_store_id) ?? null : null,
      title: row.title,
      content: row.content,
      createdAt: row.created_at,
    }));

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
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const targetStoreId = typeof body.targetStoreId === "string" ? body.targetStoreId.trim() : "";

    if (targetType !== "all" && targetType !== "store") {
      return NextResponse.json({ error: "공지 대상을 선택해주세요." }, { status: 400 });
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

    const adminClient = createAdminClient();

    // 4) 특정 지점 공지는 그 지점이 HQ의 franchise 소속일 때만 허용한다.
    if (targetType === "store") {
      const { data: store, error: storeError } = await adminClient
        .from("stores")
        .select("id")
        .eq("id", targetStoreId)
        .eq("franchise_id", hqUser.franchiseId)
        .maybeSingle();

      if (storeError) {
        return NextResponse.json({ error: "지점 정보를 확인하지 못했습니다." }, { status: 500 });
      }
      if (!store) {
        return NextResponse.json({ error: "선택한 지점을 찾을 수 없습니다." }, { status: 404 });
      }
    }

    const { data: created, error: insertError } = await adminClient
      .from("notices")
      .insert({
        franchise_id: hqUser.franchiseId,
        author_id: hqUser.userId,
        target_type: targetType,
        target_store_id: targetType === "store" ? targetStoreId : null,
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
