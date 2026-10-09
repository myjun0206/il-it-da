import assert from "node:assert/strict";
import { test } from "node:test";
import { sendEmailFirstOtp, verifyEmailFirstOtp, completeEmailFirstSignup, type EmailFirstState } from "../../lib/auth/email-first-signup.ts";
import { normalizeSignupPhone } from "../../lib/auth/owner-staff-signup.ts";
import { loadComponentModule } from "../support/component-harness.ts";
import { incompleteSignupGraceHours, previewIncompleteSignupCleanup, type IncompleteSignupSnapshot } from "../../lib/auth/incomplete-signup-cleanup.ts";

const settings = async () => ({ emailEnabled: true, autoconfirm: false, signupDisabled: false });
const user = { id: "user-1", email: "person@example.org", email_confirmed_at: "2026-10-07", app_metadata: { provider: "email" }, user_metadata: { role: "owner" } };
const pending: EmailFirstState = { kind: "resume", userId: user.id, expiresAt: 181000, requestId: "reservation-1" };

test("email alone sends passwordless OTP without fabricated credentials", async () => {
  const requests: unknown[] = [];
  const result = await sendEmailFirstOtp({ email: "person@example.org", role: "owner" }, {
    action: "start", getSettings: settings, now: () => 1000,
    prepare: async (_email, _role, action) => ({ kind: "new", expiresAt: action === "start" ? 1000 : 181000, requestId: "reservation-1" }),
    auth: { signInWithOtp: async (input) => { requests.push(input); return { error: null }; } },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(requests, [{ email: "person@example.org", options: { shouldCreateUser: true, data: { role: "owner", signup_flow: "email_first" } } }]);
});
test("existing accounts are refused before a passwordless login mail", async () => {
  const result = await sendEmailFirstOtp({ email: user.email, role: "owner" }, {
    action: "start", getSettings: settings, prepare: async () => ({ kind: "exists" }),
    auth: { signInWithOtp: async () => assert.fail("Must not send") },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "EMAIL_EXISTS");
});
test("expired server deadline refuses verification before provider access", async () => {
  const result = await verifyEmailFirstOtp({ email: user.email, role: "owner", token: "012345" }, {
    getSettings: settings, prepare: async () => pending, now: () => 181000,
    auth: { verifyOtp: async () => assert.fail("Expired code must not reach provider"), getUser: async () => assert.fail("Expired code"), signOut: async () => {} },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "CODE_EXPIRED");
    assert.equal(result.error, "인증 시간이 만료되었습니다. 새 인증번호를 받아주세요.");
  }
});
test("final password and terms require verified identity before any mutation", async () => {
  const result = await completeEmailFirstSignup({ email: user.email, role: "owner", name: "Person", phone: "01012345678", password: "password-1", passwordConfirm: "password-1", terms: { service: true, privacy: true, store_connection: true } }, null, {
    getSettings: settings, prepare: async () => assert.fail("Unverified session"), auth: { updateUser: async () => assert.fail("No password write") },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "VERIFICATION_REJECTED");
});

test("unfinished signup resends without account creation or role/metadata updates", async () => {
  const requests: unknown[] = [];
  const result = await sendEmailFirstOtp({ email: user.email, role: "owner" }, {
    action: "start", getSettings: settings, prepare: async () => pending, now: () => 1000,
    auth: { signInWithOtp: async (input) => { requests.push(input); return { error: null }; } },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(requests, [{ email: user.email, options: { shouldCreateUser: false } }]);
});

for (const token of ["12345", "1234567", "abcdef", 123456]) {
  test(`malformed token ${String(token)} never calls verification provider`, async () => {
    const result = await verifyEmailFirstOtp({ email: user.email, role: "owner", token }, {
      getSettings: settings, prepare: async () => assert.fail("Invalid input must not query"),
      auth: { verifyOtp: async () => assert.fail("Invalid input"), getUser: async () => assert.fail("Invalid input"), signOut: async () => {} },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CODE_INVALID");
  });
}

test("provider invalid and expired OTP errors remain distinct", async () => {
  for (const [providerError, expectedCode] of [[{ code: "invalid" }, "CODE_INVALID"], [{ code: "otp_expired", message: "OTP expired" }, "CODE_EXPIRED"]]) {
    const result = await verifyEmailFirstOtp({ email: user.email, role: "owner", token: "012345" }, {
      getSettings: settings, prepare: async () => pending, now: () => 1000,
      auth: { verifyOtp: async () => ({ data: { user: null, session: null }, error: providerError }), getUser: async () => assert.fail("Provider rejected OTP"), signOut: async () => {} },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, expectedCode);
  }
});

test("successful OTP preserves leading zero and records the exact authenticated user", async () => {
  const actions: string[] = [];
  const result = await verifyEmailFirstOtp({ email: user.email, role: "owner", token: "012345" }, {
    getSettings: settings, now: () => 1000,
    prepare: async (_email, _role, action, userId, requestId) => {
      actions.push(action);
      if (action === "verify") { assert.equal(userId, user.id); assert.equal(requestId, pending.requestId); return { ...pending, emailVerified: true }; }
      return pending;
    },
    auth: {
      verifyOtp: async (input) => { assert.equal(input.token, "012345"); return { data: { user, session: { user, access_token: "synthetic-new-token" } }, error: null }; },
      getUser: async (jwt) => { assert.equal(jwt, "synthetic-new-token"); return { data: { user }, error: null }; },
      signOut: async () => assert.fail("Valid verification"),
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(actions, ["inspect", "verify"]);
});

test("SDK-only confirmed session without server verified record cannot set password", async () => {
  const result = await completeEmailFirstSignup({ email: user.email, role: "owner", name: "Person", phone: "01012345678", password: "password-1", passwordConfirm: "password-1", terms: { service: true, privacy: true, store_connection: true } }, user, {
    getSettings: settings, prepare: async () => pending,
    auth: { updateUser: async () => assert.fail("Unrecorded verification must not update") },
  });
  assert.equal(result.ok, false);
});

test("verified final signup sets password and profile metadata but never changes role", async () => {
  const writes: unknown[] = [];
  const actions: string[] = [];
  const result = await completeEmailFirstSignup({ email: user.email, role: "owner", name: " Person ", phone: "01012345678", password: "password-1", passwordConfirm: "password-1", terms: { service: true, privacy: true, store_connection: true } }, user, {
    getSettings: settings, prepare: async (_email, _role, action, userId, requestId) => {
      actions.push(action);
      if (action === "complete") { assert.equal(userId, user.id); assert.equal(requestId, pending.requestId); return { kind: "complete", userId }; }
      return { ...pending, emailVerified: true };
    },
    auth: { updateUser: async (input) => { writes.push(input); assert.equal(Object.hasOwn(input.data, "role"), false); assert.equal(input.data.name, "Person"); assert.equal(input.data.phone, "01012345678"); return { error: null }; } },
  });
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(actions, ["inspect", "complete"]);
});

for (const override of [{ name: " " }, { phone: "12" }, { password: "short" }, { passwordConfirm: "different" }, { terms: {} }]) {
  test(`final ${Object.keys(override)[0]} validation rejects before password write`, async () => {
    const result = await completeEmailFirstSignup({ email: user.email, role: "owner", name: "Person", phone: "01012345678", password: "password-1", passwordConfirm: "password-1", terms: { service: true, privacy: true, store_connection: true }, ...override }, user, {
      getSettings: settings, prepare: async () => assert.fail("Invalid final information"), auth: { updateUser: async () => assert.fail("No invalid write") },
    });
    assert.equal(result.ok, false);
  });
}

test("old confirmation without verifyOtp session never marks the current request verified", async () => {
  let cleared = 0;
  const actions: string[] = [];
  const result = await verifyEmailFirstOtp({ email: user.email, role: "owner", token: "012345" }, {
    getSettings: settings, now: () => 1000, prepare: async (_email, _role, action) => { actions.push(action); return pending; },
    auth: {
      verifyOtp: async () => ({ data: { user, session: null }, error: null }),
      getUser: async () => assert.fail("No fresh token"),
      signOut: async () => { cleared++; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(cleared, 1);
  assert.deepEqual(actions, ["inspect"]);
});

test("fresh JWT validation failure cannot reuse the previous signed-in identity", async () => {
  const actions: string[] = [];
  const result = await verifyEmailFirstOtp({ email: user.email, role: "owner", token: "012345" }, {
    getSettings: settings, now: () => 1000, prepare: async (_email, _role, action) => { actions.push(action); return pending; },
    auth: {
      verifyOtp: async () => ({ data: { user, session: { user, access_token: "synthetic-new-token" } }, error: null }),
      getUser: async (jwt) => { assert.equal(jwt, "synthetic-new-token"); return { data: { user: null }, error: { code: "bad_jwt" } }; },
      signOut: async () => {},
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(actions, ["inspect"]);
});

test("resend during provider verification refuses the stale request and clears its session", async () => {
  let cleared = 0;
  const result = await verifyEmailFirstOtp({ email: user.email, role: "owner", token: "012345" }, {
    getSettings: settings, now: () => 1000,
    prepare: async (_email, _role, action, _userId, requestId) => {
      if (action === "verify") { assert.equal(requestId, pending.requestId); return { kind: "unavailable" }; }
      return pending;
    },
    auth: {
      verifyOtp: async () => ({ data: { user, session: { user, access_token: "synthetic-new-token" } }, error: null }),
      getUser: async () => ({ data: { user }, error: null }), signOut: async () => { cleared++; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(cleared, 1);
});

test("password update failure never calls completion RPC", async () => {
  const actions: string[] = [];
  const result = await completeEmailFirstSignup({ email: user.email, role: "owner", name: "Person", phone: "01012345678", password: "password-1", passwordConfirm: "password-1", terms: { service: true, privacy: true, store_connection: true } }, user, {
    getSettings: settings, prepare: async (_email, _role, action) => { actions.push(action); return { ...pending, emailVerified: true }; },
    auth: { updateUser: async () => ({ error: { code: "weak_password" } }) },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(actions, ["inspect"]);
});

test("password success with completion failure remains incomplete and can retry", async () => {
  const actions: string[] = [];
  let completionAttempts = 0;
  const input = { email: user.email, role: "owner", name: "Person", phone: "01012345678", password: "password-1", passwordConfirm: "password-1", terms: { service: true, privacy: true, store_connection: true } };
  const deps = {
    getSettings: settings,
    prepare: async (_email: string, _role: "owner" | "staff", action: string, userId?: string, requestId?: string): Promise<EmailFirstState> => {
      actions.push(action);
      if (action === "complete") { assert.equal(requestId, pending.requestId); completionAttempts++; return completionAttempts === 1 ? { kind: "unavailable" } : { kind: "complete", userId }; }
      return { ...pending, emailVerified: true };
    },
    auth: { updateUser: async () => ({ error: null }) },
  };
  assert.equal((await completeEmailFirstSignup(input, user, deps)).ok, false);
  assert.equal((await completeEmailFirstSignup(input, user, deps)).ok, true);
  assert.deepEqual(actions, ["inspect", "complete", "inspect", "complete"]);
});

function actualRouteFixture(options: { passwordError?: boolean; completeError?: boolean; staleVerify?: boolean } = {}) {
  const events: string[] = [];
  const rpcInputs: Record<string, unknown>[] = [];
  const auth = {
    getUser: async (jwt?: string) => { events.push(jwt ? "getUser:fresh-jwt" : "getUser:session"); if (jwt) assert.equal(jwt, "synthetic-fresh-jwt"); return { data: { user }, error: null }; },
    verifyOtp: async (input: { token: string }) => { events.push("verifyOtp"); assert.equal(input.token, "012345"); return { data: { user, session: { user, access_token: "synthetic-fresh-jwt" } }, error: null }; },
    updateUser: async (input: { password: string }) => { events.push("updateUser"); assert.equal(input.password, "password-1"); return { error: options.passwordError ? { code: "weak_password" } : null }; },
    signOut: async () => { events.push("signOut:local"); },
  };
  const overrides = {
    "@/lib/supabase/server": { createClient: async () => ({ auth }) },
    "@/lib/auth/auth-email-settings": { fetchEmailFirstAuthSettings: settings },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name: string, input: Record<string, unknown>) => {
      assert.equal(name, "prepare_owner_staff_email_first_signup");
      rpcInputs.push(input);
      events.push(`rpc:${input.p_action}`);
      if (input.p_action === "inspect") return { data: { ...pending, expiresAt: Date.now() + 180000, emailVerified: true }, error: null };
      assert.equal(input.p_user_id, user.id);
      assert.equal(input.p_request_id, pending.requestId);
      if (input.p_action === "verify") return { data: options.staleVerify ? { kind: "unavailable" } : { ...pending, emailVerified: true }, error: null };
      if (input.p_action === "complete") return { data: options.completeError ? null : { kind: "complete", userId: user.id }, error: options.completeError ? { code: "synthetic-db-failure" } : null };
      assert.fail("Unexpected RPC action");
    } }) },
  };
  const globals = { process: { env: { NEXT_PUBLIC_SIGNUP_EMAIL_OTP_LENGTH: "6" } }, console: { ...console, error: () => {} } };
  const verify = loadComponentModule<{ POST: (request: Request) => Promise<Response> }>("app/api/auth/signup/owner-staff/verify/route.ts", overrides, globals);
  const complete = loadComponentModule<{ POST: (request: Request) => Promise<Response> }>("app/api/auth/signup/owner-staff/complete/route.ts", overrides, globals);
  const request = (path: string, body: Record<string, unknown>, origin = "http://localhost") => new Request(`http://localhost${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const finish = () => complete.POST(request("/api/auth/signup/owner-staff/complete", { email: user.email, role: "owner", name: "Person", phone: "01012345678", password: "password-1", passwordConfirm: "password-1", terms: { service: true, privacy: true, store_connection: true }, requestId: "client-forged-id" }));
  return { events, rpcInputs, verify, request, finish };
}

test("actual verify route uses current server ID and validates only the returned fresh JWT", async () => {
  const fixture = actualRouteFixture();
  const response = await fixture.verify.POST(fixture.request("/api/auth/signup/owner-staff/verify", { email: user.email, role: "owner", token: "012345", requestId: "client-forged-id" }));
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.events, ["rpc:inspect", "verifyOtp", "getUser:fresh-jwt", "rpc:verify"]);
  assert.equal(fixture.rpcInputs[1].p_request_id, pending.requestId);
});
test("actual verify route rejects crossed resend and removes the newly issued session", async () => {
  const fixture = actualRouteFixture({ staleVerify: true });
  const response = await fixture.verify.POST(fixture.request("/api/auth/signup/owner-staff/verify", { email: user.email, role: "owner", token: "012345" }));
  assert.equal(response.status, 403);
  assert.equal(fixture.events.at(-1), "signOut:local");
});
test("actual complete route orders identity and password before the bound completion RPC", async () => {
  const fixture = actualRouteFixture();
  assert.equal((await fixture.finish()).status, 200);
  assert.deepEqual(fixture.events, ["getUser:session", "rpc:inspect", "updateUser", "rpc:complete"]);
});
test("actual complete route never records completion on password failure", async () => {
  const fixture = actualRouteFixture({ passwordError: true });
  assert.equal((await fixture.finish()).status, 400);
  assert.deepEqual(fixture.events, ["getUser:session", "rpc:inspect", "updateUser"]);
});
test("actual complete route returns failure, not completed signup, after a partial update", async () => {
  const fixture = actualRouteFixture({ completeError: true });
  const response = await fixture.finish();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});
test("actual verify route refuses foreign Origin before SDK or RPC access", async () => {
  const fixture = actualRouteFixture();
  assert.equal((await fixture.verify.POST(fixture.request("/api/auth/signup/owner-staff/verify", {}, "https://foreign.example.invalid"))).status, 403);
  assert.deepEqual(fixture.events, []);
});

test("same-password retry completes a verified partial signup without repeating role changes", async () => {
  let updateCalls = 0;
  let completionCalls = 0;
  const result = await completeEmailFirstSignup({ email: user.email, role: "owner", name: "Person", phone: "01012345678", password: "password-1", passwordConfirm: "password-1", terms: { service: true, privacy: true, store_connection: true } }, user, {
    getSettings: settings,
    prepare: async (_email, _role, action, userId) => {
      if (action === "complete") { completionCalls++; return { kind: "complete", userId }; }
      return { ...pending, emailVerified: true };
    },
    auth: { updateUser: async (input) => { updateCalls++; return { error: input.password ? { code: "same_password" } : null }; } },
  });
  assert.equal(result.ok, true);
  assert.equal(updateCalls, 2);
  assert.equal(completionCalls, 1);
});

test("lost completion response is idempotent only for the same authenticated user", async () => {
  const result = await completeEmailFirstSignup({ email: user.email, role: "owner", name: "Person", phone: "01012345678", password: "password-1", passwordConfirm: "password-1", terms: { service: true, privacy: true, store_connection: true } }, user, {
    getSettings: settings, prepare: async () => ({ kind: "complete", userId: user.id }),
    auth: { updateUser: async () => assert.fail("Completed account must not repeat a password update") },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.profileComplete, true);
});

test("provider password-policy rejection is attached to the password field", async () => {
  const result = await completeEmailFirstSignup({ email: user.email, role: "owner", name: "Person", phone: "01012345678", password: "password-1", passwordConfirm: "password-1", terms: { service: true, privacy: true, store_connection: true } }, user, {
    getSettings: settings, prepare: async (_email, _role, action) => action === "inspect" ? { ...pending, emailVerified: true } : assert.fail("Provider rejected before complete RPC"),
    auth: { updateUser: async () => ({ error: { code: "weak_password" } }) },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "WEAK_PASSWORD");
    assert.equal(result.fields?.password, result.error);
  }
});

test("existing phone policy accepts ten formatted digits and canonicalizes only for storage", () => {
  assert.equal(normalizeSignupPhone(" 010-1234-5678 "), "01012345678");
  assert.equal(normalizeSignupPhone("+82 (10) 1234 5678"), "821012345678");
  assert.equal(normalizeSignupPhone("010-123-456"), "010123456");
});

test("completed email-first account resumes through login without OTP or new user", async () => {
  const result = await sendEmailFirstOtp({ email: user.email, role: "owner" }, {
    action: "start", getSettings: settings, prepare: async () => ({ kind: "complete", userId: user.id }),
    canResumeCompleted: async (id, email, role) => id === user.id && email === user.email && role === "owner",
    auth: { signInWithOtp: async () => assert.fail("Completed signup must use login") },
  });
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.code, "SIGNUP_INCOMPLETE"); assert.equal(result.nextStep, "login"); }
});

test("stale completed flow without a valid account stays blocked", async () => {
  const result = await sendEmailFirstOtp({ email: user.email, role: "owner" }, {
    action: "start", getSettings: settings, prepare: async () => ({ kind: "complete", userId: "deleted-user" }),
    canResumeCompleted: async () => false, auth: { signInWithOtp: async () => assert.fail("No OTP from stale complete state") },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "EMAIL_EXISTS");
});

test("research acceptance and refusal are separate from mandatory terms on server completion", async () => {
  for (const researchConsent of [false, true]) {
    const result = await completeEmailFirstSignup({ email: user.email, role: "owner", name: "Person", phone: "01012345678", password: "password-1", passwordConfirm: "password-1", terms: { service: true, privacy: true, store_connection: true, research: true }, researchConsent }, user, {
      getSettings: settings, now: () => 1000,
      prepare: async (_email, _role, action, userId) => action === "complete" ? { kind: "complete", userId } : { ...pending, emailVerified: true },
      auth: { updateUser: async (input) => {
        assert.equal((input.data.signupResearchConsent as { accepted: boolean }).accepted, researchConsent);
        assert.equal(Object.hasOwn(input.data.signupTerms as object, "research"), false);
        assert.equal(Object.hasOwn(input.data, "role"), false);
        return { error: null };
      } },
    });
    assert.equal(result.ok, true);
  }
});

test("incomplete cleanup preview is conservative, configurable and never includes completed/active/social users", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const past = "2026-10-07T12:00:00Z";
  const snapshot: IncompleteSignupSnapshot = {
    user: { id: "user-1", email: "person@example.org", created_at: past, updated_at: past,
      app_metadata: { provider: "email" }, identities: [{ provider: "email" }], user_metadata: { role: "owner", signup_flow: "email_first" } },
    flow: { email: "person@example.org", role: "owner", requested_at: past, available_at: past, expires_at: past, request_id: "request-1" },
    profileCount: 0, membershipCount: 0,
  };
  assert.equal(incompleteSignupGraceHours(undefined), 24);
  assert.equal(incompleteSignupGraceHours("48"), 48);
  assert.throws(() => incompleteSignupGraceHours("invalid"));
  assert.throws(() => incompleteSignupGraceHours("0"));
  assert.equal(previewIncompleteSignupCleanup(snapshot, { now, graceHours: 24 }).eligible, true);
  for (const change of [
    { profileCount: 1 }, { membershipCount: 1 }, { profileCount: null }, { flow: null },
    { flow: { ...snapshot.flow!, completed_at: past } },
    { flow: { ...snapshot.flow!, completed_user_id: "user-1" } },
    { flow: { ...snapshot.flow!, expires_at: "2026-10-10T12:00:00Z" } },
    { user: { ...snapshot.user, identities: [{ provider: "google" }] } },
    { user: { ...snapshot.user, last_sign_in_at: "2026-10-09T11:59:00Z" } },
    { user: { ...snapshot.user, user_metadata: { role: "owner" } } },
  ]) assert.equal(previewIncompleteSignupCleanup({ ...snapshot, ...change }, { now, graceHours: 24 }).eligible, false);
});

test("research consent API requires own authentication and Origin, and updates only its own metadata key", async () => {
  const writes: Record<string, unknown>[] = [];
  let authenticated = true;
  let updateFailed = false;
  const route = loadComponentModule<{ GET: () => Promise<Response>; PATCH: (request: Request) => Promise<Response> }>("app/api/auth/research-consent/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      getUser: async () => ({ data: { user: authenticated ? { id: "user-1", user_metadata: { signupResearchConsent: { accepted: true } } } : null }, error: null }),
      updateUser: async (input: { data: Record<string, unknown> }) => { writes.push(input.data); return { error: updateFailed ? { code: "unavailable" } : null }; },
    } }) },
    "@/lib/auth/owner-staff-signup-server": {
      isSameOriginRequest: (request: Request) => request.headers.get("origin") === new URL(request.url).origin,
      readJsonBody: async (request: Request) => request.json(),
    },
  });
  const request = (accepted: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/auth/research-consent", {
    method: "PATCH", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ accepted, role: "hq", signupTerms: {} }),
  });
  assert.equal((await route.GET()).status, 200);
  assert.equal((await route.PATCH(request(false, "https://foreign.example.invalid"))).status, 403);
  assert.equal((await route.PATCH(request("true"))).status, 400);
  authenticated = false;
  assert.equal((await route.PATCH(request(true))).status, 401);
  assert.equal(writes.length, 0);
  authenticated = true;
  assert.equal((await route.PATCH(request(false))).status, 200);
  assert.deepEqual(Object.keys(writes[0]), ["signupResearchConsent"]);
  assert.equal((writes[0].signupResearchConsent as { accepted: boolean }).accepted, false);
  updateFailed = true;
  assert.equal((await route.PATCH(request(true))).status, 503);
});

test("completed resume lookup protects social, foreign, deleted and already registered identities", async () => {
  const account = { ...user, identities: [{ provider: "email" }], user_metadata: {
    role: "owner", signup_flow: "email_first", name: "Person", phone: "01012345678",
    signupTerms: { service: true, privacy: true, store_connection: true },
  } };
  let current: typeof account | null = account;
  let kind = "complete";
  const moduleExports = loadComponentModule<{ canResumeCompletedSignup: (id: string, email: string, role: "owner") => Promise<boolean> }>("lib/auth/owner-staff-signup-server.ts", {
    "next/server": { NextResponse: {} },
    "@/lib/supabase/admin": { createAdminClient: () => ({
      auth: { admin: { getUserById: async () => ({ data: { user: current }, error: current ? null : { status: 404 } }) } },
      rpc: async (_name: string, params: Record<string, unknown>) => {
        assert.equal(params.p_action, "inspect");
        return { data: { kind, userId: user.id }, error: null };
      },
    }) },
  }, { process: { env: { NEXT_PUBLIC_SIGNUP_EMAIL_OTP_LENGTH: "6" } } });
  assert.equal(await moduleExports.canResumeCompletedSignup(user.id, user.email, "owner"), true);
  assert.equal(await moduleExports.canResumeCompletedSignup(user.id, "different@example.org", "owner"), false);
  current = { ...account, identities: [{ provider: "google" }] };
  assert.equal(await moduleExports.canResumeCompletedSignup(user.id, user.email, "owner"), false);
  current = null;
  assert.equal(await moduleExports.canResumeCompletedSignup(user.id, user.email, "owner"), false);
  current = account;
  kind = "exists";
  assert.equal(await moduleExports.canResumeCompletedSignup(user.id, user.email, "owner"), false);
});

test("ambiguous provider OTP failure uses current server deadline and never masks throttling or outages", async () => {
  for (const [providerError, expectedCode, now] of [
    [{ code: "otp_expired", message: "Token has expired or is invalid", status: 403 }, "CODE_INVALID", 1000],
    [{ message: "Token has expired or is invalid", status: 403 }, "CODE_INVALID", 1000],
    [{ code: "otp_expired", message: "Token has expired or is invalid", status: 403 }, "CODE_EXPIRED", 182000],
    [{ code: "invalid", status: 400 }, "CODE_EXPIRED", 182000],
    [{ status: 429, code: "over_request_rate_limit" }, "RATE_LIMITED", 1000],
    [{ status: 503, code: "unexpected_failure" }, "AUTH_UNAVAILABLE", 1000],
    [{ status: 503, code: "otp_expired", message: "Token has expired or is invalid" }, "AUTH_UNAVAILABLE", 1000],
    [{ message: "fetch failed" }, "AUTH_UNAVAILABLE", 1000],
    [{ status: 400, code: "unexpected_code" }, "AUTH_UNAVAILABLE", 1000],
    [{ status: 401, code: "bad_jwt", message: "JWT expired" }, "AUTH_UNAVAILABLE", 1000],
  ] as const) {
    let afterProvider = false;
    const result = await verifyEmailFirstOtp({ email: user.email, role: "owner", token: "123456" }, {
      getSettings: settings, now: () => afterProvider ? now : 1000, prepare: async () => pending,
      auth: { verifyOtp: async () => { afterProvider = true; return { data: { user: null, session: null }, error: providerError }; },
        getUser: async () => assert.fail("Failed code never authenticates"), signOut: async () => {} },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, expectedCode);
      if (expectedCode === "CODE_INVALID") assert.equal(result.error, "인증번호가 틀립니다. 다시 확인해 주세요.");
    }
  }
});

test("ambiguous failure during another tab's resend is rejected rather than called wrong or expired", async () => {
  let inspections = 0;
  const result = await verifyEmailFirstOtp({ email: user.email, role: "owner", token: "123456" }, {
    getSettings: settings, now: () => 1000,
    prepare: async () => ++inspections === 1 ? pending : { ...pending, requestId: "other-tab-new-request" },
    auth: { verifyOtp: async () => ({ data: { user: null, session: null }, error: { code: "otp_expired", message: "Token has expired or is invalid", status: 403 } }),
      getUser: async () => assert.fail("Changed request must not become authentication"), signOut: async () => {} },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "VERIFICATION_REJECTED");
});