import { NextResponse } from "next/server";

import { verifyEmailFirstOtp } from "@/lib/auth/email-first-signup";
import { fetchEmailFirstAuthSettings } from "@/lib/auth/auth-email-settings";
import {
  UNEXPECTED_SIGNUP_ERROR,
  isSameOriginRequest,
  prepareEmailFirstSignup,
  readJsonBody,
  toOtpResponse,
} from "@/lib/auth/owner-staff-signup-server";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST", error: "요청 출처를 확인할 수 없습니다." }, { status: 403 });
  }

  const body = await readJsonBody(request);
  if (!body) {
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST", error: "입력값을 확인해주세요." }, { status: 400 });
  }

  try {
    // 로그인 API와 같은 방식으로 세션 쿠키 + 세션 정책 쿠키(브라우저 세션 유지)를 발급한다.
    const supabase = await createClient({ rememberMe: false });
    const result = await verifyEmailFirstOtp(
      { email: body.email, token: body.token, role: body.role },
      { auth: supabase.auth, getSettings: fetchEmailFirstAuthSettings, prepare: prepareEmailFirstSignup },
    );
    if (!result.ok) logSafeAuthError(`OWNER_STAFF_SIGNUP_VERIFY_${result.code}`, null);
    return toOtpResponse(result);
  } catch (error) {
    logSafeAuthError("OWNER_STAFF_SIGNUP_VERIFY_UNEXPECTED", error);
    return NextResponse.json(UNEXPECTED_SIGNUP_ERROR, { status: 500 });
  }
}
