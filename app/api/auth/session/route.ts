import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSupabaseSessionCookie, OAUTH_POLICY_COOKIE, PERSISTENT_SESSION_MAX_AGE } from "@/lib/supabase/session-cookies";
import { applySessionCookiePolicy, clearSessionPolicyCookies, readSessionPolicy, sessionPolicyCookieOptions } from "@/lib/supabase/session-policy";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role, approval_status")
    .eq("id", user.id)
    .maybeSingle<{ role: string; approval_status: string | null }>();

  if (profileError || !profile?.role) {
    return NextResponse.json({ authenticated: true, userId: user.id, role: null }, { status: 200 });
  }

  return NextResponse.json(
    {
      authenticated: true,
      userId: user.id,
      role: profile.role,
      approvalStatus: profile.approval_status === "approved" || profile.approval_status === "rejected"
        ? profile.approval_status
        : "pending",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}