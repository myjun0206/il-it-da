import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { addItemsToManualGroup } from "@/lib/rag/save-manual-sections";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type AddItemsRequestBody = {
  items?: unknown;
};

type AddItemsResponse = {
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<AddItemsResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  const { id } = await params;

  let body: AddItemsRequestBody;

  try {
    body = (await request.json()) as AddItemsRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const items = parseItems(body.items);

  if (!items) {
    return NextResponse.json({ error: "추가할 내용을 입력해주세요." }, { status: 400 });
  }

  const supabase = createAdminClient();

  // 대상 주제(부모) 카드가 본인 프랜차이즈 범위에 있는지 확인한다.
  let query = supabase
    .from("manuals")
    .select("id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at")
    .eq("id", id);

  query = hqUser.franchiseId
    ? query.eq("franchise_id", hqUser.franchiseId)
    : query.eq("brand_name", hqUser.brandName);

  const { data: parent, error: parentError } = await query.maybeSingle();

  if (parentError) {
    return NextResponse.json({ error: "매뉴얼 주제를 확인하지 못했습니다." }, { status: 500 });
  }

  if (!parent) {
    return NextResponse.json({ error: "매뉴얼 주제를 찾을 수 없습니다." }, { status: 404 });
  }

  try {
    const manuals = await addItemsToManualGroup(supabase, parent as ManualRecord, items);
    return NextResponse.json({ manuals }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "세부 내용 추가 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
