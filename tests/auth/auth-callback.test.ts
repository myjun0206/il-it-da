import { loadComponentModule } from "../support/component-harness.ts";
test("all four OAuth starts constrain redirect URLs and safely classify initiation failures", async () => {
  let fail = false;
  let untrusted = false;
  const route = loadComponentModule<{ POST: (request: Request) => Promise<Response> }>("app/api/auth/oauth/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "next/headers": { cookies: async () => ({ set: () => undefined }) },
    "@/lib/supabase/session-policy": { signSessionPolicy: () => "synthetic-policy", sessionPolicyCookieOptions: () => ({}) },
    "@/lib/auth/safe-auth-log": { logSafeAuthError: () => undefined },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { signInWithOAuth: async ({ provider, options }: { provider: string; options: { redirectTo: string } }) => {
      assert.deepEqual(Object.keys(options).sort(), ["redirectTo", "skipBrowserRedirect"]);
      if (fail) throw new Error("private provider detail");
      const url = new URL(untrusted ? "https://untrusted.example/auth/v1/authorize" : "https://synthetic.supabase.co/auth/v1/authorize");
      url.searchParams.set("provider", provider);
      url.searchParams.set("redirect_to", options.redirectTo);
      return { data: { url: url.toString() }, error: null };
    } } }) },
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co" } } });
  const request = (provider: string) => new Request("http://localhost:3000/api/auth/oauth", { method: "POST", headers: { origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify({ provider, rememberMe: false, scopes: "friends", queryParams: { scope: "friends" } }) });
  for (const provider of ["google", "custom:naver", "kakao", "apple"]) assert.equal((await route.POST(request(provider))).status, 200);
  untrusted = true;
  assert.equal((await route.POST(request("google"))).status, 502);
  fail = true;
  const result = await route.POST(request("custom:naver"));
  assert.equal(result.status, 503);
  assert.equal((await result.json()).code, "OAUTH_START_FAILED");
});
test("social callback uses verified identity, preserves approval and cannot auto-submit metadata stores", async () => {
  let profile: { role: string; approval_status: string } | null = null;
  let authenticated = true;
  let adminReads = 0;
  let exchanges = 0;
  let cookieClears = 0;
  const query = { select: () => query, eq: (_key: string, value: string) => { assert.equal(value, "verified-social-id"); return query; }, maybeSingle: async () => { adminReads++; return { data: profile, error: null }; } };
  const route = loadComponentModule<{ GET: (request: Request) => Promise<Response> }>("app/auth/callback/route.ts", {
    "next/server": { NextResponse: { redirect: (url: URL) => Response.redirect(url) } },
    "next/headers": { cookies: async () => ({ get: () => undefined, set: () => { cookieClears++; } }) },
    "@/lib/supabase/session-policy": { verifySessionPolicy: () => null, sessionPolicyCookieOptions: () => ({}) },
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      exchangeCodeForSession: async () => { exchanges++; return { error: null }; },
      getUser: async () => ({ data: { user: authenticated ? { id: "verified-social-id", identities: [{ provider: "apple" }], user_metadata: { role: "owner", pendingStores: [{ storeName: "Forged" }] } } : null }, error: null }),
    } }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => query }) },
    "@/lib/signup/store-membership-service": { upsertSignupProfile: () => { throw new Error("must not write"); }, submitStoreMembershipRequest: () => { throw new Error("must not write"); } },
  }, { process: { env: { NEXT_PUBLIC_SIGNUP_EMAIL_OTP_LENGTH: "6" } } });
  const callback = async (search: string) => new URL((await route.GET(new Request(`http://localhost:3000/auth/callback${search}`))).headers.get("location")!);
  assert.equal((await callback("?code=synthetic&next=/signup/approval")).pathname, "/signup/role");
  profile = { role: "owner", approval_status: "pending" };
  assert.equal((await callback("?code=synthetic&next=/signup/stores")).pathname, "/signup/approval-status");
  profile.approval_status = "approved";
  assert.equal((await callback("?code=synthetic")).pathname, "/boss");
  authenticated = false;
  assert.equal((await callback("?code=synthetic")).searchParams.get("oauthError"), "user_failed");
  assert.equal(adminReads, 3);
  assert.equal((await callback("?error=access_denied&error_description=private-value")).searchParams.get("oauthError"), "cancelled");
  assert.equal(exchanges, 4);
  assert.equal(cookieClears, 5);
});
test("new social onboarding validates required fields/terms before writes and preserves existing users", async () => {
  let existing: { role: string } | null = null;
  const writes: unknown[] = [];
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: existing, error: null }), insert: async (row: unknown) => { writes.push(row); return { error: null }; } };
  const route = loadComponentModule<{ POST: (request: Request) => Promise<Response> }>("app/api/auth/oauth-onboarding/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      getUser: async () => ({ data: { user: { id: "social-user", identities: [{ provider: "google" }], app_metadata: { provider: "google" } } }, error: null }),
      updateUser: async (input: unknown) => { writes.push(input); return { error: null }; },
    } }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => query }) },
    "@/lib/auth/owner-staff-signup-server": { isSameOriginRequest: (request: Request) => request.headers.get("origin") === new URL(request.url).origin },
  }, { process: { env: { NEXT_PUBLIC_SIGNUP_EMAIL_OTP_LENGTH: "6" } } });
  const request = (body: unknown) => new Request("http://localhost:3000/api/auth/oauth-onboarding", { method: "POST", headers: { origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await route.POST(request(null))).status, 400);
  assert.equal((await route.POST(request({ role: "owner", name: "Person", phone: "01012345678" }))).status, 400);
  assert.equal(writes.length, 0);
  assert.equal((await route.POST(request({ role: "owner", name: "Person", phone: "12", terms: { service: true, privacy: true, store_connection: true } }))).status, 400);
  assert.equal(writes.length, 0);
  assert.equal((await route.POST(request({ role: "owner", name: " Person ", phone: "010-1234-5678", terms: { service: true, privacy: true, store_connection: true }, researchConsent: false }))).status, 201);
  assert.equal(writes.length, 2);
  assert.equal((writes[1] as { approval_status: string }).approval_status, "pending");
  existing = { role: "owner" };
  assert.equal((await route.POST(request({ role: "owner" }))).status, 200);
  assert.equal(writes.length, 2);
  assert.equal((await route.POST(request({ role: "staff" }))).status, 409);
});
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildAuthCallbackUrl,
  getCorrectedAuthCallbackUrl,
  getSafeAuthNextPath,
} from "../../lib/auth/auth-callback.ts";

