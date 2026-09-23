import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type ApprovalStatusResponse = {
  found: boolean;
  status?: "pending" | "approved" | "rejected";
  role?: string;
  fullName?: string | null;
  brandId?: string | null;
  memberships?: Array<{
    membershipId: string;
    storeId: string;
    storeName: string;
    brandId: string | null;
    brandName: string | null;
    status: "pending" | "approved" | "rejected";
    requestedAt: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
  }>;
  error?: string;
};

function normalizeEmail(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

export async function POST(request: Request): Promise<NextResponse<ApprovalStatusResponse>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ found: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const email = normalizeEmail((body as { email?: unknown } | null)?.email);
  if (!email) {
    return NextResponse.json({ found: false, error: "email is required." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: profile, error } = await adminClient
    .from("profiles")
    .select("id, role, full_name, brand_id, approval_status")
    .eq("email", email)
    .maybeSingle<{ id: string; role: string; full_name: string | null; brand_id: string | null; approval_status: string | null }>();

  if (error) {
    return NextResponse.json({ found: false, error: "승인 상태를 조회하지 못했습니다." }, { status: 500 });
  }

  if (!profile) {
    return NextResponse.json({ found: false });
  }

  const status = profile.approval_status === "approved" || profile.approval_status === "rejected"
    ? profile.approval_status
    : "pending";

  const { data: memberships, error: membershipError } = await adminClient
    .from("store_memberships")
    .select("id, store_id, franchise_id, status, requested_at, approved_at, rejected_at")
    .eq("user_id", profile.id)
    .order("requested_at", { ascending: false });

  if (membershipError) {
    return NextResponse.json({ found: false, error: "승인 상태를 조회하지 못했습니다." }, { status: 500 });
  }

  const storeIds = [...new Set((memberships ?? []).map((membership) => membership.store_id).filter(Boolean))];
  const brandIds = [...new Set((memberships ?? []).map((membership) => membership.franchise_id).filter(Boolean))];

  const { data: stores } = storeIds.length > 0
    ? await adminClient.from("stores").select("id, store_name").in("id", storeIds)
    : { data: [] as Array<{ id: string; store_name: string }> };
  const { data: franchises } = brandIds.length > 0
    ? await adminClient.from("franchises").select("id, name").in("id", brandIds)
    : { data: [] as Array<{ id: string; name: string }> };

  const storeNameById = new Map((stores ?? []).map((store) => [store.id, store.store_name]));
  const brandNameById = new Map((franchises ?? []).map((franchise) => [franchise.id, franchise.name]));
  const membershipList = (memberships ?? []).map((membership) => {
    const membershipStatus = membership.status === "approved" || membership.status === "rejected"
      ? membership.status
      : "pending";

    return {
      membershipId: membership.id,
      storeId: membership.store_id,
      storeName: storeNameById.get(membership.store_id) || "Unknown Store",
      brandId: membership.franchise_id,
      brandName: membership.franchise_id ? brandNameById.get(membership.franchise_id) || null : null,
      status: membershipStatus,
      requestedAt: membership.requested_at,
      approvedAt: membership.approved_at,
      rejectedAt: membership.rejected_at,
    };
  });

  return NextResponse.json({
    found: true,
    status,
    role: profile.role,
    fullName: profile.full_name,
    brandId: profile.brand_id,
    memberships: membershipList,
  });
}