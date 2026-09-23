import type { SupabaseClient } from "@supabase/supabase-js";

export type ServerRole = "hq" | "owner" | "staff";

export type ServerRoleCheckResult =
  | { status: "AUTHORIZED"; userId: string; role: ServerRole }
  | { status: "UNAUTHENTICATED" }
  | { status: "FORBIDDEN" };

export function isServerRole(value: unknown): value is ServerRole {
  return value === "hq" || value === "owner" || value === "staff";
}

/**
 * profiles.role만을 진실 소스로 판정하는 순수 함수 (request body/query/user_metadata는 입력으로 받지 않음).
 * 실제 Supabase 없이 단위 테스트 가능하도록 requireServerRole()에서 분리했다.
 */
export function decideServerRoleAccess(
  requiredRole: ServerRole,
  userId: string | null,
  profileRole: string | null | undefined,
): ServerRoleCheckResult {
  if (!userId) {
    return { status: "UNAUTHENTICATED" };
  }

  if (!isServerRole(profileRole) || profileRole !== requiredRole) {
    return { status: "FORBIDDEN" };
  }

  return { status: "AUTHORIZED", userId, role: profileRole };
}

export interface RequireServerRoleDeps {
  getSessionClient: () => Promise<SupabaseClient>;
  getAdminClient: () => SupabaseClient;
  // 고정 코드 + 안전한 error name만 남기는 로거. 기본값은 no-op(로그 없음)이며,
  // 실제 서버 진입점(require-server-role.ts)이 lib/auth/safe-auth-log.ts를 주입한다.
  logAuthError?: (code: string, error: unknown) => void;
}

/**
 * 로그인 여부 + public.profiles.role만으로 서버 측 역할을 판정한다.
 * store_memberships.status(pending/rejected)는 의도적으로 검사하지 않는다 — 매장 단위
 * 승인 여부는 기존 API(예: /api/staff/stores, /api/rag/query)가 계속 담당한다.
 *
 * getSessionClient/getAdminClient는 항상 호출부(예: require-server-role.ts)에서 주입한다 —
 * 이 모듈은 실제 Supabase client를 직접 만들지 않으므로 Supabase 없이 단위 테스트할 수 있다.
 */
export async function requireServerRole(
  requiredRole: ServerRole,
  deps: RequireServerRoleDeps,
): Promise<ServerRoleCheckResult> {
  const sessionClient = await deps.getSessionClient();
  const { data: userData, error: userError } = await sessionClient.auth.getUser();

  if (userError) {
    deps.logAuthError?.("REQUIRE_SERVER_ROLE_AUTH_FAILED", userError);
  }

  const userId = !userError && userData.user ? userData.user.id : null;

  if (!userId) {
    return { status: "UNAUTHENTICATED" };
  }

  const adminClient = deps.getAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle<{ role: string }>();

  if (profileError) {
    deps.logAuthError?.("REQUIRE_SERVER_ROLE_PROFILE_LOOKUP_FAILED", profileError);
    return { status: "FORBIDDEN" };
  }

  return decideServerRoleAccess(requiredRole, userId, profile?.role);
}
