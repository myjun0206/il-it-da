import { NextResponse } from "next/server";
import { requireManualWriteContract, MANUAL_FEATURE_PENDING } from "@/lib/manuals/manual-write-contract";
import { manualSaveResult } from "@/lib/manuals/manual-save-result";
import { indexSavedManuals } from "@/lib/manuals/index-saved-manuals";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { createDiagnosticRequestId, logDiagnosticError } from "@/lib/auth/diagnostic-error-log";
import { HQ_MANUAL_CATEGORY_PLACEHOLDER_CONTENT } from "@/lib/manuals/constants";
import { type ManualItemInput } from "@/lib/rag/save-manual-sections";
import { saveManualGroupsWithBatchGuard } from "@/lib/manuals/save-manuals-with-batch";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateManualGroupRequestBody = {
  category?: unknown;
  categoryOnly?: unknown;
  topic?: unknown;
  items?: unknown;
  storeId?: unknown;
};

type ManualsListResponse = {
  manuals?: ManualRecord[];
  error?: string;
};

type CreateManualsResponse = {
  manuals?: ManualRecord[];
  error?: string;
};

type UpdateManualsRequestBody = {
  action?: unknown;
  category?: unknown;
  newCategory?: unknown;
};

type UpdateManualsResponse = {
  manuals?: ManualRecord[];
  updatedCount?: number;
  error?: string;
};

const CATEGORY_PLACEHOLDER_CONTENT = HQ_MANUAL_CATEGORY_PLACEHOLDER_CONTENT;
const MANUAL_SELECT_COLUMNS =
  "id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at";

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// items는 문자열(본문만) 또는 { title?, content } 객체 배열을 받는다. 본문이 비어 있는 항목이 하나라도 있으면 거부한다.
function parseItems(items: unknown): ManualItemInput[] | null {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const parsed: ManualItemInput[] = [];

  for (const raw of items) {
    if (typeof raw === "string") {
      const content = getString(raw);
      if (!content) {
        return null;
      }
      parsed.push(content);
      continue;
    }

    if (raw && typeof raw === "object") {
      const record = raw as { title?: unknown; content?: unknown };
      const content = getString(record.content);
      if (!content) {
        return null;
      }
      const title = getString(record.title);
      parsed.push(title ? { title: title.slice(0, 100), content } : content);
      continue;
    }

    return null;
  }

  return parsed;
}

