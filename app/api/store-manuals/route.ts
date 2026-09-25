import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
import { STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT } from "@/lib/manuals/constants";
import { saveManualGroupsWithChunks, type ManualItemInput } from "@/lib/rag/save-manual-sections";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type CreateStoreManualGroupRequestBody = {
  category?: unknown;
  categoryOnly?: unknown;
  topic?: unknown;
  items?: unknown;
  storeId?: unknown;
};

type StoreManualsListResponse = {
  manuals?: ManualRecord[];
  error?: string;
};

type CreateStoreManualsResponse = {
  manuals?: ManualRecord[];
  error?: string;
};

type UpdateStoreManualsRequestBody = {
  action?: unknown;
  category?: unknown;
  newCategory?: unknown;
  storeId?: unknown;
};

type UpdateStoreManualsResponse = {
  manuals?: ManualRecord[];
  updatedCount?: number;
  error?: string;
};

const MANUAL_SELECT_COLUMNS =
  "id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at";

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// items는 문자열(본문만) 또는 { title?, content } 객체 배열을 받는다. 본문이 비어 있는 항목이 하나라도 있으면 거부한다.
function parseItems(items: unknown): ManualItemInput[] | null {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const parsed: ManualItemInput[] = [];

  for (const raw of items) {
    if (typeof raw === "string") {
      const content = getString(raw);
      if (!content) {
        return null;
      }
      parsed.push(content);
      continue;
    }

    if (raw && typeof raw === "object") {
      const record = raw as { title?: unknown; content?: unknown };
      const content = getString(record.content);
      if (!content) {
        return null;
      }
      const title = getString(record.title);
      parsed.push(title ? { title: title.slice(0, 100), content } : content);
      continue;
    }

    return null;
  }

  return parsed;
}

/**
 * 점주가 자신의 승인된 store_id 범위에 속한 지점 매뉴얼을 조회한다.
 */
