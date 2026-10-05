import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
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

function parseBatchItems(
  manuals: unknown,
): { id: string; title: string; content: string }[] | null {
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
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  let body: BatchUpdateRequestBody;

  try {
    body = (await request.json()) as BatchUpdateRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const items = parseBatchItems(body.manuals);

  if (!items) {
    return NextResponse.json({ error: "id, title, content를 모두 포함해주세요." }, { status: 400 });
  }

  const supabase = createAdminClient();
  let context;
  try { context = await requireManualWriteContract(supabase); }
  catch { return NextResponse.json({ error: MANUAL_FEATURE_PENDING }, { status: 503 }); }
  const updatedManuals: ManualRecord[] = [];
  const failedIds: string[] = [];

  // 여러 건을 한 번에 받되, 본인 프랜차이즈 범위를 벗어난 id는 조용히 건너뛴다.
  for (const item of items) {
    let query = supabase
      .from("manuals")
      .update({ title: item.title, content: item.content, updated_at: new Date().toISOString() })
      .eq("id", item.id);

    query = hqUser.franchiseId
      ? query.eq("franchise_id", hqUser.franchiseId)
      : query.eq("brand_name", hqUser.brandName);

    const { data, error } = await query
      .select("id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at")
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
    console.error("[MANUALS_BATCH] skipped ids outside scope:", failedIds);
  }

  const search = await indexSavedManuals(updatedManuals, context).catch(() => ({
    saveStatus: "saved", searchStatus: "incomplete", searchResults: [],
    message: "본문 저장 후 검색 반영 결과를 확인하지 못했습니다. 검색 준비 상태에서 다시 처리해 주세요.",
  }));
  return NextResponse.json({ manuals: updatedManuals, ...search, failedIds, saveStatus: failedIds.length ? "partial" : "saved",
    message: failedIds.length ? "일부 항목을 저장하지 못했습니다. 저장된 항목의 검색 준비 상태도 확인해 주세요." : search.message });
}
