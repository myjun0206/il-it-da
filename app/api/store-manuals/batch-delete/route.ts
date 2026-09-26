import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";

export const runtime = "nodejs";

type BatchDeleteRequestBody = {
  ids?: unknown;
  storeId?: unknown;
};

type BatchDeleteResponse = {
  deletedIds?: string[];
  error?: string;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0) {
    return null;
  }

  const parsed = ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  return parsed.length > 0 ? parsed : null;
}

export async function POST(request: Request): Promise<NextResponse<BatchDeleteResponse>> {
  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    let body: BatchDeleteRequestBody;
    try {
      body = (await request.json()) as BatchDeleteRequestBody;
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

    const ids = parseIds(body.ids);

    if (!ids) {
      return NextResponse.json({ error: "삭제할 매뉴얼 id 목록이 필요합니다." }, { status: 400 });
    }

    // storeId 범위로 스코핑한 뒤 id in (...)으로 한 번에 삭제한다.
    // public.manual_chunks는 manual_chunks_manual_id_fkey의 on delete cascade로 자동 정리된다.
    const { data, error } = await adminClient
      .from("manuals")
      .delete()
      .in("id", ids)
      .eq("store_id", storeId)
      .select("id");

    if (error) {
      return NextResponse.json({ error: "매뉴얼 일괄 삭제 중 오류가 발생했습니다." }, { status: 500 });
    }

    const deletedIds = (data ?? []).map((row) => row.id as string);

    if (deletedIds.length === 0) {
      return NextResponse.json({ error: "삭제할 수 있는 매뉴얼을 찾지 못했습니다." }, { status: 404 });
    }

    return NextResponse.json({ deletedIds });
  } catch (e) {
    console.error("POST /api/store-manuals/batch-delete error:", e);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
