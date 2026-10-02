import { createHmac, timingSafeEqual } from "node:crypto";
import type { CookieOptions } from "@supabase/ssr";
import {
  isSupabaseSessionCookie,
  PERSISTENT_SESSION_MAX_AGE,
  SESSION_MODE_COOKIE,
  SESSION_POLICY_COOKIE,
  SUPABASE_SESSION_COOKIE_OPTIONS,
  toSessionCookieOptions,
} from "@/lib/supabase/session-cookies";

type Cookie = { name: string; value: string };
type CookieWrite = Cookie & { options: CookieOptions };
type Policy = { purpose: "session" | "oauth"; sessionId: string; rememberMe: boolean; expiresAt: number };

function signingKey(): string {
  const key = process.env.AUTH_SESSION_POLICY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("Missing server session policy signing key.");
  return key;
}

export function signSessionPolicy(
  purpose: Policy["purpose"],
  sessionId: string,
  rememberMe: boolean,
  now = Date.now(),
): string {
  const lifetime = purpose === "oauth" ? 600 : PERSISTENT_SESSION_MAX_AGE;
  const payload = Buffer.from(JSON.stringify({ purpose, sessionId, rememberMe, expiresAt: now + lifetime * 1000 })).toString("base64url");
  const signature = createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySessionPolicy(value: string | undefined, purpose: Policy["purpose"], now = Date.now()): Policy | null {
  if (!value || value.length > 2048) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const expected = createHmac("sha256", signingKey()).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const policy = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as Policy;
    return policy.purpose === purpose && typeof policy.sessionId === "string" &&
      typeof policy.rememberMe === "boolean" && Number.isFinite(policy.expiresAt) && policy.expiresAt > now ? policy : null;
  } catch {
    return null;
  }
}

export function sessionIdFromCookies(cookies: Cookie[]): string | null {
  try {
    const base = cookies.find(({ name }) => name === SUPABASE_SESSION_COOKIE_OPTIONS.name);
    const chunks = cookies.filter(({ name }) => isSupabaseSessionCookie(name))
      .sort((first, second) => Number(first.name.split(".").at(-1)) - Number(second.name.split(".").at(-1)));
    const stored = base?.value || chunks.map(({ value }) => value).join("");
    const session = JSON.parse(stored.startsWith("base64-") ? Buffer.from(stored.slice(7), "base64url").toString() : stored);
    const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString());
    return typeof claims.session_id === "string" && claims.session_id ? claims.session_id : null;
  } catch {
    return null;
  }
}

export function readSessionPolicy(cookies: Cookie[]): Policy | null {
  const policy = verifySessionPolicy(cookies.find(({ name }) => name === SESSION_POLICY_COOKIE)?.value, "session");
  return policy && policy.sessionId === sessionIdFromCookies(cookies) ? policy : null;
}

export function sessionPolicyCookieOptions(rememberMe: boolean, httpOnly = true): CookieOptions {
  return {
    path: "/",
    sameSite: "lax",
    secure: SUPABASE_SESSION_COOKIE_OPTIONS.secure,
    httpOnly,
    ...(rememberMe ? { maxAge: PERSISTENT_SESSION_MAX_AGE } : {}),
  };
}

export function clearSessionPolicyCookies(): CookieWrite[] {
  return [SESSION_POLICY_COOKIE, SESSION_MODE_COOKIE].map((name) => ({
    name, value: "", options: { ...sessionPolicyCookieOptions(false, name !== SESSION_MODE_COOKIE), maxAge: 0 },
  }));
}

export function applySessionCookiePolicy(current: Cookie[], incoming: CookieWrite[], rememberMe: boolean): CookieWrite[] {
  const writes = incoming.map(({ name, value, options }) => ({ name, value, options: toSessionCookieOptions(value, options, rememberMe) }));
  if (!incoming.some(({ name }) => isSupabaseSessionCookie(name))) return writes;
  const merged = new Map(current.map(({ name, value }) => [name, value]));
  incoming.forEach(({ name, value }) => value ? merged.set(name, value) : merged.delete(name));
  const sessionId = sessionIdFromCookies(Array.from(merged, ([name, value]) => ({ name, value })));
  if (!sessionId) return [...writes, ...clearSessionPolicyCookies()];
  return [...writes,
    { name: SESSION_POLICY_COOKIE, value: signSessionPolicy("session", sessionId, rememberMe), options: sessionPolicyCookieOptions(rememberMe) },
    { name: SESSION_MODE_COOKIE, value: rememberMe ? "persistent" : "session", options: sessionPolicyCookieOptions(rememberMe, false) },
  ];
}