import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import type { OtpResult, PrepareSignup } from "@/lib/auth/owner-staff-signup";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EmailFirstState, PrepareEmailFirst } from "@/lib/auth/email-first-signup";

export const prepareEmailFirstSignup: PrepareEmailFirst = async (email, role, action, userId, requestId) => {
  const { data, error } = await createAdminClient().rpc("prepare_owner_staff_email_first_signup", {
    p_email: email, p_role: role, p_action: action, p_user_id: userId ?? null, p_request_id: requestId ?? null,
  });
  if (error || !data || typeof data !== "object") return { kind: "unavailable" };
  if (!["new", "resume", "complete", "legacy", "exists", "role_mismatch", "unavailable", "rate_limited"].includes(data.kind)) return { kind: "unavailable" };
  return {
    kind: data.kind as EmailFirstState["kind"],
    userId: typeof data.userId === "string" ? data.userId : undefined,
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : undefined,
    retryAfterSeconds: typeof data.retryAfterSeconds === "number" ? data.retryAfterSeconds : undefined,
    emailVerified: data.emailVerified === true,
    requestId: typeof data.requestId === "string" ? data.requestId : undefined,
  };
};

export const prepareOwnerStaffSignup: PrepareSignup = async (email, role, action) => {
  const { data, error } = await createAdminClient().rpc("prepare_owner_staff_signup", {
    p_email: email, p_role: role, p_action: action,
  });
  if (error || !data || typeof data !== "object") return { kind: "unavailable" };
  if (data.kind === "rate_limited") return { kind: "rate_limited", retryAfterSeconds: Math.max(1, Number(data.retryAfterSeconds) || 60) };
  if (["new", "resume", "exists", "role_mismatch"].includes(data.kind)) return { kind: data.kind };
  return { kind: "unavailable" };
};

/** 세션을 저장하지 않는 서버 전용 anon 클라이언트. signUp/resend 응답의 세션은 쿠키로 남기지 않는다. */
export function createEphemeralAuthClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  const client = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client.auth;
}

/** 같은 출처에서 온 요청만 허용한다(CSRF 방지). */
export function isSameOriginRequest(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin;
}

export function signupEmailRedirectTo(request: Request): string {
  const url = new URL("/auth/callback", new URL(request.url).origin);
  url.searchParams.set("next", "/signup/profile?auth=email");
  return url.toString();
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function toOtpResponse(result: OtpResult): NextResponse {
  const { status, ...body } = result;
  const response = NextResponse.json(body, { status });
  if (!result.ok && result.retryAfterSeconds) {
    response.headers.set("Retry-After", String(result.retryAfterSeconds));
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const UNEXPECTED_SIGNUP_ERROR = {
  ok: false,
  code: "SIGNUP_FAILED",
  error: "회원가입 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
} as const;
