import { NextResponse } from "next/server";

import { getSafeAuthNextPath } from "@/lib/auth/auth-callback";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertSignupProfile, submitStoreMembershipRequest } from "@/lib/signup/store-membership-service";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";
import type { User } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/types/user";

export const runtime = "nodejs";

const ROLE_DESTINATIONS: Record<UserRole, string> = {
  hq: "/hq",
  owner: "/boss",
  staff: "/staff",
};

interface PendingStoreEntry {
  storeId?: string;
  storeName?: string;
  franchiseId?: string;
}

function loginErrorUrl(origin: string, error: string): URL {
  const url = new URL("/", origin);
  url.searchParams.set("oauthError", error);
  return url;
}

function isUserRole(value: unknown): value is UserRole {
  return value === "hq" || value === "owner" || value === "staff";
}

function isEmailVerificationType(value: string | null): value is
  | "signup"
  | "email"
  | "invite"
  | "recovery"
  | "magiclink"
  | "email_change"
  | "phone_change" {
  return (
    value === "signup" ||
    value === "email" ||
    value === "invite" ||
    value === "recovery" ||
    value === "magiclink" ||
    value === "email_change" ||
    value === "phone_change"
  );
}

function parsePendingStores(raw: unknown): PendingStoreEntry[] {
  try {
    const parsed = Array.isArray(raw) ? raw : JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PendingStoreEntry =>
        !!entry && typeof entry === "object" && typeof entry.storeName === "string" && entry.storeName.length > 0
    );
  } catch {
    return [];
  }
}

/**
 * 이메일 인증 콜백으로 세션이 막 생성된 시점에, signUp 시 user_metadata에 담아둔
 * 선택 매장 목록(pendingStores)을 서버(관리자 클라이언트)에서 직접 일괄 승인 신청 처리한다.
 * 클라이언트가 이 시점에 API를 호출하면 쿠키/세션 전파 타이밍 문제(AuthApiError)가
 * 발생할 수 있어, 세션이 확실히 있는 이 콜백 안에서 처리해 그 문제를 원천적으로 피한다.
 */
async function autoSubmitPendingStoreMemberships(user: User): Promise<boolean> {
  const role = user.user_metadata?.role;
  if (role !== "owner" && role !== "staff") return false;

  const pendingStores = parsePendingStores(user.user_metadata?.pendingStores);
  if (pendingStores.length === 0) return false;

  const adminClient = createAdminClient();
  const userName = (user.user_metadata?.name as string | undefined) || user.email || "Unknown User";
  const userPhone = typeof user.user_metadata?.phone === "string" ? user.user_metadata.phone : null;

  const profileResult = await upsertSignupProfile(adminClient, {
    userId: user.id,
    email: user.email ?? null,
    role,
    name: userName,
    phone: userPhone,
  });

  if (!profileResult.success) {
    logSafeAuthError("AUTH_CALLBACK_AUTO_MEMBERSHIP_PROFILE_FAILED", new Error(profileResult.error));
    return false;
  }

  for (const store of pendingStores) {
    const result = await submitStoreMembershipRequest(adminClient, {
      userId: user.id,
      userName,
      role,
      storeId: store.storeId,
      storeName: store.storeName,
      franchiseId: store.franchiseId,
    });
    if (!result.success) {
      logSafeAuthError("AUTH_CALLBACK_AUTO_MEMBERSHIP_STORE_FAILED", new Error(result.error));
    }
  }

  // 재처리 방지를 위해 처리한 pendingStores는 metadata에서 제거한다.
  const { pendingStores: _pendingStores, ...restMetadata } = user.user_metadata ?? {};
  await adminClient.auth.admin.updateUserById(user.id, { user_metadata: restMetadata });

  return true;
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const verificationType = requestUrl.searchParams.get("type");

  if (!code && !tokenHash) {
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "missing_code"));
  }

  const supabase = await createClient();
  let authError;
  if (code) {
    authError = (await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && isEmailVerificationType(verificationType)) {
    authError = (
      await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: verificationType,
      })
    ).error;
  } else {
    authError = new Error("invalid_verification_type");
  }

  if (authError) {
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "exchange_failed"));
  }

  const requestedNext = requestUrl.searchParams.get("next");
  if (requestedNext) {
    const safeNext = getSafeAuthNextPath(requestedNext);

    if (safeNext === "/signup/approval" || safeNext === "/signup/approval-status") {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user && (await autoSubmitPendingStoreMemberships(userData.user))) {
        return NextResponse.redirect(new URL("/signup/approval-status", requestUrl.origin));
      }
    }

    return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "user_failed"));
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, approval_status")
    .eq("id", userData.user.id)
    .maybeSingle<{ role: string; approval_status: string | null }>();

  if (profileError) {
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "profile_failed"));
  }

  if (!profile) {
    return NextResponse.redirect(new URL("/signup/role?auth=oauth", requestUrl.origin));
  }

  if (!isUserRole(profile.role)) {
    return NextResponse.redirect(loginErrorUrl(requestUrl.origin, "invalid_role"));
  }

  if (profile.role !== "hq" && profile.approval_status !== "approved") {
    return NextResponse.redirect(new URL("/signup/approval-status", requestUrl.origin));
  }

  return NextResponse.redirect(new URL(ROLE_DESTINATIONS[profile.role], requestUrl.origin));
}