export async function GET(request: Request): Promise<NextResponse<ManualsListResponse>> {
  const requestId = createDiagnosticRequestId();
  const startedAt = Date.now();
  const searchParams = new URL(request.url).searchParams;
  const storeIdParam = getString(searchParams.get("storeId") ?? undefined);
  const scope = searchParams.get("scope") === "store" ? "store" : "common";
  const cookieHeader = request.headers.get("cookie") ?? "";
  const hasSessionCookie = cookieHeader.split(";").some((cookie) => /^il-it-da-auth-session(?:\.\d+)?=/.test(cookie.trim()));
  const proxyRequestId = request.headers.get("x-proxy-request-id") ?? undefined;
  let userId: string | null = null;
  let role: string | undefined;
  let stage = "auth.get_user";
  const response = (body: ManualsListResponse, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Vary: "Cookie",
        "X-Request-Id": requestId,
      },
    });

  try {
    // 세션에서 사용자 정보 조회
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      logDiagnosticError("MANUALS_GET", stage, userError ?? new Error("Supabase returned no authenticated user"), {
        requestId,
        path: "/api/manuals",
        scope,
        hasStoreId: Boolean(storeIdParam),
        hasSessionCookie,
        proxyRequestId,
        sessionPresent: Boolean(userData.user),
      });
      return response({ error: "로그인이 필요합니다." }, 401);
    }
    userId = userData.user.id;

    // 권한 확인 (HQ 또는 Owner만 접근 가능)
    stage = "profile.lookup";
    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, brand_id")
      .eq("id", userData.user.id)
      .maybeSingle<{ role: string; brand_id: string | null }>();

    if (profileError) {
      logDiagnosticError("MANUALS_GET", stage, profileError, {
        requestId,
        userId,
        hasSessionCookie,
        proxyRequestId,
        sessionPresent: true,
      });
      return response({ error: "매뉴얼 권한을 확인하지 못했습니다." }, 500);
    }
    if (!profile || (profile.role !== "hq" && profile.role !== "owner")) {
      return response({ error: "매뉴얼 열람 권한이 없습니다." }, 403);
    }
    role = profile.role;

    const storeOnly = profile.role === "hq" && searchParams.get("scope") === "store";
    if (profile.role === "owner" && !storeIdParam) {
      return response({ error: "공통 매뉴얼을 조회할 운영 매장을 선택해주세요." }, 400);
    }
    if (storeOnly && !storeIdParam) {
      return response({ error: "조회할 지점을 선택해주세요." }, 400);
    }

    // HQ는 master profile의 franchise를 사용하고, owner는 브랜드별 profile과
    // 요청 매장의 승인 membership 및 stores.franchise_id가 일치하는 단일 franchise만 조회한다.
    let franchiseId: string | null = null;
    let brandName = "본사";
    let ownerFranchiseIds: string[] = [];

    if (profile.role === "owner") {
      const [{ data: brandProfiles, error: brandProfileError }, { data: memberships, error: membershipError }] =
        await Promise.all([
          adminClient
            .from("profiles")
            .select("brand_id")
            .eq("user_id", userData.user.id)
            .eq("role", "owner")
            .not("brand_id", "is", null),
          adminClient
            .from("store_memberships")
            .select("store_id, franchise_id")
            .eq("user_id", userData.user.id)
            .eq("role", "owner")
            .eq("status", "approved")
            .not("franchise_id", "is", null),
        ]);

      if (brandProfileError || membershipError) {
        const error = brandProfileError ?? membershipError;
        logDiagnosticError("MANUALS_GET", "owner.scope_lookup", error, {
          requestId,
          userId,
          role,
          hasSessionCookie,
          proxyRequestId,
          sessionPresent: true,
        });
        return response({ error: "브랜드 매뉴얼 범위를 확인하지 못했습니다." }, 500);
      }

      const storeIds = [...new Set((memberships ?? []).map((membership) => membership.store_id))];
      const { data: stores, error: storesError } = storeIds.length > 0
        ? await adminClient
            .from("stores")
            .select("id, franchise_id")
            .in("id", storeIds)
        : { data: [], error: null };

      if (storesError) {
        logDiagnosticError("MANUALS_GET", "owner.store_scope_lookup", storesError, {
          requestId,
          userId,
          role,
          hasSessionCookie,
          proxyRequestId,
          sessionPresent: true,
        });
        return response({ error: "매장 브랜드 범위를 확인하지 못했습니다." }, 500);
      }

      const profileBrandIds = new Set(
        (brandProfiles ?? []).map((row) => row.brand_id).filter((id): id is string => !!id),
      );
      const franchiseIdByStoreId = new Map((stores ?? []).map((store) => [store.id, store.franchise_id]));
      const selectedMembership = (memberships ?? []).find(
        (membership) => membership.store_id === storeIdParam,
      );
      const selectedFranchiseId = selectedMembership?.franchise_id ?? null;

      if (
        !selectedFranchiseId ||
        !profileBrandIds.has(selectedFranchiseId) ||
        franchiseIdByStoreId.get(storeIdParam) !== selectedFranchiseId
      ) {
        return response({ error: "선택한 매장의 브랜드를 확인할 수 없습니다." }, 403);
      }

      ownerFranchiseIds = [selectedFranchiseId];
    } else if (profile.brand_id) {
      stage = "franchise.lookup";
      const { data: franchise, error: franchiseError } = await adminClient
        .from("franchises")
        .select("id, name")
        .eq("id", profile.brand_id)
        .maybeSingle<{ id: string; name: string }>();

      if (franchiseError || !franchise) {
        const error = franchiseError ?? new Error("HQ profile brand_id did not resolve to a franchise");
        logDiagnosticError("MANUALS_GET", stage, error, {
          requestId,
          userId,
          role,
          hasSessionCookie,
          proxyRequestId,
          sessionPresent: true,
        });
        return response({ error: "본사 브랜드 정보를 확인하지 못했습니다." }, 500);
      }

      franchiseId = franchise.id;
      brandName = franchise.name;
    } else {
      // 레거시 계정: user_metadata에서 이름 파싱
      const name = userData.user.user_metadata?.name as string | undefined;
      if (name && name.trim()) {
        const [first] = name.trim().split(/\s+/);
        if (first) brandName = first;
      }
    }

    if (profile.role === "hq" && storeIdParam) {
      if (!franchiseId) {
        return response({ error: "본사 브랜드를 확인할 수 없습니다." }, 403);
      }

      stage = "hq.store_authorization";
      const { data: selectedStore, error: selectedStoreError } = await adminClient
        .from("stores")
        .select("id")
        .eq("id", storeIdParam)
        .eq("franchise_id", franchiseId)
        .maybeSingle<{ id: string }>();

      if (selectedStoreError) {
        logDiagnosticError("MANUALS_GET", stage, selectedStoreError, {
          requestId,
          userId,
          role,
          storeId: storeIdParam,
          franchiseId,
          hasSessionCookie,
          proxyRequestId,
          sessionPresent: true,
        });
        return response({ error: "지점 권한을 확인하지 못했습니다." }, 500);
      }
      if (!selectedStore) {
        return response({ error: "선택한 지점을 조회할 권한이 없습니다." }, 403);
      }
    }

    // Owner는 공통 매뉴얼(store_id = null)만 조회 가능
    const storeId = profile.role === "owner" ? null : storeIdParam;
    const includeCategoryPlaceholders = profile.role === "hq" && searchParams.get("includeCategoryPlaceholders") === "1";

    // 쿼리 구성
    const supabase = createAdminClient();
    let query = supabase
      .from("manuals")
      .select("id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at")
      .order("category", { ascending: true })
      .order("created_at", { ascending: true });

    // 프랜차이즈별 스코핑
    if (profile.role === "owner") {
      if (ownerFranchiseIds.length === 0) {
        return response({ manuals: [] });
      }
      query = query.in("franchise_id", ownerFranchiseIds);
    } else {
      query = franchiseId ? query.eq("franchise_id", franchiseId) : query.eq("brand_name", brandName);
    }

    // Owner common-manual views include HQ rows; HQ store detail can request that store only.
    query = storeOnly
      ? query.eq("store_id", storeId as string)
      : storeId
        ? query.or(`store_id.eq.${storeId},store_id.is.null`)
        : query.is("store_id", null);

    stage = "manuals.query";
    const { data, error } = await query;

    if (error) {
      logDiagnosticError("MANUALS_GET", stage, error, {
        requestId,
        userId,
        role,
        scope: storeOnly ? "store" : storeId ? "store+common" : "common",
        hasStoreId: Boolean(storeId),
        hasSessionCookie,
        proxyRequestId,
        sessionPresent: true,
      });
      return response({ error: "매뉴얼 목록을 불러오지 못했습니다." }, 500);
    }

    const manuals = ((data ?? []) as ManualRecord[]).filter(
      (manual) => includeCategoryPlaceholders || manual.content !== CATEGORY_PLACEHOLDER_CONTENT,
    );

    console.info("[MANUALS_GET] complete", {
      requestId,
      role,
      scope: storeOnly ? "store" : storeId ? "store+common" : "common",
      resultCount: manuals.length,
      durationMs: Date.now() - startedAt,
      sessionPresent: true,
    });
    return response({ manuals });
  } catch (e) {
    logDiagnosticError("MANUALS_GET", stage, e, {
      requestId,
      userId,
      role,
      scope,
      hasStoreId: Boolean(storeIdParam),
      hasSessionCookie,
      proxyRequestId,
      sessionPresent: Boolean(userId),
    });
    return response({ error: "서버 오류가 발생했습니다." }, 500);
  }
}

