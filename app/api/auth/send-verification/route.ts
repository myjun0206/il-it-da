import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

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
  return email.trim().toLowerCase();
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
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }

  const code = createVerificationCode();
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

    console.log("[AUTH] Verification Code:", code);

    return NextResponse.json({ sent: true, expiresAt }, { status: 200 });
  } catch (error) {
    console.error("[AUTH] Send verification failed:", error);
    return NextResponse.json({ error: "Unable to send verification code." }, { status: 500 });
  }
}