export async function GET(request: Request): Promise<NextResponse<StoreManualsListResponse>> {
  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const storeId = getString(searchParams.get("storeId") ?? undefined);

    if (!storeId) {
      return NextResponse.json({ error: "지점 ID가 필요합니다." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const storeAuth = await requireStoreOwner(adminClient, userData.user.id, storeId);

    if (!storeAuth) {
      return NextResponse.json({ error: "이 지점에 대한 접근 권한이 없습니다." }, { status: 403 });
    }

    const includeCategoryPlaceholders = searchParams.get("includeCategoryPlaceholders") === "1";

    const { data, error } = await adminClient
      .from("manuals")
      .select(MANUAL_SELECT_COLUMNS)
      .eq("store_id", storeId)
      .order("category", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: "지점 매뉴얼 목록을 불러오지 못했습니다." }, { status: 500 });
    }

    const manuals = ((data ?? []) as ManualRecord[]).filter(
      (manual) => includeCategoryPlaceholders || manual.content !== STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT,
    );

    return NextResponse.json({ manuals });
  } catch (e) {
    console.error("GET /api/store-manuals error:", e);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

/**
 * 점주가 자신의 승인된 store_id 범위에 카테고리(placeholder) 또는 타이틀+세부 매뉴얼 그룹을 생성한다.
 */
export async function POST(request: Request): Promise<NextResponse<CreateStoreManualsResponse>> {
  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    let body: CreateStoreManualGroupRequestBody;

    try {
      body = (await request.json()) as CreateStoreManualGroupRequestBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const storeId = getString(body.storeId);

    if (!storeId) {
      return NextResponse.json({ error: "지점 ID가 필요합니다." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const storeAuth = await requireStoreOwner(adminClient, userData.user.id, storeId);

    if (!storeAuth) {
      return NextResponse.json({ error: "이 지점에 대한 접근 권한이 없습니다." }, { status: 403 });
    }

    const topic = getString(body.topic);
    const category = getString(body.category);
    const items = parseItems(body.items);

    if (body.categoryOnly === true) {
      if (!category) {
        return NextResponse.json({ error: "카테고리를 입력해주세요." }, { status: 400 });
      }

      const { data, error } = await adminClient
        .from("manuals")
        .insert({
          brand_name: storeAuth.brandName,
          franchise_id: storeAuth.franchiseId,
          store_id: storeId,
          scope_type: "store",
          parent_manual_id: null,
          title: category,
          category,
          content: STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT,
          status: "draft",
        })
        .select(MANUAL_SELECT_COLUMNS)
        .single();

      if (error || !data) {
        return NextResponse.json({ error: "카테고리 저장 중 오류가 발생했습니다." }, { status: 500 });
      }

      return NextResponse.json({ manuals: [data as ManualRecord] }, { status: 201 });
    }

    if (!topic || !items) {
      return NextResponse.json({ error: "주제와 내용을 모두 입력해주세요." }, { status: 400 });
    }

    if (!category) {
      // saveManualGroupsWithChunks는 category가 비어 있으면 topic을 그대로 category로 쓰는 legacy fallback이 있다.
      // 지점 매뉴얼은 항상 사용자가 선택한 카테고리를 명시적으로 받아야 하므로 여기서 미리 막는다.
      return NextResponse.json({ error: "카테고리를 선택해주세요." }, { status: 400 });
    }

    const manuals = await saveManualGroupsWithChunks(adminClient, storeAuth, [{ category, topic, items }], storeId);
    return NextResponse.json({ manuals }, { status: 201 });
  } catch (e) {
    console.error("POST /api/store-manuals error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "지점 매뉴얼 저장 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}

/**
 * 점주가 자신의 승인된 store_id 범위에서 카테고리 이름을 변경하거나 삭제한다.
 */
export async function PATCH(request: Request): Promise<NextResponse<UpdateStoreManualsResponse>> {
  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    let body: UpdateStoreManualsRequestBody;

    try {
      body = (await request.json()) as UpdateStoreManualsRequestBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const storeId = getString(body.storeId);

    if (!storeId) {
      return NextResponse.json({ error: "지점 ID가 필요합니다." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const storeAuth = await requireStoreOwner(adminClient, userData.user.id, storeId);

    if (!storeAuth) {
      return NextResponse.json({ error: "이 지점에 대한 접근 권한이 없습니다." }, { status: 403 });
    }

    if (body.action !== "rename-category" && body.action !== "delete-category") {
      return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
    }

    const category = getString(body.category);

    if (!category) {
      return NextResponse.json({ error: "카테고리를 입력해주세요." }, { status: 400 });
    }

    if (body.action === "delete-category") {
      const { data: targets, error: targetError } = await adminClient
        .from("manuals")
        .select("id")
        .eq("category", category)
        .eq("store_id", storeId)
        .is("parent_manual_id", null);

      if (targetError) {
        return NextResponse.json({ error: "삭제할 카테고리 조회 중 오류가 발생했습니다." }, { status: 500 });
      }

      const ids = (targets ?? []).map((row) => row.id as string);

      if (ids.length === 0) {
        return NextResponse.json({ error: "삭제할 카테고리를 찾지 못했습니다." }, { status: 404 });
      }

      const { error: childrenError } = await adminClient
        .from("manuals")
        .delete()
        .in("parent_manual_id", ids)
        .eq("store_id", storeId);

      if (childrenError) {
        return NextResponse.json({ error: "카테고리 하위 매뉴얼 삭제 중 오류가 발생했습니다." }, { status: 500 });
      }

      const { data, error } = await adminClient
        .from("manuals")
        .delete()
        .in("id", ids)
        .eq("store_id", storeId)
        .select("id");

      if (error) {
        return NextResponse.json({ error: "카테고리 삭제 중 오류가 발생했습니다." }, { status: 500 });
      }

      return NextResponse.json({ updatedCount: (data ?? []).length });
    }

    const newCategory = getString(body.newCategory);

    if (!newCategory) {
      return NextResponse.json({ error: "새 카테고리를 입력해주세요." }, { status: 400 });
    }

    const { data, error } = await adminClient
      .from("manuals")
      .update({ category: newCategory, updated_at: new Date().toISOString() })
      .eq("category", category)
      .eq("store_id", storeId)
      .select(MANUAL_SELECT_COLUMNS);

    if (error) {
      return NextResponse.json({ error: "카테고리 이름 변경 중 오류가 발생했습니다." }, { status: 500 });
    }

    return NextResponse.json({ manuals: (data ?? []) as ManualRecord[], updatedCount: (data ?? []).length });
  } catch (e) {
    console.error("PATCH /api/store-manuals error:", e);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

type DeleteAllStoreManualsResponse = {
  deletedCount?: number;
  error?: string;
};

// 로그인한 점주가 소유한 특정 store_id 범위의 지점 매뉴얼을 전부 삭제한다.
// public.manual_chunks는 manual_chunks_manual_id_fkey의 on delete cascade로 함께 정리된다.
export async function DELETE(request: Request): Promise<NextResponse<DeleteAllStoreManualsResponse>> {
  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const storeId = getString(searchParams.get("storeId") ?? undefined);

    if (!storeId) {
      return NextResponse.json({ error: "지점 ID가 필요합니다." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const storeAuth = await requireStoreOwner(adminClient, userData.user.id, storeId);

    if (!storeAuth) {
      return NextResponse.json({ error: "이 지점에 대한 접근 권한이 없습니다." }, { status: 403 });
    }

    const { data, error } = await adminClient.from("manuals").delete().eq("store_id", storeId).select("id");

    if (error) {
      return NextResponse.json({ error: "지점 매뉴얼 전체 삭제 중 오류가 발생했습니다." }, { status: 500 });
    }

    return NextResponse.json({ deletedCount: (data ?? []).length });
  } catch (e) {
    console.error("DELETE /api/store-manuals error:", e);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
