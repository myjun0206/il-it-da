import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { OAUTH_POLICY_COOKIE } from "@/lib/supabase/session-cookies";
import { sessionPolicyCookieOptions, signSessionPolicy } from "@/lib/supabase/session-policy";

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
  const supabase = await createClient({ rememberMe: false });
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider, options: { redirectTo: `${origin}/auth/callback`, skipBrowserRedirect: true },
  });
  if (error || !data.url) return NextResponse.json({ error: "OAuth login failed." }, { status: 400 });
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_POLICY_COOKIE, signSessionPolicy("oauth", "", body.rememberMe), sessionPolicyCookieOptions(false));
  return NextResponse.json({ url: data.url }, { headers: { "Cache-Control": "private, no-store" } });
}