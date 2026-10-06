import {
  parseCookieHeader,
  serializeCookieHeader,
  type CookieOptions,
} from "@supabase/ssr";

export const SUPABASE_SESSION_COOKIE_OPTIONS = {
  name: "il-it-da-auth-session",
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
} as const;

const LEGACY_AUTH_COOKIE_PATTERN = /^sb-.+-auth-token(?:\.\d+)?$/;

export const SESSION_POLICY_COOKIE = "il-it-da-session-policy";
export const SESSION_MODE_COOKIE = "il-it-da-session-mode";
export const OAUTH_POLICY_COOKIE = "il-it-da-oauth-policy";
export const PERSISTENT_SESSION_MAX_AGE = 400 * 24 * 60 * 60;

export function isSupabaseSessionCookie(name: string): boolean {
  return name === SUPABASE_SESSION_COOKIE_OPTIONS.name ||
    new RegExp(`^${SUPABASE_SESSION_COOKIE_OPTIONS.name}\\.\\d+$`).test(name);
}

export function toSessionCookieOptions(
  value: string,
  options: CookieOptions,
  rememberMe = false,
): CookieOptions {
  if (!value || options.maxAge === 0 || rememberMe) {
    return options;
  }

  const sessionOptions = { ...options };
  delete sessionOptions.maxAge;
  delete sessionOptions.expires;
  return sessionOptions;
}

export function isLegacySupabaseAuthCookie(name: string): boolean {
  return LEGACY_AUTH_COOKIE_PATTERN.test(name);
}

export function parseBrowserCookies(cookieHeader: string): { name: string; value: string }[] {
  return parseCookieHeader(cookieHeader);
}

export function serializeBrowserCookie(
  name: string,
  value: string,
  options: CookieOptions,
  rememberMe = false,
): string {
  const cookieOptions = toSessionCookieOptions(value, options, rememberMe);
  return serializeCookieHeader(name, value, cookieOptions);
}