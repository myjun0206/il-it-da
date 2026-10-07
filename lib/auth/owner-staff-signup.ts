import type { AuthEmailSettingsFetcher } from "@/lib/auth/auth-email-settings";

/**
 * 점주·직원 이메일/비밀번호 가입의 이메일 인증번호(OTP) 처리.
 * Supabase Auth의 비밀번호 가입 확인 메일("Confirm signup" 템플릿의 {{ .Token }})을 사용한다.
 * - start: signUp으로 미인증 계정 생성 + 인증번호 발송
 * - resend: 같은 이메일로 인증번호 재발송 (Supabase 서버 측 빈도 제한을 그대로 따른다)
 * - verify: verifyOtp(type "email")로 인증 → 세션 쿠키 발급
 * 비밀번호·인증번호·토큰은 어떤 경우에도 로그로 남기거나 응답에 포함하지 않는다.
 */

export type OwnerStaffRole = "owner" | "staff";

export type OtpErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_EMAIL"
  | "WEAK_PASSWORD"
  | "EMAIL_EXISTS"
  | "SIGNUP_ROLE_MISMATCH"
  | "RATE_LIMITED"
  | "EMAIL_SEND_FAILED"
  | "EMAIL_OTP_UNAVAILABLE"
  | "CODE_INVALID_OR_EXPIRED"
  | "VERIFICATION_REJECTED"
  | "SIGNUP_FAILED";

export type OtpResult =
  | { ok: true; status: 200; resumed?: boolean; cooldownSeconds?: number; role?: OwnerStaffRole }
  | { ok: false; status: number; code: OtpErrorCode; error: string; retryAfterSeconds?: number; fields?: Record<string, string> };

type AuthErrorLike = { code?: string; status?: number; message?: string; name?: string } | null;

