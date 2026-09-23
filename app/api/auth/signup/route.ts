import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSessionClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type SignupRole = "hq" | "owner" | "boss" | "staff";

type SignupStore = {
  id?: unknown;
  storeId?: unknown;
  name?: unknown;
  storeName?: unknown;
  address?: unknown;
  brandName?: unknown;
  franchiseName?: unknown;
};

type SignupRequestBody = {
  email?: unknown;
  companyEmail?: unknown;
  password?: unknown;
  name?: unknown;
  phone?: unknown;
  role?: unknown;
  brandId?: unknown;
  selectedBrandId?: unknown;
  selectedStoreIds?: unknown;
  selectedStores?: unknown;
};

type SignupResponse = {
  userId?: string;
  role?: string;
  error?: string;
  detail?: string;
  code?: "email_exists";
};

type VerificationRow = {
  id: string;
  is_verified: boolean;
  expires_at: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeRole(role: unknown): SignupRole | null {
  if (role === "hq" || role === "owner" || role === "boss" || role === "staff") {
    return role;
  }

  return null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getSelectedStores(body: SignupRequestBody): SignupStore[] {
  if (Array.isArray(body.selectedStores)) {
    return body.selectedStores.filter(
      (store): store is SignupStore => store !== null && typeof store === "object" && !Array.isArray(store),
    );
  }

  if (Array.isArray(body.selectedStoreIds)) {
    return body.selectedStoreIds
      .filter((storeId): storeId is string => typeof storeId === "string" && storeId.trim().length > 0)
      .map((storeId) => ({ storeId }));
  }

  return [];
}

function toStoreApprovalRow(userId: string, role: SignupRole, store: SignupStore) {
  const storeId = getString(store.storeId) || getString(store.id);

  if (!storeId) {
    return null;
  }

  return {
    requester_id: userId,
    requester_role: role === "boss" ? "owner" : role,
    store_id: storeId,
    store_name: getString(store.storeName) || getString(store.name) || null,
    store_address: getString(store.address) || null,
    franchise_name: getString(store.franchiseName) || getString(store.brandName) || null,
    status: "pending",
  };
}

function getMissingSupabaseEnvVars(): string[] {
  const missing = [];

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY");
  }

  return missing;
}

function getErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function getErrorMetadata(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return { message: getErrorDetail(error) };
  }

  const value = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
    code?: unknown;
    status?: unknown;
    stack?: unknown;
  };

  return {
    message: value.message ?? getErrorDetail(error),
    details: value.details,
    hint: value.hint,
    code: value.code,
    status: value.status,
    stack: value.stack,
  };
}

function logSignupError(error: unknown): void {
  console.error("[SIGNUP_ERROR]", error);
  console.error("[SIGNUP_ERROR]", getErrorMetadata(error));
}

// Supabase auth.admin.createUser()가 이미 가입된 이메일에 대해 내리는 email_exists/중복 에러를 구별해 내진다.
function isEmailAlreadyRegisteredError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as { code?: unknown; message?: unknown };
  const code = typeof value.code === "string" ? value.code.toLowerCase() : "";
  const message = typeof value.message === "string" ? value.message.toLowerCase() : "";

  return (
    code === "email_exists" ||
    code === "user_already_exists" ||
    message.includes("already been registered") ||
    message.includes("already registered") ||
    message.includes("already exists")
  );
}

function createSignupError(stage: string, error: unknown): Error {
  const metadata = getErrorMetadata(error);
  const detailParts = [
    metadata.message,
    metadata.details ? `details=${String(metadata.details)}` : null,
    metadata.hint ? `hint=${String(metadata.hint)}` : null,
    metadata.code ? `code=${String(metadata.code)}` : null,
  ].filter(Boolean);

  const signupError = new Error(`${stage}: ${detailParts.join("; ")}`);

  if (error instanceof Error && error.stack) {
    signupError.stack = error.stack;
  }

  return signupError;
}

