import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { indexManualById } from "@/lib/rag/index-manual";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type UpdateManualRequestBody = {
  title?: unknown;
  category?: unknown;
  content?: unknown;
};

type UpdateManualResponse = {
  manual?: ManualRecord;
  error?: string;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

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

  const update: Record<string, string> = {};
  const title = getString(body.title);
  const category = getString(body.category);
  const content = getString(body.content);

  if (title) update.title = title;
  if (category) update.category = category;
  if (content) update.content = content;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "수정할 내용이 없습니다." }, { status: 400 });
  }

  update.updated_at = new Date().toISOString();

  const supabase = createAdminClient();

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

  // manual_chunks RAG 데이터 동기화: 기존 청크를 지우고 chunk_index=0으로 다시 생성한다 (임베딩은 일단 null).
  try {
    await supabase.from("manual_chunks").delete().eq("manual_id", updatedManual.id);
    await supabase.from("manual_chunks").insert({
      manual_id: updatedManual.id,
      chunk_index: 0,
      content: `${updatedManual.title} - ${updatedManual.content}`,
      embedding: null,
    });
  } catch (chunkError) {
    console.error("[MANUALS] chunk sync failed:", chunkError);
  }

  // 수정된 내용에 대해 임베딩을 즉시 재생성한다 (OpenAI 호출 실패해도 수정 자체는 유지).
  try {
    await indexManualById(updatedManual.id);
  } catch (indexError) {
    console.error("[MANUALS] re-embedding failed:", indexError);
  }

  return NextResponse.json({ manual: updatedManual });
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