type AuthUserLike = {
  id: string;
  email?: string | null;
  created_at?: string;
  email_confirmed_at?: string | null;
  confirmation_sent_at?: string | null;
  identities?: Array<{ provider?: string }> | null;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

export type SignUpAuthClient = {
  signUp(credentials: {
    email: string;
    password: string;
    options: { data: Record<string, unknown>; emailRedirectTo: string };
  }): Promise<{ data: { user: AuthUserLike | null; session: unknown | null }; error: AuthErrorLike }>;
  resend(credentials: {
    type: "signup";
    email: string;
    options: { emailRedirectTo: string };
  }): Promise<{ error: AuthErrorLike }>;
};

export type VerifyAuthClient = {
  verifyOtp(params: { email: string; token: string; type: "email" }): Promise<{
    data: { user: AuthUserLike | null; session: unknown | null };
    error: AuthErrorLike;
  }>;
  signOut(options: { scope: "local" }): Promise<unknown>;
};

export const DEFAULT_RESEND_COOLDOWN_SECONDS = 60;
export const SIGNUP_EMAIL_OTP_LENGTH = Number(process.env.NEXT_PUBLIC_SIGNUP_EMAIL_OTP_LENGTH ?? 6);
export function isValidSignupToken(value: unknown): value is string {
  return Number.isInteger(SIGNUP_EMAIL_OTP_LENGTH) && SIGNUP_EMAIL_OTP_LENGTH >= 6 &&
    SIGNUP_EMAIL_OTP_LENGTH <= 10 && typeof value === "string" &&
    new RegExp(`^\\d{${SIGNUP_EMAIL_OTP_LENGTH}}$`).test(value);
}
const SOCIAL_PROVIDERS = new Set(["google", "kakao", "apple", "custom:naver"]);

const MESSAGES: Record<OtpErrorCode, string> = {
  INVALID_REQUEST: "입력값을 확인해주세요.",
  INVALID_EMAIL: "올바른 이메일 주소를 입력해주세요.",
  WEAK_PASSWORD: "비밀번호가 보안 기준을 충족하지 않습니다. 더 길고 복잡한 비밀번호를 입력해주세요.",
  EMAIL_EXISTS: "이미 가입된 이메일입니다. 로그인하거나 비밀번호 찾기를 이용해주세요.",
  SIGNUP_ROLE_MISMATCH: "이 이메일은 다른 역할로 가입을 시작한 계정입니다. 처음 선택한 역할로 가입을 이어가 주세요.",
  RATE_LIMITED: "인증번호 요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.",
  EMAIL_SEND_FAILED: "인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해주세요.",
  EMAIL_OTP_UNAVAILABLE: "지금은 이메일 인증 가입을 이용할 수 없습니다. 관리자에게 문의해주세요.",
  CODE_INVALID_OR_EXPIRED: "인증번호가 올바르지 않거나 만료되었습니다. 다시 확인하거나 인증번호를 다시 받아주세요.",
  VERIFICATION_REJECTED: "이 가입 정보로는 인증을 완료할 수 없습니다. 처음부터 다시 진행해주세요.",
  SIGNUP_FAILED: "회원가입 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
};

function fail(status: number, code: OtpErrorCode, retryAfterSeconds?: number): OtpResult {
  return {
    ok: false,
    status,
    code,
    error: MESSAGES[code],
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}

export function normalizeSignupEmail(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toLowerCase() : "";
}

export function isValidSignupEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function hasRequiredSignupTerms(value: unknown, role: OwnerStaffRole): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const terms = value as Record<string, unknown>;
  return terms.service === true && terms.privacy === true &&
    terms[role === "owner" ? "store_connection" : "store_work"] === true;
}

export function validateOwnerStaffSignupProfile(input: { name: unknown; phone: unknown }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (typeof input.name !== "string" || input.name.trim().length < 2) errors.name = "이름은 2글자 이상이어야 합니다.";
  if (typeof input.phone !== "string" || input.phone.replace(/[^0-9]/g, "").length < 10) errors.phone = "올바른 연락처 형식이 아닙니다.";
  return errors;
}

export function validateOwnerStaffSignup(input: StartSignupInput): Record<string, string> {
  const errors = validateOwnerStaffSignupProfile(input);
  const role = parseOwnerStaffRole(input.role);
  if (!role) errors.role = "가입 역할을 다시 선택해주세요.";
  if (!isValidSignupEmail(normalizeSignupEmail(input.email))) errors.email = "올바른 이메일 주소를 입력해주세요.";
  if (typeof input.password !== "string" || input.password.length < 8) errors.password = "비밀번호는 8글자 이상이어야 합니다.";
  if (typeof input.passwordConfirm !== "string" || input.password !== input.passwordConfirm) errors.passwordConfirm = "비밀번호가 일치하지 않습니다.";
  if (role && !hasRequiredSignupTerms(input.terms, role)) errors.terms = "필수 약관에 동의해주세요.";
  return errors;
}

export function parseOwnerStaffRole(value: unknown): OwnerStaffRole | null {
  return value === "owner" || value === "staff" ? value : null;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasSocialIdentity(user: AuthUserLike): boolean {
  const provider = user.app_metadata?.provider;
  return (
    (typeof provider === "string" && SOCIAL_PROVIDERS.has(provider)) ||
    Boolean(user.identities?.some((identity) => identity.provider && SOCIAL_PROVIDERS.has(identity.provider)))
  );
}

function parseRetryAfter(message: string | undefined): number {
  const match = message?.match(/after (\d+) seconds?/i);
  const seconds = match ? Number(match[1]) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RESEND_COOLDOWN_SECONDS;
}

/** Supabase Auth 오류를 사용자에게 보여줄 안전한 코드로 바꾼다. (원문 메시지는 응답에 넣지 않는다) */
export function mapAuthError(error: NonNullable<AuthErrorLike>, context: "send" | "verify"): OtpResult {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();

  if (
    error.status === 429 ||
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    code === "over_sms_send_rate_limit" ||
    message.includes("security purposes") ||
    message.includes("rate limit")
  ) {
    return fail(429, "RATE_LIMITED", parseRetryAfter(error.message));
  }

  if (context === "verify") {
    if (code === "otp_expired" || code === "otp_disabled" || message.includes("expired") || message.includes("invalid")) {
      return fail(400, "CODE_INVALID_OR_EXPIRED");
    }
    return fail(error.status && error.status >= 500 ? 502 : 400, "CODE_INVALID_OR_EXPIRED");
  }

  if (code === "user_already_exists" || code === "email_exists" || message.includes("already registered")) {
    return fail(409, "EMAIL_EXISTS");
  }
  if (code === "weak_password") return fail(400, "WEAK_PASSWORD");
  if (code === "email_address_invalid" || code === "validation_failed") return fail(400, "INVALID_EMAIL");
  if (code === "signup_disabled" || code === "email_provider_disabled") return fail(503, "EMAIL_OTP_UNAVAILABLE");
  if (code === "email_address_not_authorized" || message.includes("sending") || (error.status ?? 0) >= 500) {
    return fail(503, "EMAIL_SEND_FAILED");
  }
  return fail(400, "SIGNUP_FAILED");
}

async function ensureOtpAvailable(getSettings: AuthEmailSettingsFetcher): Promise<OtpResult | null> {
  const settings = await getSettings();
  if (!settings || !settings.emailEnabled || settings.signupDisabled || settings.autoconfirm ||
      !Number.isInteger(SIGNUP_EMAIL_OTP_LENGTH) || SIGNUP_EMAIL_OTP_LENGTH < 6 || SIGNUP_EMAIL_OTP_LENGTH > 10) {
    // Confirm email이 꺼져 있으면 가입 즉시 인증 완료 처리되므로 인증번호 확인을 우회하게 된다. 열지 않는다.
    return fail(503, "EMAIL_OTP_UNAVAILABLE");
  }
  return null;
}

export type StartSignupInput = {
  email: unknown;
  password: unknown;
  passwordConfirm: unknown;
  terms: unknown;
  role: unknown;
  name: unknown;
  phone: unknown;
};

export type StartSignupDeps = {
  authClient: SignUpAuthClient;
  getSettings: AuthEmailSettingsFetcher;
  prepare: PrepareSignup;
  emailRedirectTo: string;
};

export type PrepareSignup = (
  email: string, role: OwnerStaffRole, action: "start" | "resend" | "inspect",
) => Promise<{ kind: "new" | "resume" } | { kind: "exists" | "role_mismatch" | "unavailable" } | { kind: "rate_limited"; retryAfterSeconds: number }>;

function preparationError(result: Awaited<ReturnType<PrepareSignup>>): OtpResult | null {
  if (result.kind === "exists") return fail(409, "EMAIL_EXISTS");
  if (result.kind === "role_mismatch") return fail(409, "SIGNUP_ROLE_MISMATCH");
  if (result.kind === "unavailable") return fail(503, "EMAIL_OTP_UNAVAILABLE");
  if (result.kind === "rate_limited") return fail(429, "RATE_LIMITED", result.retryAfterSeconds);
  return null;
}

export async function startOwnerStaffSignup(input: StartSignupInput, deps: StartSignupDeps): Promise<OtpResult> {
  const email = normalizeSignupEmail(input.email);
  const role = parseOwnerStaffRole(input.role);
  const name = cleanText(input.name);
  const phone = cleanText(input.phone);
  const password = typeof input.password === "string" ? input.password : "";

  const fields = validateOwnerStaffSignup(input);
  if (!role || Object.keys(fields).length) return { ...fail(400, "INVALID_REQUEST"), fields } as OtpResult;

  const unavailable = await ensureOtpAvailable(deps.getSettings);
  if (unavailable) return unavailable;

  const preparation = await deps.prepare(email, role, "start");
  const rejected = preparationError(preparation);
  if (rejected) return rejected;
  if (preparation.kind === "resume") {
    const { error } = await deps.authClient.resend({ type: "signup", email, options: { emailRedirectTo: deps.emailRedirectTo } });
    return error ? mapAuthError(error, "send") : { ok: true, status: 200, resumed: true, cooldownSeconds: DEFAULT_RESEND_COOLDOWN_SECONDS };
  }
  const { data, error } = await deps.authClient.signUp({
    email,
    password,
    options: { data: { role, name, phone, signupTerms: input.terms }, emailRedirectTo: deps.emailRedirectTo },
  });

  if (error) return mapAuthError(error, "send");

  const user = data.user;
  if (data.session || user?.email_confirmed_at) {
    return fail(503, "EMAIL_OTP_UNAVAILABLE");
  }

  if (!user) return fail(502, "SIGNUP_FAILED");

  // 이미 인증된 계정은 Supabase가 identities가 빈 가짜 사용자를 돌려준다(이메일 존재 여부 노출 방지).
  if (!user.identities || user.identities.length === 0) return fail(409, "EMAIL_EXISTS");

  if (hasSocialIdentity(user)) return fail(409, "EMAIL_EXISTS");

  return { ok: true, status: 200, resumed: false, cooldownSeconds: 300 };
}

export type ResendSignupDeps = {
  authClient: SignUpAuthClient;
  getSettings: AuthEmailSettingsFetcher;
  prepare: PrepareSignup;
  emailRedirectTo: string;
};

export async function resendOwnerStaffSignup(input: { email: unknown; role: unknown }, deps: ResendSignupDeps): Promise<OtpResult> {
  const email = normalizeSignupEmail(input.email);
  const role = parseOwnerStaffRole(input.role);
  if (!role) return fail(400, "INVALID_REQUEST");
  if (!isValidSignupEmail(email)) return fail(400, "INVALID_EMAIL");

  const unavailable = await ensureOtpAvailable(deps.getSettings);
  if (unavailable) return unavailable;

  const preparation = await deps.prepare(email, role, "resend");
  const rejected = preparationError(preparation);
  if (rejected) return rejected;
  if (preparation.kind !== "resume") return fail(400, "INVALID_REQUEST");

  const { error } = await deps.authClient.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: deps.emailRedirectTo },
  });
  if (error) return mapAuthError(error, "send");

  // 존재하지 않거나 이미 인증된 이메일이어도 Supabase는 성공처럼 응답한다(존재 여부 비노출).
  return { ok: true, status: 200, cooldownSeconds: DEFAULT_RESEND_COOLDOWN_SECONDS };
}

