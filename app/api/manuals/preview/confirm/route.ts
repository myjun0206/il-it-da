import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { saveManualGroupsWithChunks } from "@/lib/rag/save-manual-sections";
import { parseConfirmedManualGroups } from "@/lib/manuals/parse-confirmed-manual-groups";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type ConfirmManualsResponse = {
  manuals?: ManualRecord[];
  error?: string;
};

type ConfirmManualsRequestBody = {
  manuals?: unknown;
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

  const groups = parseConfirmedManualGroups(body.manuals);

  if (!groups) {
    return NextResponse.json(
      { error: "저장할 매뉴얼 내용이 없거나 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  try {
    const manuals = await saveManualGroupsWithChunks(supabase, hqUser, groups);
    return NextResponse.json({ manuals }, { status: 201 });
  } catch (e) {
    console.error("[MANUALS_PREVIEW_CONFIRM] save failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "매뉴얼 저장 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
