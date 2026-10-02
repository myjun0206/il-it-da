import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createChunks, createServerClient } from "@supabase/ssr";
import {
  applySessionCookiePolicy,
  clearSessionPolicyCookies,
  readSessionPolicy,
  sessionIdFromCookies,
  signSessionPolicy,
  verifySessionPolicy,
} from "../../lib/supabase/session-policy.ts";
import {
  OAUTH_POLICY_COOKIE,
  PERSISTENT_SESSION_MAX_AGE,
  SESSION_MODE_COOKIE,
  SESSION_POLICY_COOKIE,
  SUPABASE_SESSION_COOKIE_OPTIONS,
} from "../../lib/supabase/session-cookies.ts";

process.env.AUTH_SESSION_POLICY_SECRET = "test-only-session-policy-secret";

function authCookies(sessionId = "session-1", padding = "", lifetime = 3600) {
  const claims = Buffer.from(JSON.stringify({ session_id: sessionId, exp: Math.floor(Date.now() / 1000) + lifetime })).toString("base64url");
  const session = { access_token: `header.${claims}.signature`, refresh_token: "refresh", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + lifetime, user: { id: "user-1", padding } };
  return createChunks(SUPABASE_SESSION_COOKIE_OPTIONS.name, `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`);
}

function sessionWrites(rememberMe: boolean, sessionId = "session-1", padding = "") {
  return applySessionCookiePolicy([], authCookies(sessionId, padding).map((cookie) => ({
    ...cookie, options: { path: "/", maxAge: PERSISTENT_SESSION_MAX_AGE },
  })), rememberMe);
}