export async function POST(request: Request): Promise<NextResponse<SignupResponse>> {
  let body: SignupRequestBody;

  try {
    body = (await request.json()) as SignupRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const role = normalizeRole(body.role);
  const primaryEmail = getString(body.email) || getString(body.companyEmail);
  const password = getString(body.password);
  const fullName = getString(body.name);

  if (!role || !primaryEmail || !password || !fullName) {
    return NextResponse.json({ error: "email, password, name, and role are required." }, { status: 400 });
  }

  const email = normalizeEmail(primaryEmail);

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const missingEnvVars = getMissingSupabaseEnvVars();
  if (missingEnvVars.length > 0) {
    const errorMessage = `Missing Supabase environment variables: ${missingEnvVars.join(", ")}`;
    const error = new Error(errorMessage);
    logSignupError(error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 },
    );
  }

  const supabase = createAdminClient();

  try {
    const { data: verification, error: verificationError } = await supabase
      .from("email_verifications")
      .select("id, is_verified, expires_at")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<VerificationRow>();

    if (verificationError) {
      logSignupError(createSignupError("Email verification lookup failed", verificationError));
      throw createSignupError("Email verification lookup failed", verificationError);
    }

    if (!verification?.is_verified || new Date(verification.expires_at).getTime() <= Date.now()) {
      const detail = !verification
        ? "No email verification record was found."
        : verification.is_verified
        ? "Email verification has expired."
        : "Email has not been verified.";
      const error = new Error(`Email verification failed: ${detail}`);
      logSignupError(error);
      return NextResponse.json({ error: "Email verification is required.", detail }, { status: 400 });
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: fullName,
        phone: getString(body.phone),
        role,
        companyEmail: getString(body.companyEmail),
      },
    });

    if (authError) {
      const error = createSignupError("Supabase createUser failed", authError);
      logSignupError(error);

      if (isEmailAlreadyRegisteredError(authError)) {
        return NextResponse.json(
          { error: "이미 가입된 이메일입니다. 로그인해 주세요.", code: "email_exists" },
          { status: 409 },
        );
      }

      return NextResponse.json(
        { error: getErrorDetail(authError), detail: error.message },
        { status: 400 },
      );
    }

    if (!authData.user?.id) {
      const error = new Error("Supabase createUser did not return a created user id.");
      logSignupError(error);
      throw error;
    }

    if (process.env.NODE_ENV === "development") {
      console.log("🔗 [DEV] Email Auth Link / Token:", {
        context: "admin createUser",
        email,
        emailConfirm: true,
        inbucketUrl: "http://localhost:54324",
        note: "이 서버 가입 경로는 email_confirm=true로 사용자를 생성하므로 Supabase 인증 메일/링크가 발송되지 않습니다.",
      });
    }

    const userId = authData.user.id;
    const profileRole = role === "boss" ? "owner" : role;
    const { error: profileError } = await supabase.from("profiles").insert({
      id: userId,
      email,
      full_name: fullName,
      role: profileRole,
      phone: getString(body.phone) || null,
      company_email: getString(body.companyEmail) || null,
      brand_id: getString(body.brandId) || getString(body.selectedBrandId) || null,
      approval_status: profileRole === "hq" ? "approved" : "pending",
      approved_at: profileRole === "hq" ? new Date().toISOString() : null,
    });

    if (profileError) {
      await supabase.auth.admin.deleteUser(userId);
      logSignupError(createSignupError("Profiles insert failed", profileError));
      throw createSignupError("Profiles insert failed", profileError);
    }

    if (role === "owner" || role === "boss" || role === "staff") {
      const approvalRows = getSelectedStores(body)
        .map((store) => toStoreApprovalRow(userId, role, store))
        .filter((row): row is NonNullable<ReturnType<typeof toStoreApprovalRow>> => row !== null);

      if (approvalRows.length > 0) {
        const { error: approvalError } = await supabase
          .from("store_approval_requests")
          .insert(approvalRows);

        if (approvalError) {
          await supabase.from("profiles").delete().eq("id", userId);
          await supabase.auth.admin.deleteUser(userId);
          logSignupError(createSignupError("Store approval requests insert failed", approvalError));
          throw createSignupError("Store approval requests insert failed", approvalError);
        }
      }
    }

    // HQ 계정은 가입 직후 별도 로그인 없이 온보딩으로 넘어가야 하므로 세션 쿠키를 바로 발급한다.
    if (role === "hq") {
      const sessionClient = await createSessionClient();
      const { error: signInError } = await sessionClient.auth.signInWithPassword({ email, password });

      if (signInError) {
        logSignupError(createSignupError("Post-signup sign-in failed", signInError));
      }
    }

    return NextResponse.json({ userId, role: profileRole }, { status: 201 });
  } catch (error) {
    logSignupError(error);
    return NextResponse.json(
      { error: getErrorDetail(error) },
      { status: 500 },
    );
  }
}
