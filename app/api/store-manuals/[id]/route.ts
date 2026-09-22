import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { indexManualById } from "@/lib/rag/index-manual";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type UpdateStoreManualRequestBody = {
  storeId?: unknown;
  title?: unknown;
  items?: unknown;
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

/**
 * Owner가 자신의 지점 매뉴얼 부모를 수정한다.
 * 부모의 title + 모든 자식의 content를 동시에 수정할 수 있다.
 *
 * Request body:
 * {
 *   storeId: string,      // 지점 UUID
 *   title?: string,       // 부모 제목 (선택)
 *   items?: string[]      // 자식 내용들 (선택)
 * }
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
    const title = getString(body.title);
    const items = parseItems(body.items);

    if (!storeId) {
      return NextResponse.json({ error: "지점 ID가 필요합니다." }, { status: 400 });
    }

    if (!title && !items) {
      return NextResponse.json({ error: "수정할 내용이 없습니다." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // 권한 검증: user_id + store_id + role=owner + status=approved
    const { data: membership, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("*")
      .eq("user_id", userData.user.id)
      .eq("store_id", storeId)
      .eq("role", "owner")
      .eq("status", "approved")
      .maybeSingle<{ id: string }>();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "이 지점에 대한 접근 권한이 없습니다." },
        { status: 403 },
      );
    }

    // 수정할 매뉴얼 조회 (부모만 수정 가능)
    const { data: manual, error: fetchError } = await adminClient
      .from("manuals")
      .select(
        "id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at",
      )
      .eq("id", id)
      .eq("store_id", storeId)
      .maybeSingle<ManualRecord>();

    if (fetchError) {
      return NextResponse.json({ error: "매뉴얼 조회 중 오류가 발생했습니다." }, { status: 500 });
    }

    if (!manual) {
      return NextResponse.json({ error: "매뉴얼을 찾을 수 없습니다." }, { status: 404 });
    }

    // 부모 매뉴얼만 수정 가능 (parent_manual_id = null)
    if (manual.parent_manual_id !== null) {
      return NextResponse.json(
        { error: "부모 매뉴얼만 수정할 수 있습니다." },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();

    // 1. 부모 제목 업데이트 + 자식 동기화
    const updateData: Record<string, unknown> = { updated_at: now };

    if (title) {
      updateData.title = title;
      updateData.category = title;
    }

    // items가 있으면 부모의 content를 "N개 항목"으로 설정
    if (items && items.length > 0) {
      updateData.content = `${items.length}개 항목`;
    }

    // 부모 업데이트
    const { error: updateParentError } = await adminClient
      .from("manuals")
      .update(updateData)
      .eq("id", id)
      .eq("store_id", storeId);

    if (updateParentError) {
      return NextResponse.json({ error: "부모 매뉴얼 업데이트 중 오류가 발생했습니다." }, { status: 500 });
    }

    // 2. 자식 항목 동기화 (추가/삭제/수정 모두 가능)
    if (items !== null) {
      // 기존 자식들 모두 삭제 (같은 parent_id와 store_id인 것만)
      const { error: deleteError } = await adminClient
        .from("manuals")
        .delete()
        .eq("parent_manual_id", id)
        .eq("store_id", storeId);

      if (deleteError) {
        return NextResponse.json({ error: "기존 항목 삭제 중 오류가 발생했습니다." }, { status: 500 });
      }

      // 새로운 자식들 생성
      if (items.length > 0) {
        // 부모 정보 가져오기 (brand_name, franchise_id 등)
        const { data: parentData } = await adminClient
          .from("manuals")
          .select("brand_name, franchise_id, title, category")
          .eq("id", id)
          .eq("store_id", storeId)
          .maybeSingle<{ brand_name: string | null; franchise_id: string | null; title: string; category: string }>();

        if (!parentData) {
          return NextResponse.json({ error: "부모 매뉴얼 정보를 찾을 수 없습니다." }, { status: 500 });
        }

        const childRows = items.map((content) => ({
          brand_name: parentData.brand_name,
          franchise_id: parentData.franchise_id,
          store_id: storeId,
          parent_manual_id: id,
          title: parentData.title,
          category: parentData.category,
          content: content || "내용 없음",
          status: "approved",
          created_at: now,
          updated_at: now,
        }));

        const { data: insertedChildren, error: insertError } = await adminClient
          .from("manuals")
          .insert(childRows)
          .select("id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at");

        if (insertError) {
          return NextResponse.json({ error: "새 항목 생성 중 오류가 발생했습니다." }, { status: 500 });
        }

        // 새로 생성된 자식 매뉴얼들을 각각 인덱싱 (embedding 생성)
        if (insertedChildren && insertedChildren.length > 0) {
          for (const child of insertedChildren as ManualRecord[]) {
            try {
              await indexManualById(child.id);
            } catch (indexError) {
              console.error(
                `[STORE-MANUALS] Failed to index new child manual ${child.id}:`,
                indexError,
              );
              // 단일 자식 인덱싱 실패는 전체 PATCH를 실패시키지 않음
              // 하지만 로그에 기록되어 모니터링 가능
            }
          }
        }
      }
    }

    // 3. 업데이트된 부모 매뉴얼 조회
    const { data: updatedManual, error: refetchError } = await adminClient
      .from("manuals")
      .select(
        "id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at",
      )
      .eq("id", id)
      .eq("store_id", storeId)
      .maybeSingle<ManualRecord>();

    if (refetchError || !updatedManual) {
      return NextResponse.json(
        { error: "업데이트된 매뉴얼을 조회할 수 없습니다." },
        { status: 500 },
      );
    }

    // 4. RAG 인덱싱 (부모만 인덱싱)
    try {
      await indexManualById(id);
    } catch (indexError) {
      console.error("[STORE-MANUALS] RAG indexing failed:", indexError);
      // 인덱싱 실패는 무시하고 계속 진행
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
 * Owner가 자신의 지점 매뉴얼(부모)을 삭제한다.
 * 해당 부모에 속한 모든 자식도 함께 삭제된다. (고아 데이터 없음)
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

    // URL 파라미터에서 storeId 추출
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("storeId");

    if (!storeId || typeof storeId !== "string" || !storeId.trim()) {
      return NextResponse.json({ error: "지점 ID가 필요합니다." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // 권한 검증: user_id + store_id + role=owner + status=approved
    const { data: membership, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("*")
      .eq("user_id", userData.user.id)
      .eq("store_id", storeId)
      .eq("role", "owner")
      .eq("status", "approved")
      .maybeSingle<{ id: string }>();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "이 지점에 대한 접근 권한이 없습니다." },
        { status: 403 },
      );
    }

    // 삭제할 매뉴얼 조회
    const { data: manual, error: fetchError } = await adminClient
      .from("manuals")
      .select("id, parent_manual_id, store_id")
      .eq("id", id)
      .eq("store_id", storeId)
      .maybeSingle<{ id: string; parent_manual_id: string | null; store_id: string }>();

    if (fetchError) {
      return NextResponse.json({ error: "매뉴얼 조회 중 오류가 발생했습니다." }, { status: 500 });
    }

    if (!manual) {
      return NextResponse.json({ error: "매뉴얼을 찾을 수 없습니다." }, { status: 404 });
    }

    // parent_manual_id가 null인 경우 (부모인 경우)
    // 해당 부모의 모든 자식도 함께 삭제해야 한다.
    if (manual.parent_manual_id === null) {
      // 1. 자식들 먼저 삭제 (부모-자식 FK 관계 고려)
      const { error: childDeleteError } = await adminClient
        .from("manuals")
        .delete()
        .eq("parent_manual_id", id)
        .eq("store_id", storeId);

      if (childDeleteError) {
        return NextResponse.json(
          { error: "하위 업무 항목 삭제 중 오류가 발생했습니다." },
          { status: 500 },
        );
      }

      // 2. 부모 삭제
      const { error: parentDeleteError } = await adminClient
        .from("manuals")
        .delete()
        .eq("id", id)
        .eq("store_id", storeId);

      if (parentDeleteError) {
        return NextResponse.json({ error: "매뉴얼 삭제 중 오류가 발생했습니다." }, { status: 500 });
      }
    } else {
      // parent_manual_id가 null이 아닌 경우 (자식인 경우)
      // 해당 자식만 삭제
      const { error: deleteError } = await adminClient
        .from("manuals")
        .delete()
        .eq("id", id)
        .eq("store_id", storeId);

      if (deleteError) {
        return NextResponse.json({ error: "매뉴얼 삭제 중 오류가 발생했습니다." }, { status: 500 });
      }
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