export async function POST(request: Request): Promise<NextResponse<CreateManualsResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  let body: CreateManualGroupRequestBody;

  try {
    body = (await request.json()) as CreateManualGroupRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const topic = getString(body.topic);
  const category = getString(body.category);
  const items = parseItems(body.items);

  // 이 라우트는 항상 HQ 공통(scope_type "hq") 범위로만 저장한다.
  // body.storeId로 범위를 바꿀 수 있게 두면 중복 방지 범위까지 우회된다. 지점 매뉴얼은 store-manuals 라우트를 쓴다.
  if (getString(body.storeId)) {
    return NextResponse.json(
      { error: "지점 매뉴얼은 지점 매뉴얼 화면에서 등록해주세요." },
      { status: 400 },
    );
  }

  if (body.categoryOnly === true) {
    if (!category) {
      return NextResponse.json({ error: "카테고리를 입력해주세요." }, { status: 400 });
    }

    const supabase = createAdminClient();
    try { await requireManualWriteContract(supabase); }
    catch { return NextResponse.json({ error: MANUAL_FEATURE_PENDING }, { status: 503 }); }
    const { data, error } = await supabase
      .from("manuals")
      .insert({
        brand_name: hqUser.brandName,
        franchise_id: hqUser.franchiseId,
        store_id: null,
        scope_type: "hq",
        parent_manual_id: null,
        title: category,
        category,
        content: CATEGORY_PLACEHOLDER_CONTENT,
        status: "draft",
      })
      .select(MANUAL_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "카테고리 저장 중 오류가 발생했습니다." }, { status: 500 });
    }

    return NextResponse.json({ manuals: [data as ManualRecord], ...manualSaveResult([{ ...data, search_status: "not_searchable" } as ManualRecord]) }, { status: 201 });
  }

  if (!topic || !items) {
    return NextResponse.json({ error: "주제와 내용을 모두 입력해주세요." }, { status: 400 });
  }

  const supabase = createAdminClient();
  // 단건 작성에는 미리보기 단계가 없어 발급된 key가 없다. guard가 요청단위 key를 만들고,
  // 같은 내용의 재전송은 content fingerprint로 걸러낸다.
  const result = await saveManualGroupsWithBatchGuard(supabase, {
    auth: hqUser,
    groups: [{ category, topic, items }],
    scope: { scopeType: "hq", franchiseId: hqUser.franchiseId, storeId: null },
  });

  if (result.kind === "blocked") {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (result.kind === "save_failed") {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ manuals: result.manuals, ...manualSaveResult(result.manuals) }, { status: result.kind === "saved" ? 201 : 200 });
}

