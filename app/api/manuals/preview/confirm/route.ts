import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { parseConfirmedManualGroups } from "@/lib/manuals/parse-confirmed-manual-groups";
import { saveManualGroupsWithBatchGuard } from "@/lib/manuals/save-manuals-with-batch";
import { IDEMPOTENCY_KEY_PATTERN } from "@/lib/manuals/manual-upload-batch";
import { MISSING_KEY_MESSAGE } from "@/lib/manuals/manual-upload-batch-messages";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type ConfirmManualsResponse = {
  manuals?: ManualRecord[];
  error?: string;
};

type ConfirmManualsRequestBody = {
  manuals?: unknown;
  idempotencyKey?: unknown;
};

/**
 * Actually saves what the HQ user confirmed in the preview screen. Reuses the exact same
 * saveManualGroupsWithChunks/syncChunksForManuals/reembedApprovedManuals/indexManualById
 * contract as the direct-upload route: parent (topic card) is never chunked, only children are
 * chunked+embedded, and a single child's embedding failure never blocks the rest of the batch.
 *
 * Scope (franchiseId/brandName) is resolved exclusively from the authenticated HQ session via
 * requireHqUser() - nothing from the request body is trusted for that. No storeId is accepted
 * here, so every save through this endpoint is scope_type "hq" (the common -> hq contract for
 * HQ-uploaded manuals holds by construction, not by trusting a client-supplied value).
 *
 * 중복 저장 방지: 미리보기가 발급한 idempotencyKey로 요청 1건을 식별하고, 저장할 내용은
 * saveManualGroupsWithBatchGuard가 서버에서 다시 정규화해 fingerprint를 계산한다.
 * body의 hash/franchiseId/scopeType은 읽지 않는다.
 */
export async function POST(request: Request): Promise<NextResponse<ConfirmManualsResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  let body: ConfirmManualsRequestBody;

  try {
    body = (await request.json()) as ConfirmManualsRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const idempotencyKey =
    typeof body.idempotencyKey === "string" && IDEMPOTENCY_KEY_PATTERN.test(body.idempotencyKey.trim())
      ? body.idempotencyKey.trim()
      : null;

  if (!idempotencyKey) {
    return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 400 });
  }

  const groups = parseConfirmedManualGroups(body.manuals);

  if (!groups) {
    return NextResponse.json(
      { error: "저장할 매뉴얼 내용이 없거나 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const result = await saveManualGroupsWithBatchGuard(supabase, {
    auth: hqUser,
    groups,
    scope: { scopeType: "hq", franchiseId: hqUser.franchiseId, storeId: null },
    idempotencyKey,
  });

  if (result.kind === "blocked") {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (result.kind === "save_failed") {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // 같은 요청이 이미 성공했다면 그때 만든 행을 그대로 돌려준다(새 행을 만들지 않는다).
  return NextResponse.json({ manuals: result.manuals }, { status: result.kind === "saved" ? 201 : 200 });
}
