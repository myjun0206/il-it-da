import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT } from "@/lib/manuals/constants";
import type { HqStoreSummary } from "@/lib/types/store";

export const runtime = "nodejs";

type HqStoresResponse = {
  stores?: HqStoreSummary[];
  error?: string;
};

function normalizeFranchiseName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export async function GET(): Promise<NextResponse<HqStoresResponse>> {
  try {
    // 1~2) 로그인 + profiles.role = 'hq' 확인
    const hqUser = await requireHqUser();
    if (!hqUser) {
      return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
    }

    const adminClient = createAdminClient();
    let franchiseId = hqUser.franchiseId;

    // brand_id가 빠진 레거시 HQ는 브랜드명이 프랜차이즈 디렉터리에서 유일하게 확인될 때만 복구한다.
    if (!franchiseId) {
      const { data: franchises, error: franchiseError } = await adminClient
        .from("franchises")
        .select("id, name");

      if (franchiseError) {
        return NextResponse.json({ error: "본사 브랜드 정보를 확인하지 못했습니다." }, { status: 500 });
      }

      const normalizedBrandName = normalizeFranchiseName(hqUser.brandName);
      const matchingFranchises = (franchises ?? []).filter(
        (franchise) => normalizeFranchiseName(franchise.name) === normalizedBrandName,
      );

      if (matchingFranchises.length !== 1) {
        return NextResponse.json(
          { error: "본사 브랜드 연결을 확인할 수 없습니다. 관리자에게 문의해 주세요." },
          { status: 403 },
        );
      }

      franchiseId = matchingFranchises[0].id;
    }

    // 해당 프랜차이즈에 속한 지점만 조회한다.
    const { data: stores, error: storeError } = await adminClient
      .from("stores")
      .select("id, store_name, created_at")
      .eq("franchise_id", franchiseId)
      .order("store_name", { ascending: true });

    if (storeError) {
      return NextResponse.json({ error: "지점 목록을 불러오지 못했습니다." }, { status: 500 });
    }

    if (!stores || stores.length === 0) {
      return NextResponse.json({ stores: [] });
    }

    // 5) 위에서 걸러진 지점 ID 범위 안에서만 구성원/매뉴얼을 조회해 다른 franchise 데이터를 차단한다.
    const storeIds = stores.map((store) => store.id);
    const [membershipResult, manualResult] = await Promise.all([
      adminClient
        .from("store_memberships")
        .select("user_id, store_id, role")
        .in("store_id", storeIds)
        .in("role", ["owner", "staff"])
        .eq("status", "approved"),
      adminClient
        .from("manuals")
        .select("store_id")
        .in("store_id", storeIds)
        // 대분류 자리표시 행은 실제 매뉴얼이 아니므로 세지 않는다.
        .neq("content", STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT),
    ]);

    if (membershipResult.error || manualResult.error) {
      return NextResponse.json({ error: "지점 정보를 불러오지 못했습니다." }, { status: 500 });
    }

    const memberships = membershipResult.data ?? [];
    const ownerUserIds = [
      ...new Set(memberships.filter((membership) => membership.role === "owner").map((membership) => membership.user_id)),
    ];

    const namesByUserId = new Map<string, string>();
    if (ownerUserIds.length > 0) {
      const { data: profiles, error: profileError } = await adminClient
        .from("profiles")
        .select("id, full_name")
        .in("id", ownerUserIds);

      if (profileError) {
        return NextResponse.json({ error: "점주 정보를 불러오지 못했습니다." }, { status: 500 });
      }

      for (const profile of profiles ?? []) {
        if (profile.full_name) namesByUserId.set(profile.id, profile.full_name);
      }
    }

    const summaries = new Map<string, HqStoreSummary>(
      stores.map((store) => [
        store.id,
        {
          id: store.id,
          name: store.store_name,
          createdAt: store.created_at ?? null,
          ownerNames: [],
          staffCount: 0,
          manualCount: 0,
        },
      ]),
    );

    for (const membership of memberships) {
      const summary = summaries.get(membership.store_id);
      if (!summary) continue;

      if (membership.role === "owner") {
        summary.ownerNames.push(namesByUserId.get(membership.user_id) ?? "이름 미등록");
      } else {
        summary.staffCount += 1;
      }
    }

    for (const manual of manualResult.data ?? []) {
      const summary = manual.store_id ? summaries.get(manual.store_id) : undefined;
      if (summary) summary.manualCount += 1;
    }

    return NextResponse.json({ stores: [...summaries.values()] });
  } catch (error) {
    console.error("GET /api/hq/stores error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