export async function PATCH(request: Request): Promise<NextResponse<UpdateManualsResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  let body: UpdateManualsRequestBody;

  try {
    body = (await request.json()) as UpdateManualsRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.action !== "rename-category" && body.action !== "delete-category") {
    return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
  }

  const category = getString(body.category);

  if (!category) {
    return NextResponse.json({ error: "카테고리를 입력해주세요." }, { status: 400 });
  }

  const supabase = createAdminClient();

  if (body.action === "delete-category") {
    let targetQuery = supabase
      .from("manuals")
      .select("id")
      .eq("category", category)
      .is("store_id", null);

    targetQuery = hqUser.franchiseId
      ? targetQuery.eq("franchise_id", hqUser.franchiseId)
      : targetQuery.eq("brand_name", hqUser.brandName);

    const { data: targets, error: targetError } = await targetQuery;

    if (targetError) {
      return NextResponse.json({ error: "삭제할 카테고리 조회 중 오류가 발생했습니다." }, { status: 500 });
    }

    const ids = (targets ?? []).map((row) => row.id as string);

    if (ids.length === 0) {
      return NextResponse.json({ error: "삭제할 카테고리를 찾지 못했습니다." }, { status: 404 });
    }

    let childrenQuery = supabase.from("manuals").delete().in("parent_manual_id", ids);
    childrenQuery = hqUser.franchiseId
      ? childrenQuery.eq("franchise_id", hqUser.franchiseId)
      : childrenQuery.eq("brand_name", hqUser.brandName);

    const { error: childrenError } = await childrenQuery;

    if (childrenError) {
      return NextResponse.json({ error: "카테고리 하위 매뉴얼 삭제 중 오류가 발생했습니다." }, { status: 500 });
    }

    let parentQuery = supabase.from("manuals").delete().in("id", ids);
    parentQuery = hqUser.franchiseId
      ? parentQuery.eq("franchise_id", hqUser.franchiseId)
      : parentQuery.eq("brand_name", hqUser.brandName);

    const { data, error } = await parentQuery.select("id");

    if (error) {
      return NextResponse.json({ error: "카테고리 삭제 중 오류가 발생했습니다." }, { status: 500 });
    }

    return NextResponse.json({ updatedCount: (data ?? []).length });
  }

  const newCategory = getString(body.newCategory);

  if (!newCategory) {
    return NextResponse.json({ error: "새 카테고리를 입력해주세요." }, { status: 400 });
  }

  let context;
  try { context = await requireManualWriteContract(supabase); }
  catch { return NextResponse.json({ error: MANUAL_FEATURE_PENDING }, { status: 503 }); }
  let query = supabase
    .from("manuals")
    .update({ category: newCategory, updated_at: new Date().toISOString() })
    .eq("category", category)
    .is("store_id", null);

  query = hqUser.franchiseId
    ? query.eq("franchise_id", hqUser.franchiseId)
    : query.eq("brand_name", hqUser.brandName);

  const { data, error } = await query.select(MANUAL_SELECT_COLUMNS);

  if (error) {
    return NextResponse.json({ error: "카테고리 이름 변경 중 오류가 발생했습니다." }, { status: 500 });
  }

  const manuals = (data ?? []) as ManualRecord[];
  const search = await indexSavedManuals(manuals, context).catch(() => manualSaveResult(manuals));
  return NextResponse.json({ manuals, updatedCount: manuals.length, ...search });
}

type DeleteAllManualsResponse = {
  targetCount?: number;
  deletedCount?: number;
  remainingCount?: number;
  verified?: boolean;
  error?: string;
};

