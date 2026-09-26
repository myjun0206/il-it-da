// 이 모듈은 "use client" 컴포넌트에서 import할 수 없다 — 순수 판정 로직/타입은
// lib/auth/server-role-guard-core.ts에 있으며, 그쪽은 "server-only" 없이도
// 실제 Supabase 없이(주입된 client로) 단위 테스트할 수 있다. 이 파일은 실제 쿠키 기반
// Supabase server client를 기본값으로 연결하는 얇은 서버 전용 진입점이다.
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";
import {
  requireServerRole as requireServerRoleWithDeps,
  type RequireServerRoleDeps,
  type ServerRole,
  type ServerRoleCheckResult,
} from "@/lib/auth/server-role-guard-core";

export type { ServerRole, ServerRoleCheckResult, RequireServerRoleDeps };
export { decideServerRoleAccess, isServerRole } from "@/lib/auth/server-role-guard-core";

export async function requireServerRole(
  requiredRole: ServerRole,
  deps: Partial<RequireServerRoleDeps> = {},
): Promise<ServerRoleCheckResult> {
  return requireServerRoleWithDeps(requiredRole, {
    getSessionClient: deps.getSessionClient ?? createClient,
    getAdminClient: deps.getAdminClient ?? createAdminClient,
    logAuthError: deps.logAuthError ?? logSafeAuthError,
  });
}
