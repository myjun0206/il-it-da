import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { indexManualById } from "@/lib/rag/index-manual";
import { saveManualGroupsWithChunks } from "@/lib/rag/save-manual-sections";
import { resolveStoreManualAccess } from "@/lib/supabase/store-manual-auth";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type StoreManualListResponse = {
  manuals?: ManualRecord[];
  error?: string;
};

type CreateStoreManualResponse = {
  manuals?: ManualRecord[];
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
 * Owner는 자신의 승인된 store, HQ는 같은 franchise의 store 매뉴얼을 조회한다.
 * store_id = null인 공통 매뉴얼은 제외하고,
 * storeId에 해당하는 지점 매뉴얼만 반환한다.
 */
export async function GET(request: Request): Promise<NextResponse<StoreManualListResponse>> {
  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    // URL 파라미터에서 storeId 추출
    const { searchParams } = new URL(request.url);
    const storeId = getString(searchParams.get("storeId") ?? undefined);

    if (!storeId) {
      return NextResponse.json({ error: "지점 ID가 필요합니다." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const access = await resolveStoreManualAccess(
      adminClient,
      userData.user.id,
      storeId,
      { allowHqRead: true },
    );
    if (!access) {
      return NextResponse.json(
        { error: "이 지점에 대한 접근 권한이 없습니다." },
        { status: 403 },
      );
    }

    // 해당 store_id의 지점 매뉴얼만 조회 (store_id IS NOT NULL)
    const { data: manuals, error: fetchError } = await adminClient
      .from("manuals")
      .select(
        "id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at",
      )
      .eq("store_id", storeId)
      .order("category", { ascending: true })
      .order("created_at", { ascending: true });

    if (fetchError) {
      return NextResponse.json(
        { error: "지점 매뉴얼 목록을 불러오지 못했습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json({ manuals: (manuals ?? []) as ManualRecord[] });
  } catch (e) {
    console.error("GET /api/store-manuals error:", e);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

/**
 * Owner가 자신의 승인된 store에 지점 매뉴얼을 생성한다. HQ는 조회만 가능하다.
 * body: { topic: string, items: string[], storeId: string }
 * - topic: 부모 매뉴얼 제목 (카테고리)
 * - items: 세부 업무 내용 배열 (최소 1개)
 * - storeId: 지점 UUID
 */
export async function POST(request: Request): Promise<NextResponse<CreateStoreManualResponse>> {
  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const topic = getString(body.topic);
    const items = parseItems(body.items);
    const storeId = getString(body.storeId);

    if (!topic || !items) {
      return NextResponse.json(
        { error: "제목과 최소 1개 이상의 업무 내용을 입력해주세요." },
        { status: 400 },
      );
    }

    if (!storeId) {
      return NextResponse.json({ error: "지점 ID가 필요합니다." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const access = await resolveStoreManualAccess(adminClient, userData.user.id, storeId);
    if (!access) {
      return NextResponse.json(
        { error: "이 지점에 대한 접근 권한이 없습니다." },
        { status: 403 },
      );
    }

    const hqUserLike = {
      userId: userData.user.id,
      franchiseId: access.franchiseId,
      brandName: access.brandName,
    };

    const manuals = await saveManualGroupsWithChunks(adminClient, hqUserLike, [{ topic, items }], storeId);

    // 자식 매뉴얼들을 각각 인덱싱 (embedding 생성)
    // saveManualGroupsWithChunks는 부모(manuals[0])와 자식들(manuals[1:])을 반환함
    if (manuals.length > 1) {
      const childManuals = manuals.slice(1);
      for (const child of childManuals) {
        try {
          await indexManualById(child.id);
        } catch (indexError) {
          console.error(
            `[STORE-MANUALS] Failed to index child manual ${child.id}:`,
            indexError,
          );
          // 단일 자식 인덱싱 실패는 전체 요청을 실패시키지 않음
          // 하지만 로그에 기록되어 모니터링 가능
        }
      }
    }

    return NextResponse.json({ manuals }, { status: 201 });
  } catch (e) {
    console.error("POST /api/store-manuals error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "지점 매뉴얼 저장 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
