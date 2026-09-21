import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type VerifyCodeRequestBody = {
  email?: unknown;
  code?: unknown;
};

type VerificationRow = {
  id: string;
  code: string;
  expires_at: string;
};

type VerifyCodeResponse = {
  verified?: boolean;
  error?: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isSixDigitCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

function codesMatch(expectedCode: string, actualCode: string): boolean {
  if (!isSixDigitCode(expectedCode) || !isSixDigitCode(actualCode)) {
    return false;
  }

  const expected = Buffer.from(expectedCode, "utf8");
  const actual = Buffer.from(actualCode, "utf8");

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: Request): Promise<NextResponse<VerifyCodeResponse>> {
  let body: VerifyCodeRequestBody;

  try {
    body = (await request.json()) as VerifyCodeRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.email !== "string" || typeof body.code !== "string") {
    return NextResponse.json({ error: "email and code are required." }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const code = body.code.trim();

  if (!isValidEmail(email) || !isSixDigitCode(code)) {
    return NextResponse.json({ error: "Invalid verification request." }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const { data, error: selectError } = await supabase
      .from("email_verifications")
      .select("id, code, expires_at")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<VerificationRow>();

    if (selectError) {
      throw selectError;
    }

    if (!data) {
      return NextResponse.json({ error: "Verification code was not requested." }, { status: 404 });
    }

    if (new Date(data.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: "Verification code has expired." }, { status: 410 });
    }

    if (!codesMatch(data.code, code)) {
      return NextResponse.json({ error: "Verification code does not match." }, { status: 400 });
    }

    const { error: updateError } = await supabase
      .from("email_verifications")
      .update({ is_verified: true })
      .eq("id", data.id);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({ verified: true }, { status: 200 });
  } catch (error) {
    console.error("[AUTH] Verify code failed:", error);
    return NextResponse.json({ error: "Unable to verify code." }, { status: 500 });
  }
}
