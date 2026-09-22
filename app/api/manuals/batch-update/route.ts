import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { indexManualById } from "@/lib/rag/index-manual";
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

    if (!id || !title || !content) {
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

  // manual_chunks RAG 동기화: 각 매뉴얼의 기존 청크를 지우고 chunk_index=0으로 다시 생성한다 (임베딩은 일단 null).
  for (const manual of updatedManuals) {
    try {
      await supabase.from("manual_chunks").delete().eq("manual_id", manual.id);
      await supabase.from("manual_chunks").insert({
        manual_id: manual.id,
        chunk_index: 0,
        content: `${manual.title} - ${manual.content}`,
        embedding: null,
      });
    } catch (chunkError) {
      console.error("[MANUALS_BATCH] chunk sync failed:", chunkError);
    }

    try {
      await indexManualById(manual.id);
    } catch (indexError) {
      console.error("[MANUALS_BATCH] re-embedding failed:", indexError);
    }
  }

  if (updatedManuals.length === 0) {
    return NextResponse.json({ error: "저장할 수 있는 매뉴얼이 없습니다." }, { status: 404 });
  }

  if (failedIds.length > 0) {
    console.error("[MANUALS_BATCH] skipped ids outside scope:", failedIds);
  }

  return NextResponse.json({ manuals: updatedManuals });
}
