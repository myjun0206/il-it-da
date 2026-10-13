import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getStoreMembershipAccess } from "@/lib/auth/store-membership-access";
import { isLegacySupabaseAuthCookie, isSupabaseSessionCookie, OAUTH_POLICY_COOKIE, SUPABASE_SESSION_COOKIE_OPTIONS } from "@/lib/supabase/session-cookies";
import { clearSessionPolicyCookies, sessionPolicyCookieOptions } from "@/lib/supabase/session-policy";

export type StoreSignupRole = "owner" | "staff";

export type IncompleteStoreSignupResult =
  | { status: "NOT_APPLICABLE" }
  | { status: "DELETED" }
  | { status: "MEMBERSHIP"; access: "ACTIVE" | "PENDING" }
  | { status: "ERROR" };

export async function deleteIncompleteStoreSignupAccount(
  adminClient: SupabaseClient | null | undefined,
  userId: string,
  role: string | null | undefined,
): Promise<IncompleteStoreSignupResult> {
  if (role !== "owner" && role !== "staff") return { status: "NOT_APPLICABLE" };
  if (!adminClient || typeof adminClient.from !== "function") return { status: "NOT_APPLICABLE" };

  const access = await getStoreMembershipAccess(adminClient, userId);
  if (access === "ERROR") return { status: "ERROR" };
  if (access !== "UNLINKED") return { status: "MEMBERSHIP", access };

  if (!adminClient?.auth?.admin?.deleteUser || typeof adminClient.auth.admin.deleteUser !== "function") {
    return { status: "NOT_APPLICABLE" };
  }

  const { error } = await adminClient.auth.admin.deleteUser(userId);
  return error ? { status: "ERROR" } : { status: "DELETED" };
}

export function clearDeletedAccountCookies<T>(response: NextResponse<T>, cookieNames: string[]): NextResponse<T> {
  const authCookieNames = new Set([
    SUPABASE_SESSION_COOKIE_OPTIONS.name,
    ...cookieNames.filter((name) => isSupabaseSessionCookie(name) || isLegacySupabaseAuthCookie(name)),
  ]);

  authCookieNames.forEach((name) => {
    response.cookies.set(name, "", {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
    });
  });
  clearSessionPolicyCookies().forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  response.cookies.set(OAUTH_POLICY_COOKIE, "", { ...sessionPolicyCookieOptions(false), maxAge: 0 });
  return response;
}
