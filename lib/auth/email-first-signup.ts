import type { AuthEmailSettingsFetcher } from "@/lib/auth/auth-email-settings";
import { createResearchConsent, requiredSignupConsent, RESEARCH_CONSENT_KEY } from "@/lib/auth/signup-research-consent";
import {
  isValidSignupEmail, normalizeSignupEmail, parseOwnerStaffRole, validateOwnerStaffSignup,
  normalizeSignupName, normalizeSignupPhone, mapAuthError, type OwnerStaffRole, type OtpResult,
} from "@/lib/auth/owner-staff-signup";

export const EMAIL_FIRST_OTP_LENGTH = 6;
export const EMAIL_FIRST_OTP_SECONDS = 180;
export type EmailFirstUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  identities?: Array<{ provider?: string }>;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};
type ProviderError = { code?: string; status?: number; message?: string } | null;
export type EmailFirstState = {
  kind: "new" | "resume" | "complete" | "legacy" | "exists" | "role_mismatch" | "unavailable" | "rate_limited";
  userId?: string;
  expiresAt?: number;
  retryAfterSeconds?: number;
  emailVerified?: boolean;
  requestId?: string;
};
export type PrepareEmailFirst = (email: string, role: OwnerStaffRole, action: "start" | "resend" | "sent" | "inspect" | "verify" | "complete", userId?: string, requestId?: string) => Promise<EmailFirstState>;
type Dependencies = { getSettings: AuthEmailSettingsFetcher; prepare: PrepareEmailFirst; now?: () => number };

function unavailable(): OtpResult {
  return { ok: false, status: 503, code: "EMAIL_OTP_UNAVAILABLE", error: "지금은 이메일 인증 가입을 이용할 수 없습니다. 관리자에게 문의해주세요." };
}
function rejected(error = "이 가입 정보로는 인증을 완료할 수 없습니다."): OtpResult {
  return { ok: false, status: 403, code: "VERIFICATION_REJECTED", error };
}
function invalidCode(): OtpResult {
  return { ok: false, status: 400, code: "CODE_INVALID", error: "인증번호가 틀립니다. 다시 확인해 주세요." };
}
function expiredCode(): OtpResult {
  return { ok: false, status: 400, code: "CODE_EXPIRED", error: "인증 시간이 만료되었습니다. 새 인증번호를 받아주세요." };
}
async function available(deps: Dependencies): Promise<boolean> {
  const settings = await deps.getSettings();
  return Boolean(settings?.emailEnabled && !settings.signupDisabled && !settings.autoconfirm);
}
function stateError(state: EmailFirstState): OtpResult | null {
  if (state.kind === "unavailable") return unavailable();
  if (state.kind === "rate_limited") return { ok: false, status: 429, code: "RATE_LIMITED", error: "잠시 후 인증번호를 다시 요청해주세요.", retryAfterSeconds: state.retryAfterSeconds ?? 60 };
  if (state.kind === "role_mismatch") return { ok: false, status: 409, code: "SIGNUP_ROLE_MISMATCH", error: "처음 선택한 역할로 가입을 진행해주세요." };
  if (state.kind === "exists" || state.kind === "complete" || state.kind === "legacy") return { ok: false, status: 409, code: "EMAIL_EXISTS", error: "이미 가입된 이메일입니다. 로그인해주세요." };
  return null;
}
export function emailFirstUserMatches(user: EmailFirstUser | null, email: string, role: OwnerStaffRole): user is EmailFirstUser {
  return Boolean(user?.email_confirmed_at && normalizeSignupEmail(user.email) === email &&
    user.app_metadata?.provider === "email" && parseOwnerStaffRole(user.user_metadata?.role) === role &&
    !user.identities?.some((identity) => identity.provider !== "email"));
}

export async function sendEmailFirstOtp(input: { email: unknown; role: unknown }, deps: Dependencies & {
  action: "start" | "resend";
  canResumeCompleted?: (userId: string, email: string, role: OwnerStaffRole) => Promise<boolean>;
  auth: { signInWithOtp: (input: { email: string; options: { shouldCreateUser: boolean; data?: Record<string, unknown> } }) => Promise<{ error: ProviderError }> };
}): Promise<OtpResult> {
  const email = normalizeSignupEmail(input.email);
  const role = parseOwnerStaffRole(input.role);
  if (!role || !isValidSignupEmail(email)) return { ok: false, status: 400, code: "INVALID_EMAIL", error: "올바른 이메일과 가입 역할을 확인해주세요." };
  if (!await available(deps)) return unavailable();
  const state = await deps.prepare(email, role, deps.action);
  if (state.kind === "complete" && state.userId &&
      await deps.canResumeCompleted?.(state.userId, email, role)) {
    return { ok: false, status: 409, code: "SIGNUP_INCOMPLETE", nextStep: "login",
      error: "가입 정보 제출은 완료되었습니다. 로그인 후 매장 신청을 이어가 주세요." };
  }
  const error = stateError(state);
  if (error) return error;
  // New reservations are intentionally closed until the provider confirms delivery.
  // Only the `sent` acknowledgement opens the server's 180-second verification window.
  if (!state.requestId || typeof state.expiresAt !== "number" ||
    (deps.action === "resend" && state.kind !== "resume")) return unavailable();
  const result = await deps.auth.signInWithOtp({ email, options: {
    shouldCreateUser: state.kind === "new",
    ...(state.kind === "new" ? { data: { role, signup_flow: "email_first" } } : {}),
  } });
  if (result.error) return mapAuthError(result.error, "send");
  const sent = await deps.prepare(email, role, "sent", undefined, state.requestId);
  if ((sent.kind !== "new" && sent.kind !== "resume") || !sent.expiresAt || sent.expiresAt <= (deps.now?.() ?? Date.now())) return unavailable();
  return { ok: true, status: 200, resumed: state.kind === "resume", cooldownSeconds: 60, expiresAt: sent.expiresAt };
}

