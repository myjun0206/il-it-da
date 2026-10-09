import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/user";
import { createResearchConsent, RESEARCH_CONSENT_KEY } from "@/lib/auth/signup-research-consent";
import { isSameOriginRequest } from "@/lib/auth/owner-staff-signup-server";
import { hasRequiredSignupTerms, normalizeSignupName, normalizeSignupPhone, validateOwnerStaffSignupProfile } from "@/lib/auth/owner-staff-signup";
import { requiredSignupConsent } from "@/lib/auth/signup-research-consent";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";

export const runtime = "nodejs";

type OAuthOnboardingBody = {
  role?: unknown;
  name?: unknown;
  phone?: unknown;
  researchConsent?: unknown;
  terms?: unknown;
};

type OAuthOnboardingResponse = {
  userId?: string;
  role?: UserRole;
  error?: string;
  code?: string;
  fields?: Record<string, string>;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getRole(value: unknown): UserRole | null {
  return value === "hq" || value === "owner" || value === "staff" ? value : null;
}

function isOAuthUser(user: {
  identities?: Array<{ provider?: string }> | null;
  app_metadata?: Record<string, unknown>;
}): boolean {
  const identityProvider = user.identities?.some(
    (identity) =>
      identity.provider === "google" ||
      identity.provider === "kakao" ||
      identity.provider === "apple" ||
      identity.provider === "custom:naver",
  );

  const primaryProvider = user.app_metadata?.provider;

  return Boolean(
    identityProvider ||
      primaryProvider === "google" ||
      primaryProvider === "kakao" ||
      primaryProvider === "apple" ||
      primaryProvider === "custom:naver",
  );
}

export async function POST(
  request: Request,
): Promise<NextResponse<OAuthOnboardingResponse>> {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "요청 출처를 확인할 수 없습니다.", code: "OAUTH_INVALID_REQUEST" }, { status: 403 });
  let body: OAuthOnboardingBody;

  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "가입 정보를 확인해주세요.", code: "OAUTH_INVALID_REQUEST" }, { status: 400 });
    }
    body = parsed;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const role = getRole(body.role);
  const name = getString(body.name);
  const phone = getString(body.phone);

  if (!role) {
    return NextResponse.json(
      { error: "가입 역할을 확인해주세요.", code: "OAUTH_INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const sessionClient = await createClient();
  const { data: userData, error: userError } =
    await sessionClient.auth.getUser();

  const user = userData.user;

  if (userError || !user) {
    return NextResponse.json(
      { error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  if (!isOAuthUser(user)) {
    return NextResponse.json(
      { error: "OAuth 사용자만 이용할 수 있습니다." },
      { status: 403 },
    );
  }

  if (role === "hq") {
    return NextResponse.json(
      { error: "본사 관리자는 이메일과 비밀번호로 가입해야 합니다." },
      { status: 403 },
    );
  }

  const adminClient = createAdminClient();

  const { data: existingProfile, error: existingProfileError } =
    await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle<{ role: UserRole }>();

  if (existingProfileError) {
    logSafeAuthError("OAUTH_ONBOARDING_PROFILE_LOOKUP_FAILED", existingProfileError);

    return NextResponse.json(
      { error: "프로필을 확인하지 못했습니다." },
      { status: 500 },
    );
  }

  if (existingProfile && existingProfile.role !== role) {
      return NextResponse.json(
        { error: "이미 다른 역할로 등록된 사용자입니다." },
        { status: 409 },
      );
  }
  if (!existingProfile) {
    const fields = validateOwnerStaffSignupProfile({ name, phone });
    if (!hasRequiredSignupTerms(body.terms, role)) fields.terms = "필수 약관에 동의해주세요.";
    if (Object.keys(fields).length) return NextResponse.json({ error: "가입 정보를 확인해주세요.", code: "OAUTH_ONBOARDING_REQUIRED", fields }, { status: 400 });
  }
  if (!existingProfile || body.researchConsent !== undefined) {
    const { error } = await sessionClient.auth.updateUser({ data: {
      ...(body.researchConsent !== undefined ? { [RESEARCH_CONSENT_KEY]: createResearchConsent(body.researchConsent) } : {}),
      ...(!existingProfile ? { signupTerms: requiredSignupConsent(body.terms) } : {}),
    } });
    if (error) return NextResponse.json({ error: "선택 동의를 저장하지 못했습니다." }, { status: 503 });
  }
  if (existingProfile) {
    return NextResponse.json({
      userId: user.id,
      role: existingProfile.role,
    });
  }

  const { error: rawInsertError } = await adminClient
    .from("profiles")
    .insert({
      id: user.id,
      user_id: user.id,
      email: user.email?.trim().toLowerCase() || null,
      full_name: normalizeSignupName(name),
      role,
      phone: normalizeSignupPhone(phone),
      company_email: null,
      brand_id: null,
      approval_status: "pending",
      approved_at: null,
    });

  const insertError = rawInsertError as {
    code?: string;
    message?: string;
  } | null;

  if (insertError) {
    const errorCode = String(insertError.code ?? "");

    if (errorCode === "23505") {
      const { data: concurrentProfile } = await adminClient
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle<{ role: UserRole }>();

      if (concurrentProfile) {
        if (concurrentProfile.role !== role) return NextResponse.json({ error: "이미 다른 역할로 등록된 사용자입니다.", code: "OAUTH_ROLE_MISMATCH" }, { status: 409 });
        return NextResponse.json({
          userId: user.id,
          role: concurrentProfile.role,
        });
      }
    }

    logSafeAuthError("OAUTH_ONBOARDING_PROFILE_INSERT_FAILED", insertError);

    return NextResponse.json(
      { error: "프로필을 생성하지 못했습니다." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { userId: user.id, role },
    { status: 201 },
  );
}