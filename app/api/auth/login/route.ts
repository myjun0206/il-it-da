import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getAccountApprovalStatus, type AccountApprovalStatus } from "@/lib/auth/account-approval";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type LoginRequestBody = {
  email?: unknown;
  password?: unknown;
};

type LoginResponseBody = {
  user?: {
    id: string;
    email: string;
    role: string;
    approvalStatus: AccountApprovalStatus;
  };
  error?: string;
};

type ProfileRoleRow = {
  role: string;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function POST(request: NextRequest): Promise<NextResponse<LoginResponseBody>> {
  let body: LoginRequestBody;

  try {
    body = (await request.json()) as LoginRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = getString(body.email);
  const password = getString(body.password);

  if (!email || !password) {
    return NextResponse.json({ error: "이메일과 비밀번호를 입력해주세요." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "로그인 서버 설정이 누락되었습니다." }, { status: 500 });
  }

  let pendingCookies: Array<{ name: string; value: string; options: CookieOptions }> = [];
  let pendingHeaders: Record<string, string> = {};
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        pendingCookies = cookiesToSet;
        pendingHeaders = headersToSet;
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
      },
    },
  });

  const jsonResponse = (
    body: LoginResponseBody,
    init?: ResponseInit,
  ): NextResponse<LoginResponseBody> => {
    const response = NextResponse.json(body, init);
    pendingCookies.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
    Object.entries(pendingHeaders).forEach(([name, value]) => {
      response.headers.set(name, value);
    });
    return response;
  };

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.user) {
    return jsonResponse(
      { error: authError?.message || "아이디 또는 비밀번호를 확인해주세요." },
      { status: 401 },
    );
  }

  if (!authData.session) {
    return jsonResponse({ error: "로그인 세션을 생성하지 못했습니다." }, { status: 500 });
  }

  // profiles has RLS enabled with no anon-facing policies, so use the admin client to read the role.
  const adminClient = createAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle<ProfileRoleRow>();

  if (profileError || !profile?.role) {
    return jsonResponse(
      { error: "사용자 역할 정보를 확인할 수 없습니다." },
      { status: 500 },
    );
  }

  let approvalStatus: AccountApprovalStatus;
  try {
    approvalStatus = await getAccountApprovalStatus(adminClient, authData.user.id, profile.role);
  } catch (error) {
    console.error("[LOGIN] Approval status lookup failed:", error);
    return jsonResponse({ error: "승인 상태를 확인할 수 없습니다." }, { status: 500 });
  }

  console.log("[AUTH_LOGIN] Session established.", {
    userId: authData.user.id,
    cookieNames: pendingCookies.map((cookie) => cookie.name),
  });

  return jsonResponse({
    user: {
      id: authData.user.id,
      email: authData.user.email ?? email,
      role: profile.role,
      approvalStatus,
    },
  });
}
