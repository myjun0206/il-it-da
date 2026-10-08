import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchEmailFirstAuthSettings } from "@/lib/auth/auth-email-settings";
import { completeEmailFirstSignup } from "@/lib/auth/email-first-signup";
import { isSameOriginRequest, readJsonBody, prepareEmailFirstSignup, toOtpResponse, UNEXPECTED_SIGNUP_ERROR } from "@/lib/auth/owner-staff-signup-server";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 403 });
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return NextResponse.json({ ok: false, code: "VERIFICATION_REJECTED" }, { status: 401 });
    const result = await completeEmailFirstSignup(body, data.user, {
      auth: client.auth, getSettings: fetchEmailFirstAuthSettings, prepare: prepareEmailFirstSignup,
    });
    if (!result.ok) logSafeAuthError(`OWNER_STAFF_SIGNUP_COMPLETE_${result.code}`, null);
    return toOtpResponse(result);
  } catch (error) {
    logSafeAuthError("OWNER_STAFF_SIGNUP_COMPLETE_UNEXPECTED", error);
    return NextResponse.json(UNEXPECTED_SIGNUP_ERROR, { status: 500 });
  }
}