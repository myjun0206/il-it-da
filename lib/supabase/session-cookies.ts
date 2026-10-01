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

export function toSessionCookieOptions(
  value: string,
  options: CookieOptions,
): CookieOptions {
  if (!value || options.maxAge === 0) {
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
): string {
  const cookieOptions = toSessionCookieOptions(value, options);
  return serializeCookieHeader(name, value, cookieOptions);
}