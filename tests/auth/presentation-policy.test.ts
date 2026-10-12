import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import * as presentationPolicy from "../../lib/auth/presentation-policy.ts";
import { loadComponentModule } from "../support/component-harness.ts";
import { presentationAccess, readPresentationBody, readPresentationPolicy, reservePresentationOperation, validPresentationBody } from "../../lib/auth/presentation-policy.ts";

const staffId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const storeId = "33333333-3333-4333-8333-333333333333";
const policy = readPresentationPolicy({ PRESENTATION_MODE: "1", PRESENTATION_USER_IDS: `${staffId},${ownerId}`, PRESENTATION_STORE_ID: storeId, PRESENTATION_EXPIRES_AT: "2099-01-01T00:00:00Z" });

test("presentation mode is opt-in and preserves ordinary requests", () => {
  assert.equal(presentationAccess(readPresentationPolicy({}), "/api/stores/search", "GET", null), "allow");
});

test("invalid accounts and expired presentation configuration fail closed", () => {
  for (const env of [{}, { PRESENTATION_USER_IDS: staffId }, { PRESENTATION_USER_IDS: `${staffId},${staffId}` }]) {
    assert.equal(presentationAccess(readPresentationPolicy({ ...env, PRESENTATION_MODE: "1" }), "/", "GET", null), "unavailable");
  }
  assert.equal(presentationAccess(policy, "/staff", "GET", staffId, Date.parse("2100-01-01")), "unavailable");
});

test("only named accounts reach authenticated presentation routes", () => {
  assert.equal(presentationAccess(policy, "/staff", "GET", null), "unauthenticated");
  assert.equal(presentationAccess(policy, "/staff", "GET", "other-user"), "forbidden");
  assert.equal(presentationAccess(policy, "/staff", "GET", staffId), "allow");
  assert.equal(presentationAccess(policy, "/boss", "GET", ownerId), "allow");
});

test("email password entry is available but signup, Naver and store requests are excluded", () => {
  assert.equal(presentationAccess(policy, "/", "GET", null), "allow");
  assert.equal(presentationAccess(policy, "/api/auth/login", "POST", null), "allow");
  for (const pathname of ["/signup/stores", "/api/auth/signup", "/api/auth/oauth", "/api/auth/oauth-onboarding", "/auth/callback", "/api/stores/search", "/staff/stores/add", "/boss/stores/requests", "/api/signup/store-membership"]) {
    assert.equal(presentationAccess(policy, pathname, "GET", staffId), "forbidden");
  }
});

test("real chatbot and bounded text-manual workflow are not reduced to read-only", () => {
  assert.equal(presentationAccess(policy, "/api/staff/chat", "POST", staffId), "allow");
  assert.equal(presentationAccess(policy, "/api/store-manuals", "POST", ownerId), "allow");
  assert.equal(presentationAccess(policy, "/api/store-manuals/manual-id", "PATCH", ownerId), "allow");
  for (const pathname of ["/api/rag/query", "/api/rag/upload", "/api/store-manuals/batch-create", "/api/signup/store-membership", "/api/boss/employees/member-id"]) {
    assert.equal(presentationAccess(policy, pathname, "POST", ownerId), "forbidden");
  }
  assert.equal(presentationAccess(policy, "/api/store-manuals/manual-id", "DELETE", ownerId), "forbidden");
});

test("presentation payloads stay inside the synthetic store and text size", () => {
  assert.equal(validPresentationBody({ storeId, question: "Where is the test tray?" }, "chat", storeId), true);
  assert.equal(validPresentationBody({ storeId: ownerId, question: "test" }, "chat", storeId), false);
  assert.equal(validPresentationBody({ storeId, question: "x".repeat(501) }, "chat", storeId), false);
  assert.equal(validPresentationBody({ storeId, category: "PRESENTATION", items: ["Synthetic test instructions"] }, "manual", storeId), true);
  assert.equal(validPresentationBody({ storeId, category: "PRESENTATION", items: [{ title: "Test", content: "Synthetic test instructions" }] }, "manual", storeId), true);
  assert.equal(validPresentationBody({ storeId, category: "production", content: "test" }, "manual", storeId), false);
  assert.equal(validPresentationBody({ storeId, category: "PRESENTATION", items: ["one", "two"] }, "manual", storeId), false);
});

