import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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
    approvalStatus: "pending" | "approved" | "rejected";
  };
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

  const email = getString(body.email);
  const password = getString(body.password);

  if (!email || !password) {
    return NextResponse.json({ error: "이메일과 비밀번호를 입력해주세요." }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.user) {
    return NextResponse.json(
      { error: authError?.message || "아이디 또는 비밀번호를 확인해주세요." },
      { status: 401 },
    );
  }

  // profiles has RLS enabled with no anon-facing policies, so use the admin client to read the role.
  const adminClient = createAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role, approval_status")
    .eq("id", authData.user.id)
    .maybeSingle<ProfileRoleRow>();

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
