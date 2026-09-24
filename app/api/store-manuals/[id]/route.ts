import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
import { indexManualById } from "@/lib/rag/index-manual";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type UpdateStoreManualRequestBody = {
  storeId?: unknown;
  title?: unknown;
  category?: unknown;
  content?: unknown;
};

type UpdateStoreManualResponse = {
  manual?: ManualRecord;
  error?: string;
};

type DeleteStoreManualResponse = {
  success?: boolean;
  error?: string;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 점주가 자신의 store_id 범위에 속한 매뉴얼 한 건(부모 또는 자식)의
 * title/category/content를 수정한다. HQ의 /api/manuals/[id] PATCH와 동일한 단건 수정 방식.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<UpdateStoreManualResponse>> {
  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;

    let body: UpdateStoreManualRequestBody;
    try {
      body = (await request.json()) as UpdateStoreManualRequestBody;
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

    const { data, error } = await adminClient
      .from("manuals")
      .update(update)
      .eq("id", id)
      .eq("store_id", storeId)
      .select(
        "id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at",
      )
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
      await adminClient.from("manual_chunks").delete().eq("manual_id", updatedManual.id);
      await adminClient.from("manual_chunks").insert({
        manual_id: updatedManual.id,
        chunk_index: 0,
        content: `${updatedManual.title} - ${updatedManual.content}`,
        embedding: null,
      });
    } catch (chunkError) {
      console.error("[STORE-MANUALS] chunk sync failed:", chunkError);
    }

    try {
      await indexManualById(updatedManual.id);
    } catch (indexError) {
      console.error("[STORE-MANUALS] re-embedding failed:", indexError);
    }

    return NextResponse.json({ manual: updatedManual });
  } catch (e) {
    console.error("PATCH /api/store-manuals/[id] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}

/**
 * 점주가 자신의 store_id 범위에 속한 매뉴얼 한 건을 삭제한다.
 * 부모(타이틀)를 삭제하면 그 안의 모든 자식(세부 매뉴얼)도 함께 삭제된다.
 *
 * Query params:
 * - storeId: 지점 UUID
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<DeleteStoreManualResponse>> {
  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;

    const { searchParams } = new URL(request.url);
    const storeId = getString(searchParams.get("storeId") ?? undefined);

    if (!storeId) {
      return NextResponse.json({ error: "지점 ID가 필요합니다." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const storeAuth = await requireStoreOwner(adminClient, userData.user.id, storeId);

    if (!storeAuth) {
      return NextResponse.json({ error: "이 지점에 대한 접근 권한이 없습니다." }, { status: 403 });
    }

    const { error: childrenDeleteError } = await adminClient
      .from("manuals")
      .delete()
      .eq("parent_manual_id", id)
      .eq("store_id", storeId);

    if (childrenDeleteError) {
      return NextResponse.json({ error: "하위 매뉴얼 삭제 중 오류가 발생했습니다." }, { status: 500 });
    }

    // public.manual_chunks는 manual_chunks_manual_id_fkey의 on delete cascade로 자동 정리된다.
    const { data, error } = await adminClient
      .from("manuals")
      .delete()
      .eq("id", id)
      .eq("store_id", storeId)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "매뉴얼 삭제 중 오류가 발생했습니다." }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "매뉴얼을 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("DELETE /api/store-manuals/[id] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}

