import type { SupabaseClient } from "@supabase/supabase-js";

import { logSafeAuthError } from "@/lib/auth/safe-auth-log";
import { buildSignupProfileRow } from "@/lib/auth/signup-profile";

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

export type SignupRequestBody = {
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

export type SignupResponseBody = {
  userId?: string;
  role?: string;
  /** HQ 가입에만 담는다. false면 계정은 만들어졌지만 자동 로그인에 실패해 다시 로그인해야 한다. */
  sessionEstablished?: boolean;
  error?: string;
  detail?: string;
  code?: "email_exists";
};

export type SignupResult = { status: number; body: SignupResponseBody };

export interface SignupDeps {
  /** service role 클라이언트. email_verifications/profiles/store_approval_requests와 auth.admin을 쓴다. */
  admin: SupabaseClient;
  /** HQ 가입 직후 세션 쿠키 발급. 실패해도 가입은 성공으로 끝난다. */
  signInHq?: (email: string, password: string) => Promise<{ error: unknown }>;
  log?: (code: string, error: unknown) => void;
}

type VerificationRow = {
  id: string;
  is_verified: boolean;
  expires_at: string;
};

// DB/Auth 오류 원문(failing row, details, hint, hook 메시지)은 이메일·이름·전화번호를 담을 수 있어 응답에 넣지 않는다.
export const SIGNUP_FAILED_MESSAGE = "회원가입 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
export const EMAIL_EXISTS_MESSAGE = "이미 가입된 이메일입니다. 로그인해 주세요.";
export const WEAK_PASSWORD_MESSAGE =
  "비밀번호가 보안 규칙을 충족하지 않습니다. 더 길고 추측하기 어려운 비밀번호로 다시 입력해 주세요.";
export const INVALID_EMAIL_MESSAGE = "사용할 수 없는 이메일 주소입니다. 이메일을 확인해 주세요.";
export const RATE_LIMITED_MESSAGE = "요청이 많아 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

function normalizeEmail(email: string): string {
  return email.replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toLowerCase();
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

function readErrorField(error: unknown, field: "code" | "message" | "status"): unknown {
  return error && typeof error === "object" ? (error as Record<string, unknown>)[field] : undefined;
}

// Supabase auth.admin.createUser()가 이미 가입된 이메일에 대해 내리는 email_exists/중복 에러를 구별해 낸다.
function isEmailAlreadyRegisteredError(error: unknown): boolean {
  const rawCode = readErrorField(error, "code");
  const rawMessage = readErrorField(error, "message");
  const code = typeof rawCode === "string" ? rawCode.toLowerCase() : "";
  const message = typeof rawMessage === "string" ? rawMessage.toLowerCase() : "";

  return (
    code === "email_exists" ||
    code === "user_already_exists" ||
    message.includes("already been registered") ||
    message.includes("already registered") ||
    message.includes("already exists")
  );
}

/**
 * createUser 오류를 허용 목록의 고정 문구로만 바꾼다. status가 4xx여도 원문(message)은 쓰지 않는다 -
 * Auth hook이나 DB 트리거가 돌려준 문구에 개인정보·내부 식별자가 섞일 수 있다.
 */
export function mapCreateUserError(error: unknown): SignupResult {
  if (isEmailAlreadyRegisteredError(error)) {
    return { status: 409, body: { error: EMAIL_EXISTS_MESSAGE, code: "email_exists" } };
  }

  const code = readErrorField(error, "code");
  const status = readErrorField(error, "status");

  if (code === "weak_password") {
    return { status: 400, body: { error: WEAK_PASSWORD_MESSAGE } };
  }
  if (code === "email_address_invalid") {
    return { status: 400, body: { error: INVALID_EMAIL_MESSAGE } };
  }
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || status === 429) {
    return { status: 429, body: { error: RATE_LIMITED_MESSAGE } };
  }

  return { status: 500, body: { error: SIGNUP_FAILED_MESSAGE } };
}

const FAILED: SignupResult = { status: 500, body: { error: SIGNUP_FAILED_MESSAGE } };

export async function runSignup(body: SignupRequestBody, deps: SignupDeps): Promise<SignupResult> {
  const { admin: supabase } = deps;
  const log = deps.log ?? logSafeAuthError;

  const role = normalizeRole(body.role);
  const primaryEmail = getString(body.email) || getString(body.companyEmail);
  const password = getString(body.password);
  const fullName = getString(body.name);

  if (!role || !primaryEmail || !password || !fullName) {
    return { status: 400, body: { error: "email, password, name, and role are required." } };
  }

  const email = normalizeEmail(primaryEmail);

  if (!isValidEmail(email)) {
    // Supabase Dashboard > Authentication > Providers > Email에서 Email provider가
    // 활성화되어 있는지, 허용/차단 도메인 설정이 가입 도메인을 막고 있지 않은지도 확인한다.
    return { status: 400, body: { error: "유효하지 않은 이메일 형식입니다. 공백이나 형식을 확인해주세요." } };
  }

  if (password.length < 8) {
    return { status: 400, body: { error: "Password must be at least 8 characters." } };
  }

  // 롤백 실패는 응답을 바꾸지 않지만, auth 사용자만 남는 고아 계정이 생기므로 고정 코드로 남긴다.
  const deleteAuthUser = async (userId: string): Promise<void> => {
    try {
      const { error } = await supabase.auth.admin.deleteUser(userId);
      if (error) log("SIGNUP_ROLLBACK_DELETE_USER_FAILED", error);
    } catch (e) {
      log("SIGNUP_ROLLBACK_DELETE_USER_FAILED", e);
    }
  };

  try {
    const { data: verification, error: verificationError } = await supabase
      .from("email_verifications")
      .select("id, is_verified, expires_at")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<VerificationRow>();

    if (verificationError) {
      log("SIGNUP_VERIFICATION_LOOKUP_FAILED", verificationError);
      return FAILED;
    }

    if (!verification?.is_verified || new Date(verification.expires_at).getTime() <= Date.now()) {
      const detail = !verification
        ? "No email verification record was found."
        : verification.is_verified
        ? "Email verification has expired."
        : "Email has not been verified.";
      log("SIGNUP_VERIFICATION_REQUIRED", new Error(detail));
      return { status: 400, body: { error: "Email verification is required.", detail } };
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
      log("SIGNUP_CREATE_USER_FAILED", authError);
      return mapCreateUserError(authError);
    }

    if (!authData.user?.id) {
      log("SIGNUP_CREATE_USER_NO_ID", new Error("createUser returned no user id"));
      return FAILED;
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
    const { error: profileError } = await supabase.from("profiles").insert(
      buildSignupProfileRow({
        userId,
        email,
        fullName,
        role: profileRole,
        phone: getString(body.phone),
        companyEmail: getString(body.companyEmail),
        brandId: getString(body.brandId) || getString(body.selectedBrandId),
      }),
    );

    if (profileError) {
      log("SIGNUP_PROFILE_INSERT_FAILED", profileError);
      await deleteAuthUser(userId);
      return FAILED;
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
          log("SIGNUP_STORE_APPROVAL_INSERT_FAILED", approvalError);
          try {
            const { error: profileDeleteError } = await supabase.from("profiles").delete().eq("id", userId);
            if (profileDeleteError) log("SIGNUP_ROLLBACK_PROFILE_DELETE_FAILED", profileDeleteError);
          } catch (e) {
            log("SIGNUP_ROLLBACK_PROFILE_DELETE_FAILED", e);
          }
          await deleteAuthUser(userId);
          return FAILED;
        }
      }
    }

    // HQ 계정은 가입 직후 별도 로그인 없이 온보딩으로 넘어가야 하므로 세션 쿠키를 바로 발급한다.
    // 로그인 실패는 계정 생성을 되돌리지 않고, 화면이 재로그인을 안내하도록 sessionEstablished로 구분한다.
    if (profileRole === "hq") {
      let sessionEstablished = false;

      if (deps.signInHq) {
        try {
          const { error: signInError } = await deps.signInHq(email, password);
          if (signInError) {
            log("SIGNUP_POST_SIGNIN_FAILED", signInError);
          } else {
            sessionEstablished = true;
          }
        } catch (e) {
          log("SIGNUP_POST_SIGNIN_FAILED", e);
        }
      }

      return { status: 201, body: { userId, role: profileRole, sessionEstablished } };
    }

    return { status: 201, body: { userId, role: profileRole } };
  } catch (error) {
    log("SIGNUP_UNEXPECTED", error);
    return FAILED;
  }
}