describe("auth callback URLs", () => {
  test("builds signup redirects through the server callback", () => {
    const result = new URL(buildAuthCallbackUrl("https://example.com", "/signup/stores"));

    assert.equal(result.origin, "https://example.com");
    assert.equal(result.pathname, "/auth/callback");
    assert.equal(result.searchParams.get("next"), "/signup/stores");
  });

  test("rejects external and unknown next destinations", () => {
    assert.equal(getSafeAuthNextPath("https://evil.example/path"), "/signup/complete");
    assert.equal(getSafeAuthNextPath("/admin"), "/signup/complete");
  });

  test("preserves approval flow destinations", () => {
    assert.equal(getSafeAuthNextPath("/signup/profile?auth=email"), "/signup/profile?auth=email");
    assert.equal(getSafeAuthNextPath("/signup/approval"), "/signup/approval");
    assert.equal(getSafeAuthNextPath("/signup/approval-status"), "/signup/approval-status");
  });

  test("moves a code received on a signup page back through the callback", () => {
    const result = getCorrectedAuthCallbackUrl(
      new URL("https://example.com/signup/stores?code=pkce-code&mode=add"),
    );

    assert.ok(result);
    assert.equal(result.pathname, "/auth/callback");
    assert.equal(result.searchParams.get("code"), "pkce-code");
    assert.equal(result.searchParams.get("next"), "/signup/stores?mode=add");
  });

  test("does not redirect ordinary signup page requests", () => {
    assert.equal(
      getCorrectedAuthCallbackUrl(new URL("https://example.com/signup/profile")),
      null,
    );
  });
});