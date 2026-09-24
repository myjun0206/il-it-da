import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { DEV_TEST_EMAILS, DEV_TEST_VERIFICATION_CODE } from "@/lib/data/mockFranchises";
import {
  isDevelopmentEnvironment,
  shouldIssueDevTestVerificationCode,
} from "@/lib/auth/dev-test-verification";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";

export const runtime = "nodejs";

type SendVerificationRequestBody = {
  email?: unknown;
};

type SendVerificationResponse = {
  sent?: boolean;
  expiresAt?: string;
  error?: string;
};

function normalizeEmail(email: string): string {
  return email.replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function POST(request: Request): Promise<NextResponse<SendVerificationResponse>> {
  let body: SendVerificationRequestBody;

  try {
    body = (await request.json()) as SendVerificationRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.email !== "string") {
    return NextResponse.json({ error: "email is required." }, { status: 400 });
  }

  const email = normalizeEmail(body.email);

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "유효하지 않은 이메일 형식입니다. 공백이나 형식을 확인해주세요." },
      { status: 400 },
    );
  }

  // 실제 이메일 발송 서비스가 아직 연결되지 않았다: 운영(및 development가 아닌 모든 환경)에서는
  // 발송에 성공한 것처럼 거짓 응답하지 않고 fail closed 처리한다.
  if (!isDevelopmentEnvironment()) {
    return NextResponse.json(
      { error: "이메일 인증 서비스를 사용할 수 없습니다." },
      { status: 503 },
    );
  }

  // development 환경: 허용된 테스트 이메일만 고정 테스트 코드를 사용하고, 그 외 이메일은
  // 기존과 동일하게 crypto.randomInt 기반 실제 코드 생성 경로를 그대로 사용한다.
  const code = shouldIssueDevTestVerificationCode(email, DEV_TEST_EMAILS)
    ? DEV_TEST_VERIFICATION_CODE
    : createVerificationCode();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("email_verifications").insert({
      email,
      code,
      expires_at: expiresAt,
      is_verified: false,
    });

    if (error) {
      throw error;
    }

    if (isDevelopmentEnvironment()) {
      console.log("🔗 [DEV] Email Auth Link / Token:", {
        email,
        verificationCode: code,
        expiresAt,
        inbucketUrl: "http://localhost:54324",
        note: "로컬 Supabase Inbucket을 사용하는 경우 위 URL에서 수신 메일과 인증 링크를 확인할 수 있습니다.",
      });
    }

    return NextResponse.json({ sent: true, expiresAt }, { status: 200 });
  } catch (error) {
    logSafeAuthError("SEND_VERIFICATION_FAILED", error);
    return NextResponse.json({ error: "Unable to send verification code." }, { status: 500 });
  }
}
