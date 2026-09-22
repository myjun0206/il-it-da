import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { saveManualGroupsWithChunks } from "@/lib/rag/save-manual-sections";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type CreateManualGroupRequestBody = {
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

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseItems(items: unknown): string[] | null {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const parsed: string[] = [];

  for (const raw of items) {
    const content = getString(raw);
    if (!content) {
      return null;
    }
    parsed.push(content);
  }

  return parsed;
}

export async function GET(request: Request): Promise<NextResponse<ManualsListResponse>> {
  try {
    // 세션에서 사용자 정보 조회
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    // 권한 확인 (HQ 또는 Owner만 접근 가능)
    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, brand_id")
      .eq("id", userData.user.id)
      .maybeSingle<{ role: string; brand_id: string | null }>();

    if (profileError || !profile || (profile.role !== "hq" && profile.role !== "owner")) {
      return NextResponse.json({ error: "매뉴얼 열람 권한이 없습니다." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const storeIdParam = getString(searchParams.get("storeId") ?? undefined);

    // 프랜차이즈 정보 조회
    let franchiseId: string | null = null;
    let brandName = "본사";

    if (profile.role === "owner" && storeIdParam) {
      const { data: membership, error: membershipError } = await adminClient
        .from("store_memberships")
        .select("franchise_id")
        .eq("user_id", userData.user.id)
        .eq("store_id", storeIdParam)
        .eq("role", "owner")
        .eq("status", "approved")
        .maybeSingle<{ franchise_id: string | null }>();

      if (membershipError || !membership) {
        return NextResponse.json({ error: "선택한 지점의 매뉴얼 열람 권한이 없습니다." }, { status: 403 });
      }

      franchiseId = membership.franchise_id;
      if (!franchiseId) {
        const { data: selectedStore } = await adminClient
          .from("stores")
          .select("franchise_id")
          .eq("id", storeIdParam)
          .maybeSingle<{ franchise_id: string | null }>();
        franchiseId = selectedStore?.franchise_id ?? null;
      }
    }

    if (!franchiseId && profile.brand_id) {
      const { data: franchise } = await adminClient
        .from("franchises")
        .select("id, name")
        .eq("id", profile.brand_id)
        .maybeSingle<{ id: string; name: string }>();

      if (franchise) {
        franchiseId = franchise.id;
        brandName = franchise.name;
      }
    } else if (!franchiseId) {
      if (profile.role === "owner") {
        const { data: membership } = await adminClient
          .from("store_memberships")
          .select("franchise_id")
          .eq("user_id", userData.user.id)
          .eq("role", "owner")
          .eq("status", "approved")
          .not("franchise_id", "is", null)
          .limit(1)
          .maybeSingle<{ franchise_id: string | null }>();
        franchiseId = membership?.franchise_id ?? null;
      }

      // 레거시 계정: user_metadata에서 이름 파싱
      const name = userData.user.user_metadata?.name as string | undefined;
      if (!franchiseId && name && name.trim()) {
        const [first] = name.trim().split(/\s+/);
        if (first) brandName = first;
      }
    }

    // Owner는 공통 매뉴얼(store_id = null)만 조회 가능
    const storeId = profile.role === "owner" ? null : storeIdParam;

    // 쿼리 구성
    const supabase = createAdminClient();
    let query = supabase
      .from("manuals")
      .select("id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at")
      .order("category", { ascending: true })
      .order("created_at", { ascending: true });

    // 프랜차이즈별 스코핑
    query = franchiseId ? query.eq("franchise_id", franchiseId) : query.eq("brand_name", brandName);

    // 매뉴얼 범위 제한
    query = storeId ? query.or(`store_id.eq.${storeId},store_id.is.null`) : query.is("store_id", null);
    if (profile.role === "owner") {
      query = query.eq("status", "approved");
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: "매뉴얼 목록을 불러오지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json({ manuals: (data ?? []) as ManualRecord[] });
  } catch (e) {
    console.error("GET /api/manuals error:", e);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
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
  const items = parseItems(body.items);
  const storeId = getString(body.storeId);

  if (!topic || !items) {
    return NextResponse.json({ error: "주제와 내용을 모두 입력해주세요." }, { status: 400 });
  }

  const supabase = createAdminClient();

  try {
    const manuals = await saveManualGroupsWithChunks(supabase, hqUser, [{ topic, items }], storeId);
    return NextResponse.json({ manuals }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "매뉴얼 저장 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}

type DeleteAllManualsResponse = {
  deletedCount?: number;
  error?: string;
};

// 현재 로그인한 본사 계정의 프랜차이즈(또는 레거시 brand_name) 범위 안의 매뉴얼을 전부 삭제한다.
// public.manual_chunks는 manual_chunks_manual_id_fkey의 on delete cascade로 함께 정리된다.
export async function DELETE(): Promise<NextResponse<DeleteAllManualsResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  const supabase = createAdminClient();
  let query = supabase.from("manuals").delete();
  query = hqUser.franchiseId
    ? query.eq("franchise_id", hqUser.franchiseId)
    : query.eq("brand_name", hqUser.brandName);

  const { data, error } = await query.select("id");

  if (error) {
    return NextResponse.json({ error: "매뉴얼 전체 삭제 중 오류가 발생했습니다." }, { status: 500 });
  }

  return NextResponse.json({ deletedCount: (data ?? []).length });
}
