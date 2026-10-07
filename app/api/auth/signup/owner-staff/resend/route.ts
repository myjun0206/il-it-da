import { NextResponse } from "next/server";

import { fetchAuthEmailSettings } from "@/lib/auth/auth-email-settings";
import { resendOwnerStaffSignup } from "@/lib/auth/owner-staff-signup";
import {
  UNEXPECTED_SIGNUP_ERROR,
  createEphemeralAuthClient,
  prepareOwnerStaffSignup,
  isSameOriginRequest,
  readJsonBody,
  signupEmailRedirectTo,
  toOtpResponse,
} from "@/lib/auth/owner-staff-signup-server";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";

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
    const result = await resendOwnerStaffSignup(
      { email: body.email, role: body.role },
      {
        authClient: createEphemeralAuthClient(),
        getSettings: fetchAuthEmailSettings,
        prepare: prepareOwnerStaffSignup,
        emailRedirectTo: signupEmailRedirectTo(request),
      },
    );
    if (!result.ok) logSafeAuthError(`OWNER_STAFF_SIGNUP_RESEND_${result.code}`, null);
    return toOtpResponse(result);
  } catch (error) {
    logSafeAuthError("OWNER_STAFF_SIGNUP_RESEND_UNEXPECTED", error);
    return NextResponse.json(UNEXPECTED_SIGNUP_ERROR, { status: 500 });
  }
}