test("bounded body reader preserves the original request and rejects oversized JSON", async () => {
  const request = new Request("https://example.test/api/staff/chat", { method: "POST", body: JSON.stringify({ storeId, question: "test" }) });
  assert.deepEqual(await readPresentationBody(request), await request.json());
  await assert.rejects(readPresentationBody(new Request("https://example.test", { method: "POST", body: JSON.stringify({ content: "x".repeat(8001) }) })), /PRESENTATION_BODY_TOO_LARGE/);
});

test("only an authoritative successful quota reservation allows a paid operation", async () => {
  assert.equal(await reservePresentationOperation(async () => ({ data: true, error: null }), {}), "allow");
  assert.equal(await reservePresentationOperation(async () => ({ data: false, error: null }), {}), "limited");
  assert.equal(await reservePresentationOperation(async () => ({ data: null, error: null }), {}), "unavailable");
  assert.equal(await reservePresentationOperation(async () => ({ data: true, error: { code: "missing_rpc" } }), {}), "unavailable");
  assert.equal(await reservePresentationOperation(async () => { throw new Error("offline"); }, {}), "unavailable");
});

test("actual session middleware denies non-demo users and fails closed on quota errors", async () => {
  const names = ["PRESENTATION_MODE", "PRESENTATION_USER_IDS", "PRESENTATION_STORE_ID", "PRESENTATION_EXPIRES_AT", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  let userId = staffId;
  let quotaData: boolean | null = true;
  let quotaCalls = 0;
  try {
    Object.assign(process.env, { PRESENTATION_MODE: "1", PRESENTATION_USER_IDS: `${staffId},${ownerId}`, PRESENTATION_STORE_ID: storeId, PRESENTATION_EXPIRES_AT: "2099-01-01T00:00:00Z", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-test-key" });
    const { updateSession } = loadComponentModule<{ updateSession: (request: NextRequest) => Promise<NextResponse> }>("lib/supabase/middleware.ts", {
      "next/server": { NextResponse },
      "@supabase/ssr": { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) } }) },
      "@/lib/auth/presentation-policy": presentationPolicy,
      "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async () => { quotaCalls++; return { data: quotaData, error: null }; } }) },
      "@/lib/auth/session-expiration": { isSupabaseSessionInvalidationError: () => false },
      "@/lib/supabase/session-cookies": { SUPABASE_SESSION_COOKIE_OPTIONS: { name: "demo-session" }, SESSION_MODE_COOKIE: "demo-mode", isLegacySupabaseAuthCookie: () => false, isSupabaseSessionCookie: () => true },
      "@/lib/supabase/session-policy": { readSessionPolicy: () => ({ rememberMe: false }), clearSessionPolicyCookies: () => [], sessionPolicyCookieOptions: () => ({ path: "/" }), applySessionCookiePolicy: () => [] },
      "@/lib/auth/diagnostic-error-log": { createDiagnosticRequestId: () => "test-request", logDiagnosticError: () => undefined },
    }, { process, Headers });
    const request = () => new NextRequest("https://example.test/api/staff/chat", { method: "POST", headers: { cookie: "demo-session=test" }, body: JSON.stringify({ storeId, question: "Where is the test tray?" }) });
    assert.equal((await updateSession(request())).status, 200);
    assert.equal(quotaCalls, 1);
    quotaData = false;
    assert.equal((await updateSession(request())).status, 429);
    quotaData = null;
    assert.equal((await updateSession(request())).status, 503);
    userId = "other-user";
    const callsBeforeDenied = quotaCalls;
    assert.equal((await updateSession(request())).status, 403);
    assert.equal(quotaCalls, callsBeforeDenied);
    assert.equal((await updateSession(new NextRequest("https://example.test/api/stores/search?q=test"))).status, 403);
    assert.equal((await updateSession(new NextRequest("https://example.test/api/staff/chat", { method: "POST", body: "{}" }))).status, 401);
  } finally {
    for (const name of names) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; }
  }
});

test("demo-only SQL draft keeps quota reservation atomic and inaccessible to public clients", () => {
  const sql = readFileSync(new URL("../../docs/sql/presentation-quota.demo-only.draft.sql", import.meta.url), "utf8");
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE[\s\S]*TO service_role/);
  assert.match(sql, /quota\.chat_count >= 20/);
  assert.match(sql, /quota\.manual_count >= 2/);
  assert.match(sql, /category = 'PRESENTATION'/);
  assert.match(sql, /INTERVAL '10 seconds'/);
});