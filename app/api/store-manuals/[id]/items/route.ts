import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
import { addItemsToManualGroup } from "@/lib/rag/save-manual-sections";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type AddItemsRequestBody = {
  items?: unknown;
  storeId?: unknown;
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

// 이미 존재하는 지점 매뉴얼 타이틀(부모)에 세부 매뉴얼 항목을 추가한다.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<AddItemsResponse>> {
  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;

    let body: AddItemsRequestBody;
    try {
      body = (await request.json()) as AddItemsRequestBody;
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

    const items = parseItems(body.items);

    if (!items) {
      return NextResponse.json({ error: "추가할 내용을 입력해주세요." }, { status: 400 });
    }

    const { data: parent, error: parentError } = await adminClient
      .from("manuals")
      .select(
        "id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at",
      )
      .eq("id", id)
      .eq("store_id", storeId)
      .maybeSingle();

    if (parentError) {
      return NextResponse.json({ error: "매뉴얼 주제를 확인하지 못했습니다." }, { status: 500 });
    }

    if (!parent) {
      return NextResponse.json({ error: "매뉴얼 주제를 찾을 수 없습니다." }, { status: 404 });
    }

    const manuals = await addItemsToManualGroup(adminClient, parent as ManualRecord, items);
    return NextResponse.json({ manuals }, { status: 201 });
  } catch (e) {
    console.error("POST /api/store-manuals/[id]/items error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "세부 내용 추가 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
