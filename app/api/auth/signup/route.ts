import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";
import {
  SIGNUP_FAILED_MESSAGE,
  runSignup,
  type SignupRequestBody,
  type SignupResponseBody,
} from "@/lib/auth/signup-service";

export const runtime = "nodejs";

function hasSupabaseAdminEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
  );
}

export async function POST(request: Request): Promise<NextResponse<SignupResponseBody>> {
  let body: SignupRequestBody;

  try {
    body = (await request.json()) as SignupRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    // 환경변수 이름은 응답에 담지 않고 서버 로그 코드로만 구분한다.
    logSafeAuthError("SIGNUP_MISSING_ENV_VARS", new Error("Missing Supabase admin environment variables"));
    return NextResponse.json({ error: SIGNUP_FAILED_MESSAGE }, { status: 500 });
  }

  const result = await runSignup(body, {
    admin: createAdminClient(),
    async signInHq(email, password) {
      const sessionClient = await createSessionClient({ rememberMe: false });
      return sessionClient.auth.signInWithPassword({ email, password });
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