export async function verifyEmailFirstOtp(input: { email: unknown; role: unknown; token: unknown }, deps: Dependencies & {
  auth: {
    verifyOtp: (input: { email: string; token: string; type: "email" }) => Promise<{ data: { user: EmailFirstUser | null; session: unknown }; error: ProviderError }>;
    getUser: (jwt: string) => Promise<{ data: { user: EmailFirstUser | null }; error: ProviderError }>;
    signOut: (input: { scope: "local" }) => Promise<unknown>;
  };
}): Promise<OtpResult> {
  const email = normalizeSignupEmail(input.email);
  const role = parseOwnerStaffRole(input.role);
  if (!role || !isValidSignupEmail(email) || typeof input.token !== "string" || !/^\d{6}$/.test(input.token)) return invalidCode();
  if (!await available(deps)) return unavailable();
  const state = await deps.prepare(email, role, "inspect");
  const error = stateError(state);
  if (error) return error;
  const now = deps.now?.() ?? Date.now();
  if (state.expiresAt !== undefined && state.expiresAt <= now) return expiredCode();
  if (state.kind !== "resume" || !state.userId || !state.requestId || !state.expiresAt) return invalidCode();
  const result = await deps.auth.verifyOtp({ email, token: input.token, type: "email" });
  if (result.error) {
    const mapped = mapAuthError(result.error, "verify");
    if (!mapped.ok && (mapped.code === "RATE_LIMITED" || mapped.code === "AUTH_UNAVAILABLE")) return mapped;
    const message = (result.error.message ?? "").toLowerCase();
    const ambiguous = (result.error.code === "otp_expired" && (!message || message.includes("invalid"))) ||
      /(?:token|otp|verification code)/.test(message) && message.includes("expired") && message.includes("invalid");
    const current = await deps.prepare(email, role, "inspect");
    if (current.kind === "unavailable") return unavailable();
    if (current.kind !== "resume" || current.requestId !== state.requestId || current.userId !== state.userId) {
      return rejected("인증 요청이 변경되었습니다. 가장 최근 인증번호를 확인해 주세요.");
    }
    if (!current.expiresAt) return unavailable();
    if (current.expiresAt <= (deps.now?.() ?? Date.now())) return expiredCode();
    return ambiguous ? invalidCode() : mapped;
  }
  const session = result.data.session as { access_token?: unknown; user?: { id?: unknown } } | null;
  if (!session || typeof session.access_token !== "string" || !session.access_token ||
    !emailFirstUserMatches(result.data.user, email, role) || result.data.user.id !== state.userId || session.user?.id !== state.userId) {
    await deps.auth.signOut({ scope: "local" });
    return rejected();
  }
  const validated = await deps.auth.getUser(session.access_token);
  if (validated.error || !emailFirstUserMatches(validated.data.user, email, role) || validated.data.user.id !== state.userId) {
    await deps.auth.signOut({ scope: "local" });
    return rejected();
  }
  const verified = await deps.prepare(email, role, "verify", validated.data.user.id, state.requestId);
  if (verified.kind !== "resume" || !verified.emailVerified || verified.userId !== result.data.user.id) {
    await deps.auth.signOut({ scope: "local" });
    if (state.expiresAt <= (deps.now?.() ?? Date.now())) return expiredCode();
    return rejected("인증 시간이 만료되었습니다. 인증번호를 다시 받아주세요.");
  }
  return { ok: true, status: 200, role, profileComplete: false };
}

export async function completeEmailFirstSignup(input: Record<string, unknown>, user: EmailFirstUser | null, deps: Dependencies & {
  auth: { updateUser: (input: { password?: string; data: Record<string, unknown> }) => Promise<{ error: ProviderError }> };
}): Promise<OtpResult> {
  const email = normalizeSignupEmail(input.email);
  const role = parseOwnerStaffRole(input.role);
  const fields = validateOwnerStaffSignup({ email, role, name: input.name, phone: input.phone, password: input.password, passwordConfirm: input.passwordConfirm, terms: input.terms });
  if (Object.keys(fields).length || !role) return { ok: false, status: 400, code: "INVALID_REQUEST", error: "가입 정보를 확인해주세요.", fields };
  if (!emailFirstUserMatches(user, email, role)) return rejected("이메일 인증이 확인된 세션이 필요합니다.");
  if (!await available(deps)) return unavailable();
  const state = await deps.prepare(email, role, "inspect");
  if (state.kind === "complete" && state.userId === user.id) {
    return { ok: true, status: 200, role, profileComplete: true };
  }
  if (state.kind !== "resume" || state.userId !== user.id || !state.requestId || !state.emailVerified) return stateError(state) ?? rejected();
  const metadata = {
    name: normalizeSignupName(input.name), phone: normalizeSignupPhone(input.phone),
    signupTerms: requiredSignupConsent(input.terms),
    [RESEARCH_CONSENT_KEY]: createResearchConsent(input.researchConsent, new Date(deps.now?.() ?? Date.now())),
  };
  let updated = await deps.auth.updateUser({ password: input.password as string, data: metadata });
  if (updated.error?.code === "same_password") updated = await deps.auth.updateUser({ data: metadata });
  if (updated.error) {
    const mapped = mapAuthError(updated.error, "send");
    return !mapped.ok && mapped.code === "WEAK_PASSWORD" ? { ...mapped, fields: { password: mapped.error } } : mapped;
  }
  const completed = await deps.prepare(email, role, "complete", user.id, state.requestId);
  if (completed.kind !== "complete" || completed.userId !== user.id) return unavailable();
  return { ok: true, status: 200, role, profileComplete: true };
}