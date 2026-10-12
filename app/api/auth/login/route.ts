import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkEmailSignupConfirmation } from "@/lib/auth/owner-staff-signup";
import { fetchAuthEmailSettings } from "@/lib/auth/auth-email-settings";

export const runtime = "nodejs";

type LoginRequestBody = {
  email?: unknown;
  password?: unknown;
  rememberMe?: unknown;
};

type LoginResponseBody = {
  user?: {
    id: string;
    email: string;
    mustChangePassword?: boolean;
    role?: string;
    approvalStatus?: "pending" | "approved" | "rejected";
  };
  code?: "EMAIL_NOT_CONFIRMED" | "SIGNUP_INCOMPLETE";
  signup?: { role: "owner" | "staff"; email: string; name: string; phone: string };
  error?: string;
};

type ProfileRoleRow = {
  role: string;
  approval_status: string | null;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function POST(request: Request): Promise<NextResponse<LoginResponseBody>> {
  let body: LoginRequestBody;

  try {
    body = (await request.json()) as LoginRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "입력값을 확인해주세요." }, { status: 400 });
  }

  const email = getString(body.email);
  const password = typeof body.password === "string" ? body.password : undefined;

  if (body.rememberMe !== undefined && typeof body.rememberMe !== "boolean") {
    return NextResponse.json({ error: "Invalid rememberMe value." }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: "이메일과 비밀번호를 입력해주세요." }, { status: 400 });
  }

  const supabase = await createClient({ rememberMe: body.rememberMe === true });

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.user) {
    if (authError?.code === "email_not_confirmed") {
      return NextResponse.json(
        {
          code: "EMAIL_NOT_CONFIRMED",
          error: "이메일 인증이 완료되지 않은 계정입니다. 회원가입에서 같은 이메일로 인증번호를 다시 받아 인증을 완료해주세요.",
        },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: authError?.message || "아이디 또는 비밀번호를 확인해주세요." },
      { status: 401 },
    );
  }

  if (authData.user.app_metadata?.must_change_password === true) {
    return NextResponse.json({
      user: {
        id: authData.user.id,
        email: authData.user.email ?? email,
        mustChangePassword: true,
      },
    });
  }

  // profiles has RLS enabled with no anon-facing policies, so use the admin client to read the role.
  const adminClient = createAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role, approval_status")
    .eq("id", authData.user.id)
    .maybeSingle<ProfileRoleRow>();

  const metadataRole = authData.user.user_metadata?.role;
  const isOwnerStaffEmailSignup =
    authData.user.app_metadata?.provider === "email" &&
    Boolean(authData.user.email_confirmed_at) &&
    (metadataRole === "owner" || metadataRole === "staff");

  if (!profileError && !profile && isOwnerStaffEmailSignup) {
    const confirmation = await checkEmailSignupConfirmation(authData.user, { hasProfile: false, getSettings: fetchAuthEmailSettings });
    if (!confirmation.ok) {
      await supabase.auth.signOut({ scope: "local" });
      return NextResponse.json({ error: confirmation.error }, { status: confirmation.status });
    }
    // 이메일 인증은 끝났지만 매장 신청 전에 이탈한 점주·직원: 세션을 유지한 채 매장 선택으로 이어가게 한다.
    const metadata = authData.user.user_metadata ?? {};
    return NextResponse.json(
      {
        code: "SIGNUP_INCOMPLETE",
        error: "가입 신청이 아직 완료되지 않았습니다. 가입 정보를 확인한 뒤 매장 선택을 이어서 진행해주세요.",
        signup: {
          role: metadataRole,
          email: authData.user.email ?? email,
          name: typeof metadata.name === "string" ? metadata.name : "",
          phone: typeof metadata.phone === "string" ? metadata.phone : "",
        },
      },
      { status: 409 },
    );
  }

  if (profileError || !profile?.role) {
    return NextResponse.json(
      { error: "사용자 역할 정보를 확인할 수 없습니다." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    user: {
      id: authData.user.id,
      email: authData.user.email ?? email,
      role: profile.role,
      approvalStatus: profile.approval_status === "approved" || profile.approval_status === "rejected"
        ? profile.approval_status
        : "pending",
    },
  });
}
