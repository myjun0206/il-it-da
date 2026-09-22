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
  return email.trim().toLowerCase();
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
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return NextResponse.json({ available: !data }, { status: 200 });
  } catch (error) {
    console.error("[AUTH] Check email failed:", error);
    return NextResponse.json({ error: "Unable to check email." }, { status: 500 });
  }
}