// 본사 공통 행만 삭제하며, 삭제 대상 밖의 자식은 FK cascade 전에 연결을 분리한다.
export async function DELETE(): Promise<NextResponse<DeleteAllManualsResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  const supabase = createAdminClient();
  let targetQuery = supabase
    .from("manuals")
    .select("id")
    .is("store_id", null);
  targetQuery = hqUser.franchiseId
    ? targetQuery.eq("franchise_id", hqUser.franchiseId)
    : targetQuery.eq("brand_name", hqUser.brandName);

  const { data: targets, error: targetError } = await targetQuery;

  if (targetError) {
    return NextResponse.json({ error: "삭제 대상 매뉴얼 조회 중 오류가 발생했습니다." }, { status: 500 });
  }

  const targetIds = (targets ?? []).map((row) => row.id as string);
  console.info("[HQ_MANUAL_DELETE] target scope and ids", {
    franchise_id: hqUser.franchiseId,
    brand_name: hqUser.franchiseId ? undefined : hqUser.brandName,
    store_id: null,
    target_count: targetIds.length,
    target_ids: targetIds,
  });

  if (targetIds.length === 0) {
    console.info("[HQ_MANUAL_DELETE] hard delete result", {
      target_count: 0,
      deleted_count: 0,
      remaining_count: 0,
      verified: true,
    });
    return NextResponse.json({ targetCount: 0, deletedCount: 0, remainingCount: 0, verified: true });
  }

  const { data: branchChildren, error: branchChildrenError } = await supabase
    .from("manuals")
    .select("id")
    .in("parent_manual_id", targetIds);

  if (branchChildrenError) {
    return NextResponse.json({ error: "지점 하위 매뉴얼 확인 중 오류가 발생했습니다." }, { status: 500 });
  }

  const targetIdSet = new Set(targetIds);
  const branchChildIds = (branchChildren ?? [])
    .map((row) => row.id as string)
    .filter((id) => !targetIdSet.has(id));
  if (branchChildIds.length > 0) {
    const { error: detachError } = await supabase
      .from("manuals")
      .update({ parent_manual_id: null, updated_at: new Date().toISOString() })
      .in("id", branchChildIds);

    if (detachError) {
      return NextResponse.json({ error: "지점 하위 매뉴얼 보호 중 오류가 발생했습니다." }, { status: 500 });
    }

    console.info("[HQ_MANUAL_DELETE] preserved branch children", {
      detached_count: branchChildIds.length,
      detached_ids: branchChildIds,
    });
  }

  let query = supabase
    .from("manuals")
    .delete()
    .in("id", targetIds)
    .is("store_id", null);
  query = hqUser.franchiseId
    ? query.eq("franchise_id", hqUser.franchiseId)
    : query.eq("brand_name", hqUser.brandName);

  const { data, error } = await query.select("id");

  if (error) {
    console.error("[HQ_MANUAL_DELETE] hard delete failed", {
      target_count: targetIds.length,
      error_code: error.code,
      error_message: error.message,
    });
    return NextResponse.json({ error: "매뉴얼 전체 삭제 중 오류가 발생했습니다." }, { status: 500 });
  }

  const deletedCount = (data ?? []).length;
  let remainingQuery = supabase
    .from("manuals")
    .select("id")
    .in("id", targetIds)
    .is("store_id", null);
  remainingQuery = hqUser.franchiseId
    ? remainingQuery.eq("franchise_id", hqUser.franchiseId)
    : remainingQuery.eq("brand_name", hqUser.brandName);

  const { data: remainingRows, error: verificationError } = await remainingQuery;
  if (verificationError) {
    console.error("[HQ_MANUAL_DELETE] verification failed", {
      target_count: targetIds.length,
      deleted_count: deletedCount,
      error_code: verificationError.code,
      error_message: verificationError.message,
    });
    return NextResponse.json({
      targetCount: targetIds.length,
      deletedCount,
      error: "삭제는 실행됐지만 DB 잔존 여부를 확인하지 못했습니다.",
    }, { status: 500 });
  }

  const remainingCount = (remainingRows ?? []).length;
  const verified = remainingCount === 0;
  console.info("[HQ_MANUAL_DELETE] hard delete result", {
    target_count: targetIds.length,
    deleted_count: deletedCount,
    remaining_count: remainingCount,
    verified,
  });

  if (!verified) {
    return NextResponse.json({
      targetCount: targetIds.length,
      deletedCount,
      remainingCount,
      verified,
      error: "일부 본사 공통 매뉴얼이 DB에 남아 있습니다.",
    }, { status: 500 });
  }

  return NextResponse.json({ targetCount: targetIds.length, deletedCount, remainingCount, verified });
}
