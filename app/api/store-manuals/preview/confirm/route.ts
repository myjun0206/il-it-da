import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
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
  storeId?: unknown;
  manuals?: unknown;
  idempotencyKey?: unknown;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Store-owner counterpart of /api/manuals/preview/confirm. Reuses the exact same
 * saveManualGroupsWithChunks/syncChunksForManuals/reembedApprovedManuals/indexManualById
 * contract: parent (topic card) is never chunked, only children are chunked+embedded, and a
 * single child's embedding failure never blocks the rest of the batch.
 *
 * Re-verifies everything server-side on every save, never trusting the request body:
 * - logged-in user (createClient().auth.getUser())
 * - owner role + approved status + access to THIS storeId (requireStoreOwner against
 *   store_memberships, same check as every other store-manuals route)
 * - franchiseId/brandName come only from requireStoreOwner's own DB lookup, never from the body
 * - scopeType is always "store" and storeId is always storeAuth.storeId (server-verified),
 *   never a client-supplied value - body.franchiseId/body.brandName/body.scopeType are never
 *   read at all.
 *
 * 중복 저장 방지: HQ confirm과 같은 saveManualGroupsWithBatchGuard를 재사용하되,
 * 범위는 검증된 storeAuth.storeId로만 잡는다(다른 지점은 같은 내용이어도 별개로 허용된다).
 */
export async function POST(request: Request): Promise<NextResponse<ConfirmManualsResponse>> {
  const serverClient = await createClient();
  const { data: userData, error: userError } = await serverClient.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: ConfirmManualsRequestBody;

  try {
    body = (await request.json()) as ConfirmManualsRequestBody;
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

  const result = await saveManualGroupsWithBatchGuard(adminClient, {
    auth: storeAuth,
    groups,
    storeId: storeAuth.storeId,
    scope: { scopeType: "store", franchiseId: storeAuth.franchiseId, storeId: storeAuth.storeId },
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
