import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { OAUTH_POLICY_COOKIE } from "@/lib/supabase/session-cookies";
import { sessionPolicyCookieOptions, signSessionPolicy } from "@/lib/supabase/session-policy";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";

export const runtime = "nodejs";

const PROVIDERS = ["google", "apple", "kakao", "custom:naver"] as const;

export async function POST(request: Request): Promise<NextResponse> {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  }
  let body: { provider?: unknown; rememberMe?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    body = parsed;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const provider = PROVIDERS.find((candidate) => candidate === body.provider);
  if (!provider || typeof body.rememberMe !== "boolean") {
    return NextResponse.json({ error: "Invalid OAuth request." }, { status: 400 });
  }
  try {
    const supabase = await createClient({ rememberMe: false });
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider, options: { redirectTo: `${origin}/auth/callback`, skipBrowserRedirect: true },
    });
    if (error || !data.url) {
      logSafeAuthError("OAUTH_START_FAILED", error);
      return NextResponse.json({ error: "OAuth login failed.", code: "OAUTH_START_FAILED", stage: "start", provider }, { status: 503 });
    }
    const authorize = new URL(data.url);
    const expected = new URL(`${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")}/auth/v1/authorize`);
    if (authorize.origin !== expected.origin || authorize.pathname !== expected.pathname || authorize.username || authorize.password ||
        authorize.searchParams.get("provider") !== provider || authorize.searchParams.get("redirect_to") !== `${origin}/auth/callback`) {
      return NextResponse.json({ error: "Invalid OAuth redirect.", code: "OAUTH_REDIRECT_INVALID", stage: "start", provider }, { status: 502 });
    }
    const cookieStore = await cookies();
    cookieStore.set(OAUTH_POLICY_COOKIE, signSessionPolicy("oauth", "", body.rememberMe), sessionPolicyCookieOptions(false));
    return NextResponse.json({ url: data.url }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logSafeAuthError("OAUTH_START_FAILED", error);
    return NextResponse.json({ error: "OAuth login failed.", code: "OAUTH_START_FAILED", stage: "start", provider }, { status: 503 });
  }
}