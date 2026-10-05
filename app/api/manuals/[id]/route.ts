import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { requireManualWriteContract, MANUAL_FEATURE_PENDING } from "@/lib/manuals/manual-write-contract";
import { indexSavedManuals } from "@/lib/manuals/index-saved-manuals";
import { validateManualEdit } from "@/lib/manuals/validate-manual-edit";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type UpdateManualRequestBody = {
  title?: unknown;
  category?: unknown;
  content?: unknown;
};

type UpdateManualResponse = {
  saveStatus?: string;
  searchStatus?: string;
  searchResults?: { manualId: string; status: string }[];
  message?: string;
  manual?: ManualRecord;
  error?: string;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<UpdateManualResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  const { id } = await params;

  let body: UpdateManualRequestBody;

  try {
    body = (await request.json()) as UpdateManualRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validation = validateManualEdit(body);
  if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 400 });
  const update = validation.update;

  update.updated_at = new Date().toISOString();

  const supabase = createAdminClient();
  let context;
  try { context = await requireManualWriteContract(supabase); }
  catch { return NextResponse.json({ error: MANUAL_FEATURE_PENDING }, { status: 503 }); }

  // Scope the update to the caller's own franchise (or brand_name for legacy rows without franchise_id).
  let query = supabase.from("manuals").update(update).eq("id", id);
  query = hqUser.franchiseId
    ? query.eq("franchise_id", hqUser.franchiseId)
    : query.eq("brand_name", hqUser.brandName);

  const { data, error } = await query
    .select("id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "매뉴얼 수정 중 오류가 발생했습니다." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "매뉴얼을 찾을 수 없습니다." }, { status: 404 });
  }

  const updatedManual = data as ManualRecord;

  const search = await indexSavedManuals([updatedManual], context).catch(() => ({
    saveStatus: "saved", searchStatus: "incomplete", searchResults: [],
    message: "본문은 저장되었지만 검색 반영 결과를 확인하지 못했습니다. 검색 준비 상태에서 다시 처리해 주세요.",
  }));
  return NextResponse.json({ manual: updatedManual, ...search });
}

type DeleteManualResponse = {
  success?: boolean;
  error?: string;
};

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<DeleteManualResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  let childrenQuery = supabase.from("manuals").delete().eq("parent_manual_id", id);
  childrenQuery = hqUser.franchiseId
    ? childrenQuery.eq("franchise_id", hqUser.franchiseId)
    : childrenQuery.eq("brand_name", hqUser.brandName);

  const { error: childrenDeleteError } = await childrenQuery;

  if (childrenDeleteError) {
    return NextResponse.json({ error: "하위 매뉴얼 삭제 중 오류가 발생했습니다." }, { status: 500 });
  }

  // Scope the delete to the caller's own franchise (or brand_name for legacy rows without franchise_id).
  // public.manual_chunks rows cascade-delete automatically via manual_chunks_manual_id_fkey.
  let query = supabase.from("manuals").delete().eq("id", id);
  query = hqUser.franchiseId
    ? query.eq("franchise_id", hqUser.franchiseId)
    : query.eq("brand_name", hqUser.brandName);

  const { data, error } = await query.select("id").maybeSingle();

  if (error) {
    return NextResponse.json({ error: "매뉴얼 삭제 중 오류가 발생했습니다." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "매뉴얼을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
