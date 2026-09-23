import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/user";

export const runtime = "nodejs";

const ROLE_DESTINATIONS: Record<UserRole, string> = {
  hq: "/hq",
  owner: "/boss",
  staff: "/staff",
};

function loginErrorUrl(origin: string, error: string): URL {
  const url = new URL("/", origin);
  url.searchParams.set("oauthError", error);
  return url;
}

function signupApprovalUrl(origin: string, next: string | null): URL | null {
  if (!next) {
    return null;
  }

  const url = new URL(next, origin);
  if (url.origin !== origin || url.pathname !== "/signup/approval") {
    return null;
  }

  return url;
}

function isUserRole(value: unknown): value is UserRole {
  return value === "hq" || value === "owner" || value === "staff";
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "missing_code"));
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "exchange_failed"));
  }

  const approvalUrl = signupApprovalUrl(requestUrl.origin, requestUrl.searchParams.get("next"));
  if (approvalUrl) {
    return NextResponse.redirect(approvalUrl);
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "user_failed"));
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, approval_status")
    .eq("id", userData.user.id)
    .maybeSingle<{ role: string; approval_status: string | null }>();

  if (profileError) {
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "profile_failed"));
  }

  if (!profile) {
    return NextResponse.redirect(new URL("/signup/role?auth=oauth", requestUrl.origin));
  }

  if (!isUserRole(profile.role)) {
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "invalid_role"));
  }

  if (profile.role !== "hq" && profile.approval_status !== "approved") {
    return NextResponse.redirect(new URL("/signup/approval-status", requestUrl.origin));
  }

  return NextResponse.redirect(new URL(ROLE_DESTINATIONS[profile.role], requestUrl.origin));
}
