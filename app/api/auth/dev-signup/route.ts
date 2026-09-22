import { NextResponse } from "next/server";

import { isDevelopmentEnvironment } from "@/lib/auth/dev-test-verification";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DevSignupRequest = {
  email?: unknown;
  password?: unknown;
  name?: unknown;
  role?: unknown;
};

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDevelopmentEnvironment()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let body: DevSignupRequest;
  try {
    body = (await request.json()) as DevSignupRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = getString(body.email)?.toLowerCase() ?? null;
  const password = getString(body.password);
  const name = getString(body.name);
  const role = getString(body.role);

  if (!email || !password || password.length < 8 || !name || !["owner", "staff"].includes(role ?? "")) {
    return NextResponse.json({ error: "Invalid development signup data." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: usersData, error: listError } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (listError) {
    console.error("[DEV_SIGNUP] Unable to inspect auth users:", listError.name);
    return NextResponse.json({ error: "Unable to prepare development user." }, { status: 500 });
  }

  const existingUser = usersData.users.find(
    (user) => user.email?.trim().toLowerCase() === email,
  );
  const userMetadata = { name, role };

  if (existingUser) {
    const { error } = await adminClient.auth.admin.updateUserById(existingUser.id, {
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });
    if (error) {
      console.error("[DEV_SIGNUP] Unable to update auth user:", error.name);
      return NextResponse.json({ error: "Unable to prepare development user." }, { status: 500 });
    }
  } else {
    const { error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });
    if (error) {
      console.error("[DEV_SIGNUP] Unable to create auth user:", error.name);
      return NextResponse.json({ error: "Unable to prepare development user." }, { status: 500 });
    }
  }

  return NextResponse.json(
    { success: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}