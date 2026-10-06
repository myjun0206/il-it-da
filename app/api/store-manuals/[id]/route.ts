import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
import { saveStoreManualEdit, type StoreManualEditResult } from "@/lib/manuals/save-store-manual-edit";
import { indexManualById } from "@/lib/rag/index-manual";

export const runtime = "nodejs";

type UpdateStoreManualRequestBody = {
  storeId?: unknown;
  title?: unknown;
  category?: unknown;
  content?: unknown;
  expectedUpdatedAt?: unknown;
};

type UpdateStoreManualResponse = StoreManualEditResult["body"];

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

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "매뉴얼 수정 내용은 객체 형식으로 보내 주세요." }, { status: 400 });
    }
    const storeId = getString(body.storeId);

    if (!storeId) {
      return NextResponse.json({ error: "지점 ID가 필요합니다." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const result = await saveStoreManualEdit(adminClient, {
      ...body,
      userId: userData.user.id,
      storeId,
      manualId: id,
    }, indexManualById);
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    console.error("PATCH /api/store-manuals/[id] error:", e);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
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
      { error: "서버 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
