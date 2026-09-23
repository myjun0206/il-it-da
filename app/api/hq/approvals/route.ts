import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { createNotification } from "@/lib/notifications";

export const runtime = "nodejs";

type ApprovalAction = "approve" | "reject";
type ApprovalStatus = "pending" | "approved" | "rejected";

type UpdateApprovalRequest = {
  membershipId?: unknown;
  action?: unknown;
};

type StoreMembership = {
  id: string;
  user_id: string;
  store_id: string;
  role: "owner" | "staff";
  status: ApprovalStatus;
  requested_at: string;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  user_name?: string;
  user_email?: string | null;
  store_name?: string;
  has_owner_conflict?: boolean;
  existing_owner_names?: string[];
};

type ApprovalItem = {
  membership: StoreMembership;
};

function isApprovalAction(value: unknown): value is ApprovalAction {
  return value === "approve" || value === "reject";
}

function isApprovalStatus(value: string | null): value is ApprovalStatus {
  return value === "pending" || value === "approved" || value === "rejected";
}

function unauthorizedResponse() {
  return NextResponse.json(
    { success: false, error: "Unauthorized: HQ profile required" },
    { status: 401 },
  );
}

function forbiddenResponse() {
  return NextResponse.json(
    { success: false, error: "Forbidden: User is not HQ" },
    { status: 403 },
  );
}

