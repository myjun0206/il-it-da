import { acceptsResearchInvitations, createResearchConsent, requiredSignupConsent } from "../../lib/auth/signup-research-consent.ts";
test("optional research consent is explicit, separate and never supplies required consent", () => {
  const now = new Date("2026-10-09T00:00:00Z");
  assert.equal(createResearchConsent(undefined, now).accepted, false);
  assert.equal(createResearchConsent("true", now).accepted, false);
  assert.equal(createResearchConsent(true, now).accepted, true);
  assert.equal(acceptsResearchInvitations({ accepted: true }), true);
  assert.equal(acceptsResearchInvitations({ accepted: "true" }), false);
  assert.deepEqual(requiredSignupConsent({ research: true }), {
    service: false, privacy: false, store_connection: false, store_work: false,
  });
  assert.deepEqual(requiredSignupConsent({ service: true, privacy: true, store_connection: true, research: true }), {
    service: true, privacy: true, store_connection: true, store_work: false,
  });
});
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateOwnerStaffSignup, startOwnerStaffSignup, resendOwnerStaffSignup, verifyOwnerStaffSignup,
  checkEmailSignupConfirmation, mapAuthError, isValidSignupToken,
  type StartSignupDeps, type VerifyAuthClient, type PrepareSignup,
  validateInitialEmailMembership,
  validateOwnerStaffSignupProfile, isValidSignupEmail, normalizeSignupEmail, normalizeSignupName,
} from "../../lib/auth/owner-staff-signup.ts";
import { parseAuthEmailSettings } from "../../lib/auth/auth-email-settings.ts";

const input = {
  email: " person@example.org ", name: "홍길동", phone: "010-1234-5678", role: "owner",
  password: " 123456 ", passwordConfirm: " 123456 ",
  terms: { service: true, privacy: true, store_connection: true },
};

test("preserves existing name, phone and password boundaries without changing passwords", () => {
  assert.deepEqual(validateOwnerStaffSignup(input), {});
  assert.deepEqual(validateOwnerStaffSignup({ ...input, password: "a".repeat(100), passwordConfirm: "a".repeat(100) }), {});
  assert.ok(validateOwnerStaffSignup({ ...input, name: " ", phone: "123456789", password: "1234567" }).name);
  assert.ok(validateOwnerStaffSignup({ ...input, passwordConfirm: input.password.trim() }).passwordConfirm);
  assert.ok(validateOwnerStaffSignup({ ...input, terms: { service: "true", privacy: true, store_connection: true } }).terms);
  assert.ok(validateOwnerStaffSignup({ ...input, role: "hq" }).role);
  assert.ok(validateOwnerStaffSignup({ ...input, email: "a@b" }).email);
  assert.deepEqual(validateOwnerStaffSignup({ ...input, name: "가나", phone: "1234567890" }), {});
});

test("normalizes and validates human names without a Hangul-only restriction", () => {
  for (const name of ["홍길동", "Kim Min-su", "O'Connor", "O’Connor", "Jose\u0301 Cruz"]) {
    assert.equal(validateOwnerStaffSignupProfile({ name, phone: "01012345678" }).name, undefined, name);
  }
  assert.equal(normalizeSignupName("  Jose\u0301 Cruz  "), "José Cruz");
  for (const name of ["", "   ", "A", "가".repeat(51), "홍길동2", "Kim 😀", "홍길동!", "ㄱㄴ", "ㅏㅓ", "\u0301", "O--Connor"]) {
    assert.equal(validateOwnerStaffSignupProfile({ name, phone: "01012345678" }).name, "올바른 이름을 입력해 주세요.", name);
  }
  assert.equal(validateOwnerStaffSignupProfile({ name: "가".repeat(50), phone: "01012345678" }).name, undefined);
});