export type VerifySignupInput = { email: unknown; token: unknown; role: unknown };

export async function verifyOwnerStaffSignup(input: VerifySignupInput, deps: { authClient: VerifyAuthClient; getSettings: AuthEmailSettingsFetcher; prepare: PrepareSignup }): Promise<OtpResult> {
  const email = normalizeSignupEmail(input.email);
  const role = parseOwnerStaffRole(input.role);
  const token = input.token;

  if (!role) return fail(400, "INVALID_REQUEST");
  if (!isValidSignupEmail(email)) return fail(400, "INVALID_EMAIL");
  if (!isValidSignupToken(token)) return fail(400, "CODE_INVALID_OR_EXPIRED");

  const unavailable = await ensureOtpAvailable(deps.getSettings);
  if (unavailable) return unavailable;
  const preparation = await deps.prepare(email, role, "inspect");
  const rejected = preparationError(preparation);
  if (rejected) return rejected;
  if (preparation.kind !== "resume") return fail(403, "VERIFICATION_REJECTED");

  const { data, error } = await deps.authClient.verifyOtp({ email, token, type: "email" });
  if (error) return mapAuthError(error, "verify");

  const user = data.user;
  const valid =
    Boolean(data.session) &&
    user !== null &&
    normalizeSignupEmail(user.email) === email &&
    Boolean(user.email_confirmed_at) &&
    Boolean(user.confirmation_sent_at) &&
    !hasSocialIdentity(user) &&
    parseOwnerStaffRole(user.user_metadata?.role) === role;

  if (!valid) {
    // 다른 역할로 시작한 계정 등: 인증은 됐더라도 이 가입 흐름의 세션은 남기지 않는다.
    try {
      await deps.authClient.signOut({ scope: "local" });
    } catch {
      // 세션 정리 실패는 응답에 영향을 주지 않는다.
    }
    return fail(403, "VERIFICATION_REJECTED");
  }

  return { ok: true, status: 200, role };
}

