import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
import { requireManualWriteContract, MANUAL_FEATURE_PENDING } from "@/lib/manuals/manual-write-contract";
import { indexSavedManuals } from "@/lib/manuals/index-saved-manuals";
import { validateManualEdit } from "@/lib/manuals/validate-manual-edit";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type BatchUpdateItemInput = {
  id?: unknown;
  title?: unknown;
  content?: unknown;
};

type BatchUpdateRequestBody = {
  manuals?: unknown;
  storeId?: unknown;
};

type BatchUpdateResponse = {
  saveStatus?: string;
  searchStatus?: string;
  searchResults?: { manualId: string; status: string }[];
  message?: string;
  failedIds?: string[];
  manuals?: ManualRecord[];
  error?: string;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseBatchItems(manuals: unknown): { id: string; title: string; content: string }[] | null {
  if (!Array.isArray(manuals) || manuals.length === 0) {
    return null;
  }

  const parsed: { id: string; title: string; content: string }[] = [];

  for (const raw of manuals as BatchUpdateItemInput[]) {
    const id = getString(raw?.id);
    const title = getString(raw?.title);
    const content = getString(raw?.content);

    if (!id || !title || !content || !validateManualEdit({ title, content }).valid) {
      return null;
    }

    parsed.push({ id, title, content });
  }

  return parsed;
}

export async function POST(request: Request): Promise<NextResponse<BatchUpdateResponse>> {
  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    let body: BatchUpdateRequestBody;
    try {
      body = (await request.json()) as BatchUpdateRequestBody;
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

    const items = parseBatchItems(body.manuals);

    if (!items) {
      return NextResponse.json({ error: "id, title, content를 모두 포함해주세요." }, { status: 400 });
    }

    const updatedManuals: ManualRecord[] = [];
    let context;
    try { context = await requireManualWriteContract(adminClient); }
    catch { return NextResponse.json({ error: MANUAL_FEATURE_PENDING }, { status: 503 }); }
    const failedIds: string[] = [];

    // 여러 건을 한 번에 받되, storeId 범위를 벗어난 id는 조용히 건너뛴다.
    for (const item of items) {
      const { data, error } = await adminClient
        .from("manuals")
        .update({ title: item.title, content: item.content, updated_at: new Date().toISOString() })
        .eq("id", item.id)
        .eq("store_id", storeId)
        .select(
          "id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at",
        )
        .maybeSingle();

      if (error || !data) {
        failedIds.push(item.id);
        continue;
      }

      updatedManuals.push(data as ManualRecord);
    }

    if (updatedManuals.length === 0) {
      return NextResponse.json({ error: "저장할 수 있는 매뉴얼이 없습니다." }, { status: 404 });
    }

    if (failedIds.length > 0) {
      console.error("[STORE_MANUALS_BATCH] skipped ids outside scope:", failedIds);
    }

    const search = await indexSavedManuals(updatedManuals, context).catch(() => ({
      saveStatus: "saved", searchStatus: "incomplete", searchResults: [],
      message: "본문 저장 후 검색 반영 결과를 확인하지 못했습니다. 검색 준비 상태에서 다시 처리해 주세요.",
    }));
    return NextResponse.json({ manuals: updatedManuals, ...search, failedIds, saveStatus: failedIds.length ? "partial" : "saved",
      message: failedIds.length ? "일부 항목을 저장하지 못했습니다. 저장된 항목의 검색 준비 상태도 확인해 주세요." : search.message });
  } catch (e) {
    console.error("POST /api/store-manuals/batch-update error:", e);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
