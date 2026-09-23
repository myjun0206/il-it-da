import { NextResponse } from "next/server";

export const runtime = "nodejs";

type DevEmailLogRequest = {
  email?: unknown;
  emailRedirectTo?: unknown;
  context?: unknown;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function POST(request: Request): Promise<NextResponse<{ logged: boolean }>> {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ logged: false }, { status: 404 });
  }

  let body: DevEmailLogRequest;
  try {
    body = (await request.json()) as DevEmailLogRequest;
  } catch {
    body = {};
  }

  console.log("🔗 [DEV] Email Auth Link / Token:", {
    context: getString(body.context) || "supabase-auth",
    email: getString(body.email) || null,
    emailRedirectTo: getString(body.emailRedirectTo) || null,
    inbucketUrl: "http://localhost:54324",
    note: "Supabase CLI 로컬 환경에서는 Inbucket에서 실제 수신 이메일과 인증 링크를 확인하세요.",
  });

  return NextResponse.json({ logged: true });
}
