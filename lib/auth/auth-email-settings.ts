/**
 * Supabase Auth 공개 설정(/auth/v1/settings)을 읽어 이메일 인증번호 가입이 가능한지 판단한다.
 * - emailEnabled: 이메일/비밀번호 로그인 공급자가 켜져 있는지
 * - autoconfirm: "Confirm email"이 꺼져 있어 가입 즉시 인증 완료로 처리되는지
 * - signupDisabled: 신규 가입 자체가 막혀 있는지
 * 설정을 읽지 못하면 null을 반환하고, 호출부는 안전하게(가입 차단) 처리한다.
 */
export type AuthEmailSettings = {
  emailEnabled: boolean;
  autoconfirm: boolean;
  signupDisabled: boolean;
};

export type AuthEmailSettingsFetcher = () => Promise<AuthEmailSettings | null>;

export function parseAuthEmailSettings(payload: unknown): AuthEmailSettings | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const external = record.external as Record<string, unknown> | undefined;
  if (typeof record.mailer_autoconfirm !== "boolean" || !external || typeof external.email !== "boolean") {
    return null;
  }

  return {
    emailEnabled: external.email,
    autoconfirm: record.mailer_autoconfirm,
    signupDisabled: record.disable_signup === true,
  };
}

export const fetchAuthEmailSettings: AuthEmailSettingsFetcher = async () => {
  if (process.env.OWNER_STAFF_EMAIL_OTP_READY !== "true") return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: { apikey: supabaseAnonKey },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const value = parseAuthEmailSettings(await response.json());
    if (!value) return null;
    return value;
  } catch {
    return null;
  }
};
