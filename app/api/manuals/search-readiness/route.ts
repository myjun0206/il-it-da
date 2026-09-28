import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { HQ_MANUAL_CATEGORY_PLACEHOLDER_CONTENT } from "@/lib/manuals/constants";
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
 * 본사 공통 매뉴얼의 "챗봇 검색 준비 상태"를 조회한다. 범위는 requireHqUser()로 확정한
 * franchise + store_id is null(018의 hq 조건과 동일)로만 좁히고, 쿼리스트링의
 * franchiseId/brandName/userId 같은 값은 읽지 않는다. 새 컬럼 없이 기존
 * manuals/manual_chunks 행으로만 계산하며, 본문과 embedding 벡터는 응답에 넣지 않는다.
 */
export async function GET(): Promise<NextResponse<ReadinessResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  if (!hqUser.franchiseId) {
    return NextResponse.json({ error: "소속 브랜드 정보를 확인할 수 없습니다." }, { status: 403 });
  }

  try {
    const adminClient = createAdminClient();
    const { data: manualRows, error: manualError } = await adminClient
      .from("manuals")
      .select("id, title, category, parent_manual_id, status, content")
      .eq("franchise_id", hqUser.franchiseId)
      .is("store_id", null)
      .order("category", { ascending: true })
      .order("created_at", { ascending: true });

    if (manualError) {
      throw manualError;
    }

    const manuals = ((manualRows ?? []) as (ReadinessManualInput & { content: string })[])
      .filter((manual) => manual.content !== HQ_MANUAL_CATEGORY_PLACEHOLDER_CONTENT)
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
    console.error("[MANUALS_SEARCH_READINESS] lookup failed:", { name: e instanceof Error ? e.name : "UnknownError" });
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
