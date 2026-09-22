import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/user";

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

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "missing_code"));
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    console.error("[AUTH_OAUTH_CALLBACK] Code exchange failed:", exchangeError.message);
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "exchange_failed"));
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    console.error("[AUTH_OAUTH_CALLBACK] User verification failed:", userError?.message);
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "user_failed"));
  }

  if (!userData.user.email) {
    await supabase.auth.signOut();
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "missing_email"));
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle<{ role: string }>();

  if (profileError) {
    console.error("[AUTH_OAUTH_CALLBACK] Profile lookup failed:", profileError.message);
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "profile_failed"));
  }

  if (!profile) {
    return NextResponse.redirect(new URL("/signup/role?auth=oauth", requestUrl.origin));
  }

  if (profile.role !== "hq" && profile.role !== "owner" && profile.role !== "staff") {
    console.error("[AUTH_OAUTH_CALLBACK] Invalid profile role for user:", userData.user.id);
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "invalid_role"));
  }

  return NextResponse.redirect(new URL(ROLE_DESTINATIONS[profile.role], requestUrl.origin));
}