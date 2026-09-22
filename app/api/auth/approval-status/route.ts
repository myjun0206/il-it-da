import { NextResponse } from "next/server";

import { getAccountApprovalStatus, type AccountApprovalStatus } from "@/lib/auth/account-approval";
import { createAdminClient } from "@/lib/supabase/admin";

type ApprovalStatusResponse = {
  found: boolean;
  status?: AccountApprovalStatus;
  role?: string;
  error?: string;
};

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export async function POST(request: Request): Promise<NextResponse<ApprovalStatusResponse>> {
  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ found: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json({ found: false, error: "올바른 이메일을 입력해주세요." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: profileByEmail, error } = await adminClient
    .from("profiles")
    .select("id, role")
    .eq("email", email)
    .maybeSingle<{ id: string; role: string }>();

  if (error) {
    console.error("[APPROVAL_STATUS] Profile lookup failed:", error.code);
    return NextResponse.json({ found: false, error: "승인 상태를 확인할 수 없습니다." }, { status: 500 });
  }

  let profile = profileByEmail;

  if (!profile) {
    const { data: authUsers, error: authUsersError } = await adminClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (authUsersError) {
      console.error("[APPROVAL_STATUS] Auth user lookup failed:", authUsersError.name);
      return NextResponse.json({ found: false, error: "승인 상태를 확인할 수 없습니다." }, { status: 500 });
    }

    const authUser = authUsers.users.find(
      (candidate) => candidate.email?.trim().toLowerCase() === email,
    );
    if (!authUser) {
      return NextResponse.json({ found: false });
    }

    const { data: profileById, error: profileByIdError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", authUser.id)
      .maybeSingle<{ id: string; role: string }>();

    if (profileByIdError) {
      console.error("[APPROVAL_STATUS] Profile ID lookup failed:", profileByIdError.code);
      return NextResponse.json({ found: false, error: "승인 상태를 확인할 수 없습니다." }, { status: 500 });
    }
    if (!profileById) {
      return NextResponse.json({ found: false });
    }

    const { error: backfillError } = await adminClient
      .from("profiles")
      .update({ email })
      .eq("id", authUser.id);
    if (backfillError) {
      console.error("[APPROVAL_STATUS] Profile email backfill failed:", backfillError.code);
    }

    profile = profileById;
  }

  try {
    const status = await getAccountApprovalStatus(adminClient, profile.id, profile.role);
    return NextResponse.json(
      { found: true, status, role: profile.role },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (statusError) {
    console.error("[APPROVAL_STATUS] Membership lookup failed:", statusError);
    return NextResponse.json({ found: false, error: "승인 상태를 확인할 수 없습니다." }, { status: 500 });
  }
}