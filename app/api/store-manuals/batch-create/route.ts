import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
import { type ManualGroupInput } from "@/lib/rag/save-manual-sections";
import { saveManualGroupsWithBatchGuard } from "@/lib/manuals/save-manuals-with-batch";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type BatchCreateRequestBody = {
  storeId?: unknown;
  groups?: unknown;
};

type BatchCreateResponse = {
  manuals?: ManualRecord[];
  error?: string;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseGroups(groups: unknown): ManualGroupInput[] | null {
  if (!Array.isArray(groups) || groups.length === 0) {
    return null;
  }

  const parsed: ManualGroupInput[] = [];

  for (const raw of groups) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const record = raw as { category?: unknown; topic?: unknown; items?: unknown };
    const category = getString(record.category);
    const topic = getString(record.topic);

    // category가 비어 있으면 saveManualGroupsWithChunks가 topic을 그대로 category로 쓰는 legacy
    // fallback이 발동한다(HQ와 공유하는 함수라 수정 불가). 여기서 미리 거부해 그 폴백을 차단한다.
    if (!category) {
      return null;
    }

    if (!topic || !Array.isArray(record.items) || record.items.length === 0) {
      return null;
    }

    const items: string[] = [];
    for (const item of record.items) {
      const content = getString(item);
      if (!content) {
        return null;
      }
      items.push(content);
    }

    // AI 미리보기 단계의 normalizeForCompare 보정(analyze-manual-with-ai.ts)을 거치지 않고
    // 사용자가 카테고리를 직접 타이틀과 또같이 수정해 제출하는 경우를 대비해,
    // 실제 DB 저장 직전에도 동일한 충돌 감지를 한 번 더 적용한다.
    const resolvedCategory = normalizeForCompare(category) === normalizeForCompare(topic) ? "미분류" : category;

    parsed.push({ category: resolvedCategory, topic, items });
  }

  return parsed;
}

/**
 * AI 분석 미리보기 화면에서 검토를 마친 카테고리/타이틀/세부 매뉴얼 그룹들을
 * 한 번에 지점 매뉴얼로 등록한다. (POST /api/store-manuals/analyze의 결과를 그대로, 혹은 사용자가 수정한 값을 받는다)
 */
export async function POST(request: Request): Promise<NextResponse<BatchCreateResponse>> {
  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    let body: BatchCreateRequestBody;
    try {
      body = (await request.json()) as BatchCreateRequestBody;
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

    const groups = parseGroups(body.groups);

    if (!groups) {
      return NextResponse.json({ error: "등록할 카테고리/타이틀/세부 매뉴얼 정보가 올바르지 않습니다." }, { status: 400 });
    }

    // 구식 "AI 분석" 흐름의 확정 저장 경로. preview/confirm과 동일한 중복 방지 계약을 적용한다.
    const result = await saveManualGroupsWithBatchGuard(adminClient, {
      auth: storeAuth,
      groups,
      storeId: storeAuth.storeId,
      scope: { scopeType: "store", franchiseId: storeAuth.franchiseId, storeId: storeAuth.storeId },
    });

    if (result.kind === "blocked") {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (result.kind === "save_failed") {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ manuals: result.manuals }, { status: result.kind === "saved" ? 201 : 200 });
  } catch (e) {
    console.error("POST /api/store-manuals/batch-create error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "매뉴얼 일괄 등록 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
