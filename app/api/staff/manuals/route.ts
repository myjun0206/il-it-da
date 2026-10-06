import { NextResponse } from "next/server";

import {
  HQ_MANUAL_CATEGORY_PLACEHOLDER_CONTENT,
  STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT,
} from "@/lib/manuals/constants";
import {
  authorizeRagStoreAccessForRequest,
  resolveRagStoreFranchiseForRequest,
} from "@/lib/rag/authorize-rag-store-access";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

const MANUAL_SELECT_COLUMNS =
  "id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at";
const MANUAL_LOOKUP_DEBUG_ENABLED = process.env.MANUAL_LOOKUP_DEBUG === "1";

function logManualLookup(event: string, details: Record<string, unknown>): void {
  if (MANUAL_LOOKUP_DEBUG_ENABLED) {
    console.log("[MANUAL_LOOKUP_DEBUG]", JSON.stringify({ event, ...details }));
  }
}

/**
 * 직원 매뉴얼 조회 (읽기 전용 — 이 route에는 쓰기 메서드가 없다).
 * GET ?storeId=<uuid>&scope=common|store
 *
 * 1) 로그인 사용자 + 요청 storeId에 대한 approved staff membership을 서버에서 검증한다.
 *    (AI 챗봇 RAG와 같은 검증 함수. pending/rejected/남의 매장 UUID는 403)
 * 2) scope=store  → manuals.store_id = 검증된 storeId 만
 *    scope=common → 검증된 매장의 stores.franchise_id(서버 조회값)에 속한 본사 공통 매뉴얼(store_id is null) 만
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId")?.trim() ?? "";
  const scope = searchParams.get("scope");
  logManualLookup("request", {
    store_id: storeId || null,
    scope,
    status_filter: "approved",
    common_store_id_filter: scope === "common" ? "IS NULL" : null,
  });

  if (scope !== "common" && scope !== "store") {
    logManualLookup("rejected_request", { reason: "invalid_scope", scope });
    return NextResponse.json({ error: "scope는 common 또는 store여야 합니다." }, { status: 400 });
  }
  if (!storeId) {
    logManualLookup("rejected_request", { reason: "missing_store_id", scope });
    return NextResponse.json({ error: "근무 매장을 선택해 주세요.", code: "STORE_REQUIRED" }, { status: 400 });
  }

  const authorization = await authorizeRagStoreAccessForRequest(storeId, (event, details) => {
    logManualLookup(event, details);
  });
  logManualLookup("authorization", { store_id: storeId, status: authorization.status });
  if (authorization.status === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (authorization.status !== "AUTHORIZED") {
    return NextResponse.json({ error: "이 매장의 매뉴얼을 볼 권한이 없습니다.", code: "STORE_FORBIDDEN" }, { status: 403 });
  }

  try {
    const adminClient = createAdminClient();
    let resolvedFranchiseId: string | null = null;
    let query = adminClient
      .from("manuals")
      .select(MANUAL_SELECT_COLUMNS)
      .eq("status", "approved")
      .order("category", { ascending: true })
      .order("created_at", { ascending: true });

    if (scope === "store") {
      query = query.eq("store_id", storeId);
    } else {
      const franchise = await resolveRagStoreFranchiseForRequest(storeId, (event, details) => {
        logManualLookup(event, details);
      });
      if (franchise.status !== "RESOLVED") {
        // 매장의 프랜차이즈를 확인할 수 없으면 다른 브랜드 매뉴얼이 섞이지 않도록 빈 목록(fail-closed)
        logManualLookup("empty_result", {
          reason: "store_franchise_unresolved",
          store_id: storeId,
          scope,
        });
        return NextResponse.json({ manuals: [] });
      }
      resolvedFranchiseId = franchise.franchiseId;
      query = query.eq("franchise_id", franchise.franchiseId).is("store_id", null);
      logManualLookup("query_filters", {
        store_id: storeId,
        franchise_id: franchise.franchiseId,
        status: "approved",
        manual_store_id: null,
        rls_bypassed_by_service_role: true,
      });
    }

    if (scope === "store") {
      logManualLookup("query_filters", {
        store_id: storeId,
        status: "approved",
        manual_store_id: storeId,
        rls_bypassed_by_service_role: true,
      });
    }

    const { data, error } = await query;
    logManualLookup("database_result", {
      scope,
      row_count: data?.length ?? 0,
      error: error ? { code: error.code, message: error.message, details: error.details, hint: error.hint } : null,
      raw_rows: data,
    });
    if (error) {
      console.error("GET /api/staff/manuals error:", error);
      return NextResponse.json({ error: "매뉴얼을 불러오지 못했습니다." }, { status: 500 });
    }

    const placeholder = scope === "store" ? STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT : HQ_MANUAL_CATEGORY_PLACEHOLDER_CONTENT;
    const manuals = ((data ?? []) as ManualRecord[]).filter((manual) => manual.content !== placeholder);

    // Full manual content is logged only when explicitly enabled and the common view is empty.
    if (MANUAL_LOOKUP_DEBUG_ENABLED && scope === "common" && manuals.length === 0 && resolvedFranchiseId) {
      const { data: franchiseRows, error: franchiseRowsError } = await adminClient
        .from("manuals")
        .select(MANUAL_SELECT_COLUMNS)
        .eq("franchise_id", resolvedFranchiseId);
      logManualLookup("all_rows_for_franchise", {
        franchise_id: resolvedFranchiseId,
        row_count: franchiseRows?.length ?? 0,
        error: franchiseRowsError
          ? { code: franchiseRowsError.code, message: franchiseRowsError.message }
          : null,
        raw_rows: franchiseRows,
      });

      const { data: franchiseRecord, error: franchiseError } = await adminClient
        .from("franchises")
        .select("id, name")
        .eq("id", resolvedFranchiseId)
        .maybeSingle<{ id: string; name: string }>();
      logManualLookup("franchise_directory", {
        franchise: franchiseRecord,
        error: franchiseError ? { code: franchiseError.code, message: franchiseError.message } : null,
      });

      if (franchiseRecord?.name) {
        const { data: legacyRows, error: legacyRowsError } = await adminClient
          .from("manuals")
          .select(MANUAL_SELECT_COLUMNS)
          .eq("brand_name", franchiseRecord.name)
          .is("franchise_id", null);
        logManualLookup("legacy_brand_name_rows", {
          brand_name: franchiseRecord.name,
          row_count: legacyRows?.length ?? 0,
          error: legacyRowsError
            ? { code: legacyRowsError.code, message: legacyRowsError.message }
            : null,
          raw_rows: legacyRows,
        });
      }
    }

    logManualLookup("response", {
      raw_row_count: data?.length ?? 0,
      returned_row_count: manuals.length,
      removed_placeholder_count: (data?.length ?? 0) - manuals.length,
      returned_ids: manuals.map((manual) => manual.id),
    });
    return NextResponse.json({ manuals });
  } catch (error) {
    console.error("GET /api/staff/manuals error:", error);
    return NextResponse.json({ error: "매뉴얼을 불러오지 못했습니다." }, { status: 500 });
  }
}