async function syncProfileApprovalStatus(adminClient: ReturnType<typeof createAdminClient>, userId: string): Promise<void> {
  const { data: memberships, error } = await adminClient
    .from("store_memberships")
    .select("status, approved_at, approved_by")
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  const hasApproved = (memberships ?? []).some((membership) => membership.status === "approved");
  const hasPending = (memberships ?? []).some((membership) => membership.status === "pending");
  const firstApproved = (memberships ?? []).find((membership) => membership.status === "approved");
  const approvalStatus = hasApproved ? "approved" : hasPending ? "pending" : "rejected";

  const { error: profileUpdateError } = await adminClient
    .from("profiles")
    .update({
      approval_status: approvalStatus,
      approved_at: approvalStatus === "approved" ? firstApproved?.approved_at ?? new Date().toISOString() : null,
      approved_by: approvalStatus === "approved" ? firstApproved?.approved_by ?? null : null,
    })
    .eq("id", userId);

  if (profileUpdateError) {
    throw profileUpdateError;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const hqUser = await requireHqUser();
  if (!hqUser) {
    return unauthorizedResponse();
  }

  // 011이 도입한 franchise_id 없이 다른 브랜드 요청을 보여주지 않도록 fail closed 한다.
  if (!hqUser.franchiseId) {
    return NextResponse.json({ success: true, data: [] });
  }

  const status = request.nextUrl.searchParams.get("status");
  const adminClient = createAdminClient();
  let membershipQuery = adminClient
    .from("store_memberships")
    .select("id, user_id, store_id, role, status, requested_at, approved_at, approved_by, rejected_at, rejected_by")
    .in("role", ["owner", "staff"])
    .eq("franchise_id", hqUser.franchiseId);

  if (isApprovalStatus(status)) {
    membershipQuery = membershipQuery.eq("status", status);
  }

  const { data: memberships, error: membershipError } = await membershipQuery
    .order("requested_at", { ascending: false });

  if (membershipError) {
    return NextResponse.json({ success: false, error: "Failed to fetch approvals" }, { status: 500 });
  }

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  const userIds = [...new Set(memberships.map((membership) => membership.user_id))];
  const storeIds = [...new Set(memberships.map((membership) => membership.store_id))];
  const { data: ownerMemberships, error: ownerMembershipError } = await adminClient
    .from("store_memberships")
    .select("user_id, store_id")
    .in("store_id", storeIds)
    .eq("role", "owner")
    .eq("status", "approved");

  if (ownerMembershipError) {
    return NextResponse.json({ success: false, error: "Failed to fetch approvals" }, { status: 500 });
  }

  const ownerUserIds = [...new Set((ownerMemberships ?? []).map((membership) => membership.user_id))];
  const profileUserIds = [...new Set([...userIds, ...ownerUserIds])];
  const { data: profiles, error: profileError } = await adminClient
    .from("profiles")
    .select("id, full_name, email")
    .in("id", profileUserIds);
  const { data: stores, error: storeError } = await adminClient
    .from("stores")
    .select("id, store_name")
    .in("id", storeIds);

  if (profileError || storeError) {
    return NextResponse.json({ success: false, error: "Failed to fetch approvals" }, { status: 500 });
  }

  const namesByUserId = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
  const emailsByUserId = new Map((profiles ?? []).map((profile) => [profile.id, profile.email]));
  const namesByStoreId = new Map((stores ?? []).map((store) => [store.id, store.store_name]));
  const data: ApprovalItem[] = memberships.map((membership) => ({
    membership: (() => {
      const existingOwners = (ownerMemberships ?? []).filter(
        (ownerMembership) =>
          ownerMembership.store_id === membership.store_id &&
          ownerMembership.user_id !== membership.user_id,
      );

      return {
        ...membership,
        user_name: namesByUserId.get(membership.user_id) || "Unknown User",
        user_email: emailsByUserId.get(membership.user_id) || null,
        store_name: namesByStoreId.get(membership.store_id) || "Unknown Store",
        has_owner_conflict: membership.role === "owner" && existingOwners.length > 0,
        existing_owner_names: existingOwners.map(
          (ownerMembership) => namesByUserId.get(ownerMembership.user_id) || "Unknown Owner",
        ),
      };
    })(),
  }));

  return NextResponse.json({ success: true, data });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const hqUser = await requireHqUser();
  if (!hqUser) {
    return unauthorizedResponse();
  }
  if (!hqUser.franchiseId) {
    return forbiddenResponse();
  }

  let body: UpdateApprovalRequest;
  try {
    body = (await request.json()) as UpdateApprovalRequest;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.membershipId !== "string" || !body.membershipId.trim()) {
    return NextResponse.json({ success: false, error: "membershipId is required" }, { status: 400 });
  }
  if (!isApprovalAction(body.action)) {
    return NextResponse.json({ success: false, error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: membership, error: membershipError } = await adminClient
    .from("store_memberships")
    .select("id, role, status, franchise_id")
    .eq("id", body.membershipId.trim())
    .eq("franchise_id", hqUser.franchiseId)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json({ success: false, error: "Failed to update membership" }, { status: 500 });
  }
  if (!membership) {
    return NextResponse.json({ success: false, error: "Membership not found" }, { status: 404 });
  }
  if (membership.role !== "owner" && membership.role !== "staff") {
    return forbiddenResponse();
  }
  const allowedCurrentStatuses = body.action === "approve"
    ? ["pending", "rejected"]
    : ["pending", "approved"];

  if (!allowedCurrentStatuses.includes(membership.status)) {
    return NextResponse.json(
      { success: false, error: "This membership cannot be updated with the requested action" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const update = body.action === "approve"
    ? {
        status: "approved",
        approved_at: now,
        approved_by: hqUser.userId,
        rejected_at: null,
        rejected_by: null,
        updated_at: now,
      }
    : {
        status: "rejected",
        rejected_at: now,
        rejected_by: hqUser.userId,
        approved_at: null,
        approved_by: null,
        updated_at: now,
      };

  // status=pending 조건까지 포함해 동시 요청이 같은 membership을 두 번 전환하지 못하게 한다.
  const { data: updated, error: updateError } = await adminClient
    .from("store_memberships")
    .update(update)
    .eq("id", membership.id)
    .eq("franchise_id", hqUser.franchiseId)
    .in("status", allowedCurrentStatuses)
    .select()
    .maybeSingle();

  if (updateError) {
    console.error("Failed to update membership:", updateError);
    return NextResponse.json(
      { success: false, error: "Failed to update membership" },
      { status: 500 },
    );
  }

  if (!updated) {
    return NextResponse.json(
      { success: false, error: "This membership cannot be updated with the requested action" },
      { status: 400 },
    );
  }

  const action = body.action;
  try {
    await syncProfileApprovalStatus(adminClient, updated.user_id);
  } catch (profileUpdateError) {
    console.error("Failed to sync profile approval status:", profileUpdateError);
    return NextResponse.json(
      { success: false, error: "Failed to sync profile approval status" },
      { status: 500 },
    );
  }

  // Generate notification for approval decision (async)
  const title = action === "approve" ? "점주 가입이 승인되었습니다." : "점주 가입이 거절되었습니다.";
  const message = action === "approve"
    ? "축하합니다! 점주 가입 신청이 승인되었습니다."
    : "죄송합니다. 점주 가입 신청이 거절되었습니다.";

  createNotification({
    recipientUserId: updated.user_id,
    type: "approval_decision",
    title,
    message,
    targetUrl: action === "approve" ? "/boss" : undefined,
    relatedId: updated.id,
  }).catch((e) => console.error("Failed to create approval notification:", e));

  return NextResponse.json({
    success: true,
    data: updated,
  });
}
