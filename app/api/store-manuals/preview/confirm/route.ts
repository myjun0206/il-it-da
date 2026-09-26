import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
import { saveManualGroupsWithChunks } from "@/lib/rag/save-manual-sections";
import { parseConfirmedManualGroups } from "@/lib/manuals/parse-confirmed-manual-groups";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type ConfirmManualsResponse = {
  manuals?: ManualRecord[];
  error?: string;
};

type ConfirmManualsRequestBody = {
  storeId?: unknown;
  manuals?: unknown;
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

  const groups = parseConfirmedManualGroups(body.manuals);

  if (!groups) {
    return NextResponse.json(
      { error: "저장할 매뉴얼 내용이 없거나 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    const manuals = await saveManualGroupsWithChunks(adminClient, storeAuth, groups, storeAuth.storeId);
    return NextResponse.json({ manuals }, { status: 201 });
  } catch (e) {
    console.error("[STORE_MANUALS_PREVIEW_CONFIRM] save failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "매뉴얼 저장 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