export type MembershipAuthUser = AuthUserLike;

export function validateInitialEmailMembership(user: MembershipAuthUser, role: OwnerStaffRole, terms: unknown, expectedEmail: unknown): string | null {
  if (!isValidSignupEmail(normalizeSignupEmail(expectedEmail)) || normalizeSignupEmail(expectedEmail) !== normalizeSignupEmail(user.email)) return "이메일이 변경되었습니다. 이메일 인증을 다시 확인해주세요.";
  if (parseOwnerStaffRole(user.user_metadata?.role) !== role) return "가입 역할이 일치하지 않습니다.";
  if (!hasRequiredSignupTerms(terms, role)) return "필수 약관에 동의한 뒤 신청해주세요.";
  const profileErrors = validateOwnerStaffSignupProfile({ name: user.user_metadata?.name, phone: user.user_metadata?.phone });
  if (profileErrors.name) return "가입 정보의 이름을 확인해주세요.";
  if (profileErrors.phone) return "가입 정보의 연락처를 확인해주세요.";
  return null;
}

/**
 * 매장 신청(/api/signup/store-membership) 전에 이메일 가입자의 인증 상태를 서버에서 확인한다.
 * - 이메일 가입자는 email_confirmed_at이 있어야 한다.
 * - 프로필이 아직 없는(첫 신청) 이메일 가입자는 프로젝트가 Confirm email ON일 때만 허용한다.
 *   (OFF이면 가입 즉시 인증 완료로 표시되어 인증번호 확인을 거쳤다고 볼 수 없다)
 */
export async function checkEmailSignupConfirmation(
  user: MembershipAuthUser,
  options: { hasProfile: boolean; getSettings: AuthEmailSettingsFetcher },
): Promise<{ ok: true } | { ok: false; status: number; code: string; error: string }> {
  if (hasSocialIdentity(user) || user.app_metadata?.provider !== "email") return { ok: true };

  if (!user.email_confirmed_at) {
    return {
      ok: false,
      status: 403,
      code: "EMAIL_NOT_CONFIRMED",
      error: "이메일 인증이 완료되지 않았습니다. 회원가입에서 인증번호 확인을 먼저 완료해주세요.",
    };
  }

  if (!options.hasProfile) {
    const settings = await options.getSettings();
    if (!settings || !settings.emailEnabled || settings.signupDisabled || settings.autoconfirm || !user.confirmation_sent_at) {
      return {
        ok: false,
        status: 503,
        code: "EMAIL_OTP_UNAVAILABLE",
        error: MESSAGES.EMAIL_OTP_UNAVAILABLE,
      };
    }
  }

  return { ok: true };
}
