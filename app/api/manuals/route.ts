import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { HQ_MANUAL_CATEGORY_PLACEHOLDER_CONTENT } from "@/lib/manuals/constants";
import { saveManualGroupsWithChunks, type ManualItemInput } from "@/lib/rag/save-manual-sections";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type CreateManualGroupRequestBody = {
  category?: unknown;
  categoryOnly?: unknown;
  topic?: unknown;
  items?: unknown;
  storeId?: unknown;
};

type ManualsListResponse = {
  manuals?: ManualRecord[];
  error?: string;
};

type CreateManualsResponse = {
  manuals?: ManualRecord[];
  error?: string;
};

type UpdateManualsRequestBody = {
  action?: unknown;
  category?: unknown;
  newCategory?: unknown;
};

type UpdateManualsResponse = {
  manuals?: ManualRecord[];
  updatedCount?: number;
  error?: string;
};

const CATEGORY_PLACEHOLDER_CONTENT = HQ_MANUAL_CATEGORY_PLACEHOLDER_CONTENT;
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

export async function GET(request: Request): Promise<NextResponse<ManualsListResponse>> {
  try {
    // 세션에서 사용자 정보 조회
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    // 권한 확인 (HQ 또는 Owner만 접근 가능)
    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, brand_id")
      .eq("id", userData.user.id)
      .maybeSingle<{ role: string; brand_id: string | null }>();

    if (profileError || !profile || (profile.role !== "hq" && profile.role !== "owner")) {
      return NextResponse.json({ error: "매뉴얼 열람 권한이 없습니다." }, { status: 403 });
    }

    // 프랜차이즈 정보 조회
    let franchiseId: string | null = null;
    let brandName = "본사";

    if (profile.brand_id) {
      const { data: franchise } = await adminClient
        .from("franchises")
        .select("id, name")
        .eq("id", profile.brand_id)
        .maybeSingle<{ id: string; name: string }>();

      if (franchise) {
        franchiseId = franchise.id;
        brandName = franchise.name;
      }
    } else {
      // 레거시 계정: user_metadata에서 이름 파싱
      const name = userData.user.user_metadata?.name as string | undefined;
      if (name && name.trim()) {
        const [first] = name.trim().split(/\s+/);
        if (first) brandName = first;
      }
    }

    // Owner는 공통 매뉴얼(store_id = null)만 조회 가능
    const { searchParams } = new URL(request.url);
    const storeIdParam = getString(searchParams.get("storeId") ?? undefined);
    const storeId = profile.role === "owner" ? null : storeIdParam;
    const includeCategoryPlaceholders = profile.role === "hq" && searchParams.get("includeCategoryPlaceholders") === "1";

    // 쿼리 구성
    const supabase = createAdminClient();
    let query = supabase
      .from("manuals")
      .select("id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at")
      .order("category", { ascending: true })
      .order("created_at", { ascending: true });

    // 프랜차이즈별 스코핑
    query = franchiseId ? query.eq("franchise_id", franchiseId) : query.eq("brand_name", brandName);

    // 매뉴얼 범위 제한
    query = storeId ? query.or(`store_id.eq.${storeId},store_id.is.null`) : query.is("store_id", null);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: "매뉴얼 목록을 불러오지 못했습니다." }, { status: 500 });
    }

    const manuals = ((data ?? []) as ManualRecord[]).filter(
      (manual) => includeCategoryPlaceholders || manual.content !== CATEGORY_PLACEHOLDER_CONTENT,
    );

    return NextResponse.json({ manuals });
  } catch (e) {
    console.error("GET /api/manuals error:", e);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse<CreateManualsResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  let body: CreateManualGroupRequestBody;

  try {
    body = (await request.json()) as CreateManualGroupRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const topic = getString(body.topic);
  const category = getString(body.category);
  const items = parseItems(body.items);
  const storeId = getString(body.storeId);

  if (body.categoryOnly === true) {
    if (!category) {
      return NextResponse.json({ error: "카테고리를 입력해주세요." }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("manuals")
      .insert({
        brand_name: hqUser.brandName,
        franchise_id: hqUser.franchiseId,
        store_id: null,
        scope_type: "hq",
        parent_manual_id: null,
        title: category,
        category,
        content: CATEGORY_PLACEHOLDER_CONTENT,
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

  const supabase = createAdminClient();

  try {
    const manuals = await saveManualGroupsWithChunks(supabase, hqUser, [{ category, topic, items }], storeId);
    return NextResponse.json({ manuals }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "매뉴얼 저장 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request): Promise<NextResponse<UpdateManualsResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  let body: UpdateManualsRequestBody;

  try {
    body = (await request.json()) as UpdateManualsRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.action !== "rename-category" && body.action !== "delete-category") {
    return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
  }

  const category = getString(body.category);

  if (!category) {
    return NextResponse.json({ error: "카테고리를 입력해주세요." }, { status: 400 });
  }

  const supabase = createAdminClient();

  if (body.action === "delete-category") {
    let targetQuery = supabase
      .from("manuals")
      .select("id")
      .eq("category", category)
      .is("store_id", null);

    targetQuery = hqUser.franchiseId
      ? targetQuery.eq("franchise_id", hqUser.franchiseId)
      : targetQuery.eq("brand_name", hqUser.brandName);

    const { data: targets, error: targetError } = await targetQuery;

    if (targetError) {
      return NextResponse.json({ error: "삭제할 카테고리 조회 중 오류가 발생했습니다." }, { status: 500 });
    }

    const ids = (targets ?? []).map((row) => row.id as string);

    if (ids.length === 0) {
      return NextResponse.json({ error: "삭제할 카테고리를 찾지 못했습니다." }, { status: 404 });
    }

    let childrenQuery = supabase.from("manuals").delete().in("parent_manual_id", ids);
    childrenQuery = hqUser.franchiseId
      ? childrenQuery.eq("franchise_id", hqUser.franchiseId)
      : childrenQuery.eq("brand_name", hqUser.brandName);

    const { error: childrenError } = await childrenQuery;

    if (childrenError) {
      return NextResponse.json({ error: "카테고리 하위 매뉴얼 삭제 중 오류가 발생했습니다." }, { status: 500 });
    }

    let parentQuery = supabase.from("manuals").delete().in("id", ids);
    parentQuery = hqUser.franchiseId
      ? parentQuery.eq("franchise_id", hqUser.franchiseId)
      : parentQuery.eq("brand_name", hqUser.brandName);

    const { data, error } = await parentQuery.select("id");

    if (error) {
      return NextResponse.json({ error: "카테고리 삭제 중 오류가 발생했습니다." }, { status: 500 });
    }

    return NextResponse.json({ updatedCount: (data ?? []).length });
  }

  const newCategory = getString(body.newCategory);

  if (!newCategory) {
    return NextResponse.json({ error: "새 카테고리를 입력해주세요." }, { status: 400 });
  }

  let query = supabase
    .from("manuals")
    .update({ category: newCategory, updated_at: new Date().toISOString() })
    .eq("category", category)
    .is("store_id", null);

  query = hqUser.franchiseId
    ? query.eq("franchise_id", hqUser.franchiseId)
    : query.eq("brand_name", hqUser.brandName);

  const { data, error } = await query.select(MANUAL_SELECT_COLUMNS);

  if (error) {
    return NextResponse.json({ error: "카테고리 이름 변경 중 오류가 발생했습니다." }, { status: 500 });
  }

  return NextResponse.json({ manuals: (data ?? []) as ManualRecord[], updatedCount: (data ?? []).length });
}

type DeleteAllManualsResponse = {
  deletedCount?: number;
  error?: string;
};

// 현재 로그인한 본사 계정의 프랜차이즈(또는 레거시 brand_name) 범위 안의 매뉴얼을 전부 삭제한다.
// public.manual_chunks는 manual_chunks_manual_id_fkey의 on delete cascade로 함께 정리된다.
export async function DELETE(): Promise<NextResponse<DeleteAllManualsResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  const supabase = createAdminClient();
  let query = supabase.from("manuals").delete();
  query = hqUser.franchiseId
    ? query.eq("franchise_id", hqUser.franchiseId)
    : query.eq("brand_name", hqUser.brandName);

  const { data, error } = await query.select("id");

  if (error) {
    return NextResponse.json({ error: "매뉴얼 전체 삭제 중 오류가 발생했습니다." }, { status: 500 });
  }

  return NextResponse.json({ deletedCount: (data ?? []).length });
}
