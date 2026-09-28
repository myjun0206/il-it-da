import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

type StoreMember = {
  id: string;
  userId: string;
  role: "owner" | "staff";
  status: string;
  requestedAt: string;
  approvedAt: string | null;
  name: string;
  email: string | null;
};

type MembersResponse = {
  store?: { id: string; name: string };
  members?: StoreMember[];
  error?: string;
};

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse<MembersResponse>> {
  const hqUser = await requireHqUser();
  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }
  if (!hqUser.franchiseId) {
    return NextResponse.json({ error: "본사 브랜드 정보를 확인할 수 없습니다." }, { status: 403 });
  }

  const { id: storeId } = await context.params;
  const adminClient = createAdminClient();
  const { data: store, error: storeError } = await adminClient
    .from("stores")
    .select("id, store_name, franchise_id")
    .eq("id", storeId)
    .maybeSingle<{ id: string; store_name: string; franchise_id: string | null }>();

  if (storeError) {
    console.error("GET /api/hq/stores/[id]/members store lookup failed:", storeError);
    return NextResponse.json({ error: "지점 정보를 조회하지 못했습니다." }, { status: 500 });
  }
  if (!store || store.franchise_id !== hqUser.franchiseId) {
    return NextResponse.json({ error: "해당 지점에 접근할 수 없습니다." }, { status: 404 });
  }

  const { data: memberships, error: membershipError } = await adminClient
    .from("store_memberships")
    .select("id, user_id, role, status, requested_at, approved_at")
    .eq("store_id", store.id)
    .in("role", ["owner", "staff"])
    .eq("status", "approved")
    .order("role", { ascending: true })
    .order("requested_at", { ascending: true });

  if (membershipError) {
    console.error("GET /api/hq/stores/[id]/members membership lookup failed:", membershipError);
    return NextResponse.json({ error: "지점 소속 사용자를 조회하지 못했습니다." }, { status: 500 });
  }

  const userIds = [...new Set((memberships ?? []).map((membership) => membership.user_id))];
  const { data: profiles, error: profileError } = userIds.length
    ? await adminClient
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds)
        .is("brand_id", null)
    : { data: [], error: null };

  if (profileError) {
    console.error("GET /api/hq/stores/[id]/members profile lookup failed:", profileError);
    return NextResponse.json({ error: "소속 사용자 프로필을 조회하지 못했습니다." }, { status: 500 });
  }

  const profilesByUserId = new Map(
    (profiles ?? []).map((profile) => [profile.user_id, { name: profile.full_name, email: profile.email }]),
  );
  const members: StoreMember[] = (memberships ?? []).map((membership) => {
    const profile = profilesByUserId.get(membership.user_id);
    return {
      id: membership.id,
      userId: membership.user_id,
      role: membership.role as "owner" | "staff",
      status: membership.status,
      requestedAt: membership.requested_at,
      approvedAt: membership.approved_at,
      name: profile?.name || "이름 미등록",
      email: profile?.email ?? null,
    };
  });

  return NextResponse.json({
    store: { id: store.id, name: store.store_name },
    members,
  });
}
