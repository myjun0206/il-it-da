import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/user";

export const runtime = "nodejs";

type OAuthOnboardingBody = {
  role?: unknown;
  name?: unknown;
  phone?: unknown;
};

type OAuthOnboardingResponse = {
  userId?: string;
  role?: UserRole;
  error?: string;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getRole(value: unknown): UserRole | null {
  return value === "hq" || value === "owner" || value === "staff" ? value : null;
}

function isOAuthUser(user: { identities?: Array<{ provider?: string }> | null; app_metadata?: Record<string, unknown> }): boolean {
  const identityProvider = user.identities?.some(
    (identity) => identity.provider === "google" || identity.provider === "kakao" || identity.provider === "apple" || identity.provider === "custom:naver",
  );
  const primaryProvider = user.app_metadata?.provider;
  return Boolean(identityProvider || primaryProvider === "google" || primaryProvider === "kakao" || primaryProvider === "apple" || primaryProvider === "custom:naver");
}

export async function POST(request: Request): Promise<NextResponse<OAuthOnboardingResponse>> {
  let body: OAuthOnboardingBody;

  try {
    body = (await request.json()) as OAuthOnboardingBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const role = getRole(body.role);
  const name = getString(body.name);
  const phone = getString(body.phone);

  if (!role || !name || !phone) {
    return NextResponse.json({ error: "role, name, and phone are required." }, { status: 400 });
  }

  const sessionClient = await createClient();
  const { data: userData, error: userError } = await sessionClient.auth.getUser();
  const user = userData.user;

  if (userError || !user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  if (!isOAuthUser(user)) {
    return NextResponse.json({ error: "OAuth 사용자만 이용할 수 있습니다." }, { status: 403 });
  }

  if (role === "hq") {
    return NextResponse.json(
      { error: "본사 관리자는 이메일과 비밀번호로 가입해야 합니다." },
      { status: 403 },
    );
  }

  const adminClient = createAdminClient();
  const { data: existingProfile, error: existingProfileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: UserRole }>();

  if (existingProfileError) {
    console.error("[AUTH_OAUTH_ONBOARDING] Profile lookup failed:", existingProfileError.message);
    return NextResponse.json({ error: "프로필을 확인하지 못했습니다." }, { status: 500 });
  }

  if (existingProfile) {
    if (existingProfile.role !== role) {
      return NextResponse.json(
        { error: "이미 다른 역할로 등록된 사용자입니다." },
        { status: 409 },
      );
    }

    return NextResponse.json({ userId: user.id, role: existingProfile.role });
  }

  const { error: insertError } = await adminClient.from("profiles").insert({
    id: user.id,
    email: user.email?.trim().toLowerCase() || null,
    full_name: name,
    role,
    phone,
    company_email: null,
    brand_id: null,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: concurrentProfile } = await adminClient
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle<{ role: UserRole }>();

      if (concurrentProfile) {
        return NextResponse.json({ userId: user.id, role: concurrentProfile.role });
      }
    }

    console.error("[AUTH_OAUTH_ONBOARDING] Profile insert failed:", insertError.message);
    return NextResponse.json({ error: "프로필을 생성하지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ userId: user.id, role }, { status: 201 });
}