import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
import { STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT } from "@/lib/manuals/constants";
import {
  buildManualReadinessReport,
  type ManualReadinessReport,
  type ReadinessChunkInput,
  type ReadinessManualInput,
} from "@/lib/manuals/manual-search-readiness";

export const runtime = "nodejs";

type ReadinessResponse = {
  report?: ManualReadinessReport;
  error?: string;
};

/**
 * 점주가 자기 지점 매뉴얼의 "챗봇 검색 준비 상태"만 조회한다. storeId는 쿼리로 받지만
 * requireStoreOwner(stores.franchise_id 기반 계약)로 서버에서 다시 검증하므로, 다른 지점이나
 * 다른 브랜드 자료는 조회되지 않는다. 본문과 embedding 벡터는 응답에 넣지 않는다.
 */
export async function GET(request: Request): Promise<NextResponse<ReadinessResponse>> {
  const serverClient = await createClient();
  const { data: userData, error: userError } = await serverClient.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedStoreId = searchParams.get("storeId")?.trim();

  if (!requestedStoreId) {
    return NextResponse.json({ error: "지점 정보를 확인하지 못했습니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const storeAuth = await requireStoreOwner(adminClient, userData.user.id, requestedStoreId);

  if (!storeAuth) {
    return NextResponse.json({ error: "이 지점에 대한 접근 권한이 없습니다." }, { status: 403 });
  }

  try {
    const { data: manualRows, error: manualError } = await adminClient
      .from("manuals")
      .select("id, title, category, parent_manual_id, status, content")
      .eq("store_id", storeAuth.storeId)
      .order("category", { ascending: true })
      .order("created_at", { ascending: true });

    if (manualError) {
      throw manualError;
    }

    const manuals = ((manualRows ?? []) as (ReadinessManualInput & { content: string })[])
      .filter((manual) => manual.content !== STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT)
      .map(({ id, title, category, parent_manual_id, status }) => ({
        id,
        title,
        category,
        parent_manual_id,
        status,
      }));

    const report = buildManualReadinessReport(manuals, await fetchChunkFlags(adminClient, manuals));
    return NextResponse.json({ report });
  } catch (e) {
    console.error("[STORE_MANUALS_SEARCH_READINESS] lookup failed:", {
      name: e instanceof Error ? e.name : "UnknownError",
    });
    return NextResponse.json({ error: "검색 준비 상태를 불러오지 못했습니다." }, { status: 500 });
  }
}

/** embedding 값 자체는 가져오지 않고 null 여부만 읽는다. */
async function fetchChunkFlags(
  adminClient: ReturnType<typeof createAdminClient>,
  manuals: readonly ReadinessManualInput[],
): Promise<ReadinessChunkInput[]> {
  // 자식이 없는 단독 매뉴얼도 검색 대상이므로, 범위 안 모든 id를 한 번에 조회한다.
  const manualIds = manuals.map((manual) => manual.id);

  if (manualIds.length === 0) {
    return [];
  }

  const { data, error } = await adminClient
    .from("manual_chunks")
    .select("manual_id, embedding")
    .in("manual_id", manualIds);

  if (error) {
    throw error;
  }

  return ((data ?? []) as { manual_id: string; embedding: unknown }[]).map((row) => ({
    manual_id: row.manual_id,
    has_embedding: row.embedding !== null && row.embedding !== undefined,
  }));
}
