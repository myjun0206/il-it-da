import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSupabaseSessionCookie, OAUTH_POLICY_COOKIE, PERSISTENT_SESSION_MAX_AGE } from "@/lib/supabase/session-cookies";
import { applySessionCookiePolicy, clearSessionPolicyCookies, readSessionPolicy, sessionPolicyCookieOptions } from "@/lib/supabase/session-policy";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getStoreMembershipAccess } from "@/lib/auth/store-membership-access";
import { clearDeletedAccountCookies, deleteIncompleteStoreSignupAccount } from "@/lib/auth/incomplete-store-signup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: Request): Promise<NextResponse> {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  }
  const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "private, no-store" } });
  clearSessionPolicyCookies().forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  response.cookies.set(OAUTH_POLICY_COOKIE, "", { ...sessionPolicyCookieOptions(false), maxAge: 0 });
  return response;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  }
  const cookieStore = await cookies();
  const policy = readSessionPolicy(cookieStore.getAll());
  const supabase = await createClient({ rememberMe: policy?.rememberMe ?? false, acceptSession: true });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const current = cookieStore.getAll();
  const authCookies = current.filter(({ name }) => isSupabaseSessionCookie(name))
    .map((cookie) => ({ ...cookie, options: { path: "/", sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: PERSISTENT_SESSION_MAX_AGE } }));
  const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "private, no-store" } });
  applySessionCookiePolicy(current, authCookies, policy?.rememberMe ?? false)
    .forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  const cookieStore = await cookies();
  const requestUrl = new URL(request.url);

  if (requestUrl.searchParams.get("accountDeleted") === "1") {
    const response = NextResponse.redirect(new URL("/signup/start?notice=signup-cancelled", requestUrl.origin));
    return clearDeletedAccountCookies(response, cookieStore.getAll().map(({ name }) => name));
  }

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    const response = NextResponse.json({ authenticated: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return requestUrl.searchParams.get("checkIncompleteSignup") === "1"
      ? clearDeletedAccountCookies(response, cookieStore.getAll().map(({ name }) => name))
      : response;
  }

  const adminClient = createAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role, approval_status, full_name, email, phone")
    .eq("id", user.id)
    .maybeSingle<{ role: string; approval_status: string | null; full_name: string | null; email: string | null; phone: string | null }>();

  if (profileError) {
    return NextResponse.json({ error: "사용자 역할 정보를 확인할 수 없습니다." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  if (requestUrl.searchParams.get("checkIncompleteSignup") === "1") {
    const role = profile?.role ?? user.user_metadata?.role;
    const cleanup = await deleteIncompleteStoreSignupAccount(adminClient, user.id, role);
    if (cleanup.status === "DELETED") {
      const response = NextResponse.json(
        {
          authenticated: false,
          code: "SIGNUP_CANCELLED",
          redirectTo: "/signup/start?notice=signup-cancelled",
          error: "매장 신청이 완료되지 않아 가입이 취소되었습니다. 다시 회원가입을 진행해주세요.",
        },
        { status: 410, headers: { "Cache-Control": "no-store" } },
      );
      return clearDeletedAccountCookies(response, cookieStore.getAll().map(({ name }) => name));
    }
    if (cleanup.status === "ERROR") {
      return NextResponse.json({ error: "미완료 가입 계정을 정리하지 못했습니다." }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
  }

  if (!profile?.role) {
    return NextResponse.json({ authenticated: true, userId: user.id, role: null }, { status: 200 });
  }

  const membershipAccess = profile.role === "owner" || profile.role === "staff"
    ? await getStoreMembershipAccess(adminClient, user.id)
    : "ACTIVE";
  if (membershipAccess === "ERROR") {
    return NextResponse.json({ error: "매장 소속 정보를 확인할 수 없습니다." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    {
      authenticated: true,
      userId: user.id,
      role: profile.role,
      email: profile.email ?? user.email ?? "",
      name: profile.full_name ?? (typeof user.user_metadata?.name === "string" ? user.user_metadata.name : ""),
      phone: profile.phone ?? (typeof user.user_metadata?.phone === "string" ? user.user_metadata.phone : ""),
      needsStoreMembership: membershipAccess === "UNLINKED",
      approvalStatus: profile.approval_status === "approved" || profile.approval_status === "rejected"
        ? profile.approval_status
        : "pending",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}