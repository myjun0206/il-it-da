import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";

export const runtime = "nodejs";

type BatchDeleteRequestBody = {
  ids?: unknown;
};

type BatchDeleteResponse = {
  deletedIds?: string[];
  error?: string;
};

function parseIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0) {
    return null;
  }

  const parsed = ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  return parsed.length > 0 ? parsed : null;
}

export async function POST(request: Request): Promise<NextResponse<BatchDeleteResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  let body: BatchDeleteRequestBody;

  try {
    body = (await request.json()) as BatchDeleteRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const ids = parseIds(body.ids);

  if (!ids) {
    return NextResponse.json({ error: "삭제할 매뉴얼 id 목록이 필요합니다." }, { status: 400 });
  }

  const supabase = createAdminClient();

  // 본인 프랜차이즈 범위로 스코핑한 뒤 id in (...)으로 한 번에 삭제한다.
  // public.manual_chunks는 manual_chunks_manual_id_fkey의 on delete cascade로 자동 정리된다.
  let query = supabase.from("manuals").delete().in("id", ids);
  query = hqUser.franchiseId
    ? query.eq("franchise_id", hqUser.franchiseId)
    : query.eq("brand_name", hqUser.brandName);

  const { data, error } = await query.select("id");

  if (error) {
    return NextResponse.json({ error: "매뉴얼 일괄 삭제 중 오류가 발생했습니다." }, { status: 500 });
  }

  const deletedIds = (data ?? []).map((row) => row.id as string);

  if (deletedIds.length === 0) {
    return NextResponse.json({ error: "삭제할 수 있는 매뉴얼을 찾지 못했습니다." }, { status: 404 });
  }

  return NextResponse.json({ deletedIds });
}
