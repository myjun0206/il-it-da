import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { indexManualById } from "@/lib/rag/index-manual";
import {
  checkManualReindexAllowed,
  REINDEX_FAILED_MESSAGE,
  REINDEX_REJECTION_MESSAGES,
  REINDEX_STATUS_BY_REASON,
  type ReindexManualRow,
} from "@/lib/manuals/manual-reindex-guard";

export const runtime = "nodejs";

type ReindexResponse = {
  reindexed?: boolean;
  error?: string;
};

type ReindexRequestBody = {
  manualId?: unknown;
};

/**
 * 검색 준비가 안 된 자식 매뉴얼 1개만 다시 색인한다(일괄 재처리 API는 두지 않는다).
 * 임베딩/청크 저장은 기존 indexManualById를 그대로 호출하므로, 001의
 * unique(manual_id, chunk_index) upsert + stale 삭제 계약이 그대로 적용돼 재실행해도
 * 청크가 중복되지 않는다. 범위는 requireHqUser()로 확정하고, 요청 본문의
 * franchiseId/storeId/scopeType은 읽지 않는다.
 */
export async function POST(request: Request): Promise<NextResponse<ReindexResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  let body: ReindexRequestBody;

  try {
    body = (await request.json()) as ReindexRequestBody;
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const manualId = typeof body.manualId === "string" && body.manualId.trim() ? body.manualId.trim() : null;

  if (!manualId) {
    return NextResponse.json({ error: "어떤 매뉴얼인지 확인하지 못했어요." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: manual, error: lookupError } = await adminClient
    .from("manuals")
    .select("id, status, franchise_id, store_id")
    .eq("id", manualId)
    .maybeSingle<ReindexManualRow>();

  if (lookupError) {
    return NextResponse.json({ error: REINDEX_FAILED_MESSAGE }, { status: 500 });
  }

  // 자식을 거느린 주제 카드만 거부하기 위해 실제 자식 존재 여부를 1회 확인한다.
  const { data: firstChild, error: childError } = await adminClient
    .from("manuals")
    .select("id")
    .eq("parent_manual_id", manualId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (childError) {
    return NextResponse.json({ error: REINDEX_FAILED_MESSAGE }, { status: 500 });
  }

  const decision = checkManualReindexAllowed(
    manual,
    { kind: "hq", franchiseId: hqUser.franchiseId },
    Boolean(firstChild),
  );

  if (!decision.allowed) {
    return NextResponse.json(
      { error: REINDEX_REJECTION_MESSAGES[decision.reason] },
      { status: REINDEX_STATUS_BY_REASON[decision.reason] },
    );
  }

  try {
    await indexManualById(manualId);
    return NextResponse.json({ reindexed: true });
  } catch (e) {
    console.error("[MANUALS_REINDEX] failed:", { name: e instanceof Error ? e.name : "UnknownError" });
    return NextResponse.json({ error: REINDEX_FAILED_MESSAGE }, { status: 500 });
  }
}
