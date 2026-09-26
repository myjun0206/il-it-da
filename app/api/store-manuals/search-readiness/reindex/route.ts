import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
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
  storeId?: unknown;
  manualId?: unknown;
};

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * 점주 지점 매뉴얼 1개만 다시 색인한다(일괄 재처리 API는 두지 않는다). storeId는 매 호출마다
 * requireStoreOwner로 다시 검증하고, 대상 매뉴얼이 그 지점의 승인된 자식인지도 DB 행으로 다시
 * 확인한다. 색인 자체는 기존 indexManualById를 재사용하므로 청크 upsert/stale 삭제 계약이
 * 그대로 적용돼 재실행해도 중복이 생기지 않는다.
 */
export async function POST(request: Request): Promise<NextResponse<ReindexResponse>> {
  const serverClient = await createClient();
  const { data: userData, error: userError } = await serverClient.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: ReindexRequestBody;

  try {
    body = (await request.json()) as ReindexRequestBody;
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const requestedStoreId = getString(body.storeId);
  const manualId = getString(body.manualId);

  if (!requestedStoreId) {
    return NextResponse.json({ error: "지점 정보를 확인하지 못했어요." }, { status: 400 });
  }

  if (!manualId) {
    return NextResponse.json({ error: "어떤 매뉴얼인지 확인하지 못했어요." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const storeAuth = await requireStoreOwner(adminClient, userData.user.id, requestedStoreId);

  if (!storeAuth) {
    return NextResponse.json({ error: "이 지점에 대한 접근 권한이 없습니다." }, { status: 403 });
  }

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
    { kind: "store", storeId: storeAuth.storeId },
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
    console.error("[STORE_MANUALS_REINDEX] failed:", { name: e instanceof Error ? e.name : "UnknownError" });
    return NextResponse.json({ error: REINDEX_FAILED_MESSAGE }, { status: 500 });
  }
}
