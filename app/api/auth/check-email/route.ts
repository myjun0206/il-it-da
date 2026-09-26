import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type CheckEmailRequestBody = {
  email?: unknown;
};

type CheckEmailResponse = {
  available?: boolean;
  error?: string;
};

function normalizeEmail(email: string): string {
  return email.replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request): Promise<NextResponse<CheckEmailResponse>> {
  let body: CheckEmailRequestBody;

  try {
    body = (await request.json()) as CheckEmailRequestBody;
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

  try {
    const supabase = createAdminClient();
    const { data: rpcResult, error: rpcError } = await supabase.rpc("email_exists_for_signup", {
      check_email: email,
    });

    if (!rpcError && typeof rpcResult === "boolean") {
      return NextResponse.json({ available: !rpcResult }, { status: 200 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (profile) {
      return NextResponse.json({ available: false }, { status: 200 });
    }

    const { data: usersPage, error: usersError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (usersError) {
      throw usersError;
    }

    const existsInAuth = usersPage.users.some(
      (user) => user.email?.trim().toLowerCase() === email,
    );

    return NextResponse.json({ available: !existsInAuth }, { status: 200 });
  } catch (error) {
    console.error("[AUTH] Check email failed:", error);
    return NextResponse.json({ error: "Unable to check email." }, { status: 500 });
  }
}
