import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { saveManualGroupsWithChunks } from "@/lib/rag/save-manual-sections";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type CreateManualGroupRequestBody = {
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

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseItems(items: unknown): string[] | null {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const parsed: string[] = [];

  for (const raw of items) {
    const content = getString(raw);
    if (!content) {
      return null;
    }
    parsed.push(content);
  }

  return parsed;
}

export async function GET(request: Request): Promise<NextResponse<ManualsListResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = getString(searchParams.get("storeId") ?? undefined);

  const supabase = createAdminClient();
  let query = supabase
    .from("manuals")
    .select("id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at")
    .order("category", { ascending: true })
    .order("created_at", { ascending: true });

  // franchise_id가 있는 계정은 FK 기준으로, 레거시 계정은 brand_name 문자열로 스코핑한다.
  query = hqUser.franchiseId
    ? query.eq("franchise_id", hqUser.franchiseId)
    : query.eq("brand_name", hqUser.brandName);

  // storeId가 없으면 본사 공통 매뉴얼만, 있으면 해당 지점 매뉴얼 + 본사 공통 매뉴얼을 함께 조회한다.
  query = storeId ? query.or(`store_id.eq.${storeId},store_id.is.null`) : query.is("store_id", null);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "매뉴얼 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ manuals: (data ?? []) as ManualRecord[] });
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
  const items = parseItems(body.items);
  const storeId = getString(body.storeId);

  if (!topic || !items) {
    return NextResponse.json({ error: "주제와 내용을 모두 입력해주세요." }, { status: 400 });
  }

  const supabase = createAdminClient();

  try {
    const manuals = await saveManualGroupsWithChunks(supabase, hqUser, [{ topic, items }], storeId);
    return NextResponse.json({ manuals }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "매뉴얼 저장 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
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