test("rejects validation bypass before calling Auth", async () => {
  let called = false;
  const result = await startOwnerStaffSignup({ ...input, terms: null }, {
    authClient: { signUp: async () => { called = true; throw new Error("unexpected Auth call"); }, resend: async () => ({ error: null }) },
    getSettings: async () => ({ emailEnabled: true, autoconfirm: false, signupDisabled: false }),
    prepare: async () => ({ kind: "new" }), emailRedirectTo: "http://localhost/auth/callback",
  });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

const settings = { emailEnabled: true, autoconfirm: false, signupDisabled: false };
const user = {
  id: "account-id", email: "person@example.org", email_confirmed_at: null as string | null,
  confirmation_sent_at: "2026-10-06T00:00:00Z", identities: [{ provider: "email" }],
  app_metadata: { provider: "email" }, user_metadata: { role: "owner", name: input.name, phone: input.phone },
};

function makeDeps(overrides: Partial<StartSignupDeps> = {}) {
  const calls: string[] = [];
  const deps: StartSignupDeps = {
    getSettings: async () => settings, prepare: async () => ({ kind: "new" }),
    emailRedirectTo: "http://localhost/auth/callback",
    authClient: {
      signUp: async (credentials) => {
        calls.push("signUp");
        assert.equal(credentials.password, input.password);
        assert.equal(credentials.email, "person@example.org");
        assert.equal(credentials.options.data.signupTerms, input.terms);
        return { data: { user, session: null }, error: null };
      },
      resend: async (credentials) => {
        calls.push("resend");
        assert.equal(credentials.type, "signup");
        assert.equal("password" in credentials, false);
        assert.equal("data" in credentials.options, false);
        return { error: null };
      },
    },
    ...overrides,
  };
  return { deps, calls };
}

test("new signup sends a password confirmation and never creates a profile or returns a session", async () => {
  const { deps, calls } = makeDeps();
  const result = await startOwnerStaffSignup(input, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["signUp"]);
  assert.equal("session" in result, false);
});

test("resuming an existing unconfirmed account only resends without changing credentials or metadata", async () => {
  const { deps, calls } = makeDeps({ prepare: async () => ({ kind: "resume" }) });
  const result = await startOwnerStaffSignup(input, deps);
  assert.equal(result.ok && result.resumed, true);
  assert.deepEqual(calls, ["resend"]);
  assert.equal((await resendOwnerStaffSignup({ email: input.email, role: "owner" }, deps)).ok, true);
  assert.deepEqual(calls, ["resend", "resend"]);
});

test("duplicate, wrong role, missing migration and distributed cooldown stop before Auth", async () => {
  const cases: Array<[Awaited<ReturnType<PrepareSignup>>, string]> = [
    [{ kind: "exists" }, "EMAIL_EXISTS"], [{ kind: "role_mismatch" }, "SIGNUP_ROLE_MISMATCH"],
    [{ kind: "unavailable" }, "EMAIL_OTP_UNAVAILABLE"], [{ kind: "rate_limited", retryAfterSeconds: 42 }, "RATE_LIMITED"],
  ];
  for (const [preparation, code] of cases) {
    const { deps, calls } = makeDeps({ prepare: async () => preparation });
    for (const result of [await startOwnerStaffSignup(input, deps), await resendOwnerStaffSignup({ email: input.email, role: "owner" }, deps)]) {
      assert.equal(!result.ok && result.code, code);
    }
    assert.deepEqual(calls, []);
  }
});

test("unavailable settings and Confirm email OFF cannot become signup success", async () => {
  for (const value of [null, { ...settings, autoconfirm: true }, { ...settings, emailEnabled: false }, { ...settings, signupDisabled: true }]) {
    const { deps, calls } = makeDeps({ getSettings: async () => value });
    assert.equal((await startOwnerStaffSignup(input, deps)).ok, false);
    assert.deepEqual(calls, []);
  }
  const { deps } = makeDeps();
  deps.authClient.signUp = async () => ({ data: { user: { ...user, email_confirmed_at: "confirmed" }, session: {} }, error: null });
  const result = await startOwnerStaffSignup(input, deps);
  assert.equal(!result.ok && result.code, "EMAIL_OTP_UNAVAILABLE");
});

test("mail failures, throttling, duplicate and weak password have safe Korean errors", () => {
  for (const [error, code] of [
    [{ status: 429, message: "after 28 seconds" }, "RATE_LIMITED"],
    [{ status: 500, message: "secret mail detail" }, "EMAIL_SEND_FAILED"],
    [{ code: "email_address_not_authorized" }, "EMAIL_SEND_FAILED"],
    [{ code: "user_already_exists" }, "EMAIL_EXISTS"], [{ code: "weak_password" }, "WEAK_PASSWORD"],
  ] as const) {
    const result = mapAuthError(error, "send");
    assert.equal(!result.ok && result.code, code);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
});

test("OTP format is exact and preserves leading zeroes; Auth decides invalid, expired and used codes", async () => {
  const calls: string[] = [];
  const authClient: VerifyAuthClient = {
    verifyOtp: async ({ token, type }) => {
      calls.push(token);
      assert.equal(type, "email");
      return { data: { user: { ...user, email_confirmed_at: "confirmed" }, session: {} }, error: null };
    }, signOut: async () => { calls.push("signOut"); },
  };
  const deps = { authClient, prepare: async () => ({ kind: "resume" as const }), getSettings: async () => settings };
  for (const token of ["", "12345", "1234567", "12345a", " 012345 ", 123456]) {
    assert.equal(isValidSignupToken(token), false);
    assert.equal((await verifyOwnerStaffSignup({ email: input.email, token, role: "owner" }, deps)).ok, false);
  }
  assert.deepEqual(calls, []);
  assert.equal((await verifyOwnerStaffSignup({ email: input.email, token: "012345", role: "owner" }, deps)).ok, true);
  assert.deepEqual(calls, ["012345"]);
  authClient.verifyOtp = async () => ({ data: { user: null, session: null }, error: { code: "otp_expired" } });
  const result = await verifyOwnerStaffSignup({ email: input.email, token: "012345", role: "owner" }, deps);
  assert.equal(!result.ok && result.code, "CODE_EXPIRED");
});

test("verification rejects changed email, social identity, wrong role and auto-confirmed users and clears session", async () => {
  for (const invalid of [
    { ...user, email: "changed@example.org" }, { ...user, user_metadata: { role: "hq" } },
    { ...user, identities: [{ provider: "google" }] }, { ...user, confirmation_sent_at: null },
  ]) {
    let cleared = false;
    const result = await verifyOwnerStaffSignup({ email: input.email, token: "012345", role: "owner" }, {
      getSettings: async () => settings, prepare: async () => ({ kind: "resume" }),
      authClient: {
        verifyOtp: async () => ({ data: { user: { ...invalid, email_confirmed_at: "confirmed" }, session: {} }, error: null }),
        signOut: async () => { cleared = true; },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(cleared, true);
  }
});

test("initial membership requires actual email confirmation and send history; existing social onboarding stays compatible", async () => {
  const options = { hasProfile: false, getSettings: async () => settings };
  assert.equal((await checkEmailSignupConfirmation(user, options)).ok, false);
  assert.equal((await checkEmailSignupConfirmation({ ...user, email_confirmed_at: "confirmed" }, options)).ok, true);
  assert.equal((await checkEmailSignupConfirmation({ ...user, email_confirmed_at: "confirmed", confirmation_sent_at: null }, options)).ok, false);
  assert.equal((await checkEmailSignupConfirmation({ ...user, email_confirmed_at: "confirmed" }, { ...options, getSettings: async () => null })).ok, false);
  assert.equal((await checkEmailSignupConfirmation({ ...user, app_metadata: { provider: "google" }, identities: [{ provider: "google" }] }, options)).ok, true);
  assert.equal((await checkEmailSignupConfirmation({ ...user, email_confirmed_at: "confirmed" }, { hasProfile: true, getSettings: async () => null })).ok, true);
});

test("settings parsing rejects incomplete payloads and required terms cannot be omitted for either role", () => {
  assert.equal(parseAuthEmailSettings({ external: { email: true } }), null);
  assert.deepEqual(parseAuthEmailSettings({ external: { email: true }, mailer_autoconfirm: false }), settings);
  for (const field of ["email", "name", "phone", "password", "passwordConfirm"]) {
    assert.ok(Object.keys(validateOwnerStaffSignup({ ...input, [field]: "" })).length);
  }
  assert.ok(validateOwnerStaffSignup({ ...input, role: "staff" }).terms);
  assert.deepEqual(validateOwnerStaffSignup({ ...input, role: "staff", terms: { service: true, privacy: true, store_work: true } }), {});
});

test("membership validates actual Auth metadata and role-specific consent instead of client profile fields", () => {
  assert.equal(validateInitialEmailMembership(user, "owner", input.terms, input.email), null);
  assert.ok(validateInitialEmailMembership(user, "staff", input.terms, input.email));
  assert.ok(validateInitialEmailMembership(user, "owner", null, input.email));
  assert.ok(validateInitialEmailMembership(user, "owner", input.terms, "changed@example.org"));
  assert.ok(validateInitialEmailMembership(user, "owner", input.terms, undefined));
  assert.ok(validateInitialEmailMembership({ ...user, user_metadata: { ...user.user_metadata, name: " " } }, "owner", input.terms, input.email));
  assert.ok(validateInitialEmailMembership({ ...user, user_metadata: { ...user.user_metadata, phone: "123" } }, "owner", input.terms, input.email));
});

test("signup and resend share normalized email boundaries without provider restrictions", async () => {
  const maxEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
  assert.equal(maxEmail.length, 254);
  assert.equal(isValidSignupEmail(maxEmail), true);
  assert.deepEqual(validateOwnerStaffSignup({ ...input, email: maxEmail }), {});
  assert.equal(normalizeSignupEmail(" \u200BPerson@Private.Example\uFEFF "), "person@private.example");
  assert.deepEqual(validateOwnerStaffSignup({ ...input, email: " \u200BPerson@Private.Example\uFEFF " }), {});
  for (const email of [maxEmail + "d", "person@@example.org", "person@exam ple.org", "", null, [input.email]]) {
    const { deps, calls } = makeDeps();
    assert.ok(validateOwnerStaffSignup({ ...input, email }).email);
    assert.equal((await startOwnerStaffSignup({ ...input, email }, deps)).ok, false);
    assert.equal((await resendOwnerStaffSignup({ email, role: "owner" }, deps)).ok, false);
    assert.deepEqual(calls, []);
  }
});

test("verified-profile validation reuses unchanged name and phone rules without requiring a stored password", () => {
  assert.deepEqual(validateOwnerStaffSignupProfile({ name: "가나", phone: "1234567890" }), {});
  assert.ok(validateOwnerStaffSignupProfile({ name: " ", phone: "1234567890" }).name);
  assert.ok(validateOwnerStaffSignupProfile({ name: "가나", phone: "123456789" }).phone);
  assert.equal(validateOwnerStaffSignupProfile({ name: "가".repeat(50), phone: "01-123456789012345" }).name, undefined);
  assert.equal(validateOwnerStaffSignupProfile({ name: "가".repeat(51), phone: "01-123456789012345" }).name, "올바른 이름을 입력해 주세요.");
  for (const value of [undefined, null, [], 123]) {
    const errors = validateOwnerStaffSignupProfile({ name: value, phone: value });
    assert.ok(errors.name);
    assert.ok(errors.phone);
  }
});

test("each required consent and password confirmation is enforced before account creation", async () => {
  for (const role of ["owner", "staff"]) {
    const requiredTerm = role === "owner" ? "store_connection" : "store_work";
    const terms = { service: true, privacy: true, [requiredTerm]: true };
    for (const term of ["service", "privacy", requiredTerm]) {
      const { deps, calls } = makeDeps();
      const result = await startOwnerStaffSignup({ ...input, role, terms: { ...terms, [term]: false } }, deps);
      assert.equal(!result.ok && Boolean(result.fields?.terms), true);
      assert.deepEqual(calls, []);
    }
    const { deps, calls } = makeDeps();
    const result = await startOwnerStaffSignup({ ...input, role, terms, passwordConfirm: "different" }, deps);
    assert.equal(!result.ok && Boolean(result.fields?.passwordConfirm), true);
    assert.deepEqual(calls, []);
  }
});

test("stores the trimmed NFC name in Supabase Auth metadata", async () => {
  let savedName = "";
  const result = await startOwnerStaffSignup({ ...input, name: "  Jose\u0301 Cruz  " }, {
    authClient: {
      signUp: async (credentials) => {
        savedName = String(credentials.options.data.name);
        return { data: { user, session: null }, error: null };
      },
      resend: async () => ({ error: null }),
    },
    getSettings: async () => settings,
    prepare: async () => ({ kind: "new" }),
    emailRedirectTo: "http://localhost/auth/callback",
  });
  assert.equal(result.ok, true);
  assert.equal(savedName, "José Cruz");
});