describe("server-trusted remember-me policy", () => {
  for (const rememberMe of [false, true]) {
    test(`login, refresh, and simulated browser close with rememberMe=${rememberMe}`, () => {
      const writes = sessionWrites(rememberMe);
      const policy = readSessionPolicy(writes);
      assert.equal(policy?.rememberMe, rememberMe);
      const guard = writes.find(({ name }) => name === SESSION_POLICY_COOKIE)!;
      assert.equal(guard.options.httpOnly, true);
      for (const cookie of writes) {
        assert.equal(cookie.options.maxAge, rememberMe ? PERSISTENT_SESSION_MAX_AGE : undefined);
        assert.equal(cookie.options.expires, undefined);
      }
      const refreshed = applySessionCookiePolicy(writes, authCookies().map((cookie) => ({
        ...cookie, options: { maxAge: PERSISTENT_SESSION_MAX_AGE },
      })), policy!.rememberMe);
      assert.equal(readSessionPolicy(refreshed)?.rememberMe, rememberMe);
      const afterClose = refreshed.filter(({ options }) => options.maxAge && options.maxAge > 0);
      assert.equal(Boolean(readSessionPolicy(afterClose)), rememberMe);
      assert.equal(readSessionPolicy(writes)?.sessionId, "session-1");
    });
  }

  test("readable mode manipulation cannot promote the signed policy", () => {
    const cookies = sessionWrites(false).map((cookie) => cookie.name === SESSION_MODE_COOKIE ? { ...cookie, value: "persistent" } : cookie);
    assert.equal(readSessionPolicy(cookies)?.rememberMe, false);
    assert.equal(readSessionPolicy(cookies.filter(({ name }) => name !== SESSION_POLICY_COOKIE)), null);
  });

  test("rejects tampering, malformed signatures, expiry, and wrong-purpose policies", () => {
    const signed = signSessionPolicy("session", "session-1", false, 1000);
    const [payload, signature] = signed.split(".");
    const forged = Buffer.from(JSON.stringify({ purpose: "session", sessionId: "session-1", rememberMe: true, expiresAt: 9999999999999 })).toString("base64url");
    assert.equal(verifySessionPolicy(`${forged}.${signature}`, "session", 1001), null);
    assert.equal(verifySessionPolicy(`${payload}.bad`, "session", 1001), null);
    assert.equal(verifySessionPolicy(signed, "session", 1000 + PERSISTENT_SESSION_MAX_AGE * 1000), null);
    assert.equal(verifySessionPolicy(signed, "oauth", 1001), null);
    assert.equal(verifySessionPolicy(undefined, "session"), null);
  });

  test("cannot reuse a persistent policy on a different Supabase session", () => {
    const policy = sessionWrites(true).filter(({ name }) => name === SESSION_POLICY_COOKIE);
    assert.equal(readSessionPolicy([...authCookies("session-2"), ...policy]), null);
  });

  test("large sessions and chunk replacement preserve policy; logout deletes it", () => {
    const large = sessionWrites(false, "session-1", "padding".repeat(2000));
    assert.equal(sessionIdFromCookies(large), "session-1");
    const changed = applySessionCookiePolicy(large, [
      ...large.filter(({ name }) => name.startsWith(`${SUPABASE_SESSION_COOKIE_OPTIONS.name}.`)).map(({ name }) => ({ name, value: "", options: { maxAge: 0 } })),
      ...authCookies().map((cookie) => ({ ...cookie, options: { maxAge: PERSISTENT_SESSION_MAX_AGE } })),
    ], false);
    assert.equal(readSessionPolicy(changed)?.rememberMe, false);
    const logout = applySessionCookiePolicy(changed, [{ name: SUPABASE_SESSION_COOKIE_OPTIONS.name, value: "", options: { maxAge: 0 } }], false);
    assert.equal(readSessionPolicy(logout), null);
    assert.ok(logout.every(({ options }) => options.maxAge === 0));
    assert.ok(clearSessionPolicyCookies().every(({ name }) => name !== OAUTH_POLICY_COOKIE));
  });

  test("OAuth preference is signed, short-lived, and never valid as a session guard", () => {
    for (const rememberMe of [false, true]) {
      const signed = signSessionPolicy("oauth", "", rememberMe, 1000);
      assert.equal(verifySessionPolicy(signed, "oauth", 1001)?.rememberMe, rememberMe);
      assert.equal(verifySessionPolicy(signed, "oauth", 601000), null);
      assert.equal(verifySessionPolicy(signed, "session", 1001), null);
    }
  });

  test("installed SSR SDK applies the policy to real signInWithPassword cookie writes", async () => {
    for (const rememberMe of [false, true]) {
      let cookies: ReturnType<typeof sessionWrites> = [];
      const claims = Buffer.from(JSON.stringify({ session_id: "sdk-session", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
      const client = createServerClient("https://test.supabase.co", "anon-test-key", {
        cookieOptions: SUPABASE_SESSION_COOKIE_OPTIONS,
        global: { fetch: async () => new Response(JSON.stringify({
          access_token: `header.${claims}.signature`, refresh_token: "sdk-refresh", token_type: "bearer", expires_in: 3600,
          user: { id: "user-1", email: "test@example.com" },
        }), { headers: { "Content-Type": "application/json" } }) },
        cookies: { getAll: () => cookies, setAll: (incoming) => { cookies = applySessionCookiePolicy(cookies, incoming, rememberMe); } },
      });
      const { error } = await client.auth.signInWithPassword({ email: "test@example.com", password: "password" });
      assert.equal(error, null);
      assert.equal(readSessionPolicy(cookies)?.sessionId, "sdk-session");
      assert.equal(readSessionPolicy(cookies)?.rememberMe, rememberMe);
      await client.auth.signOut({ scope: "local" });
      assert.equal(readSessionPolicy(cookies), null);
    }
  });
});

describe("Proxy session persistence enforcement", () => {
  test("removes orphaned auth cookies from both the response and forwarded request", async () => {
    const { NextRequest } = await import("next/server");
    const { updateSession } = await import("../../lib/supabase/middleware.ts");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
    const cookies = [...authCookies(), { name: SESSION_MODE_COOKIE, value: "persistent" }];
    const request = new NextRequest("https://app.example.com/boss", {
      headers: { cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; ") },
    });
    const response = await updateSession(request);
    assert.equal(request.cookies.has(SUPABASE_SESSION_COOKIE_OPTIONS.name), false);
    assert.equal(response.cookies.get(SUPABASE_SESSION_COOKIE_OPTIONS.name)?.maxAge, 0);
    assert.equal(response.cookies.get(SESSION_POLICY_COOKIE)?.maxAge, 0);
    assert.doesNotMatch(response.headers.get("x-middleware-request-cookie") ?? "", /il-it-da-auth-session/);
  });

  test("normalizes a forged readable mode without changing the signed unchecked policy", async (context) => {
    const { NextRequest } = await import("next/server");
    const { updateSession } = await import("../../lib/supabase/middleware.ts");
    context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ id: "user-1" }), { headers: { "Content-Type": "application/json" } }));
    const cookies = sessionWrites(false).map((cookie) => cookie.name === SESSION_MODE_COOKIE ? { ...cookie, value: "persistent" } : cookie);
    const request = new NextRequest("https://app.example.com/staff", {
      headers: { cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; ") },
    });
    const response = await updateSession(request);
    assert.equal(response.cookies.get(SESSION_MODE_COOKIE)?.value, "session");
    assert.equal(response.cookies.get(SESSION_MODE_COOKIE)?.maxAge, undefined);
    assert.equal(request.cookies.has(SUPABASE_SESSION_COOKIE_OPTIONS.name), true);
    assert.equal(readSessionPolicy(request.cookies.getAll())?.rememberMe, false);
  });

  test("refreshes expired tokens using the original checked or unchecked cookie lifetime", async (context) => {
    const { NextRequest } = await import("next/server");
    const { updateSession } = await import("../../lib/supabase/middleware.ts");
    const claims = Buffer.from(JSON.stringify({ session_id: "session-1", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
    context.mock.method(globalThis, "fetch", async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes("/token") ? {
      access_token: `header.${claims}.signature`, refresh_token: "refreshed", token_type: "bearer", expires_in: 3600, user: { id: "user-1" },
    } : { id: "user-1" }), { headers: { "Content-Type": "application/json" } }));
    for (const rememberMe of [false, true]) {
      const cookies = [...authCookies("session-1", "", -60), ...sessionWrites(rememberMe).filter(({ name }) => name === SESSION_POLICY_COOKIE || name === SESSION_MODE_COOKIE)];
      const request = new NextRequest("https://app.example.com/hq", {
        headers: { cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; ") },
      });
      const response = await updateSession(request);
      assert.equal(readSessionPolicy(response.cookies.getAll())?.rememberMe, rememberMe);
      assert.equal(response.cookies.get(SUPABASE_SESSION_COOKIE_OPTIONS.name)?.maxAge, rememberMe ? PERSISTENT_SESSION_MAX_AGE : undefined);
      assert.equal(response.cookies.get(SESSION_POLICY_COOKIE)?.httpOnly, true);
      assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
    }
  });

  test("does not delete the signed OAuth preference before its callback", async () => {
    const { NextRequest } = await import("next/server");
    const { updateSession } = await import("../../lib/supabase/middleware.ts");
    const request = new NextRequest("https://app.example.com/auth/callback?code=test", {
      headers: { cookie: `${OAUTH_POLICY_COOKIE}=${signSessionPolicy("oauth", "", true)}` },
    });
    const response = await updateSession(request);
    assert.equal(response.cookies.has(OAUTH_POLICY_COOKIE), false);
    assert.equal(verifySessionPolicy(request.cookies.get(OAUTH_POLICY_COOKIE)?.value, "oauth")?.rememberMe, true);
  });
});