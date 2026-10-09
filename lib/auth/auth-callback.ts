export const AUTH_CALLBACK_PATH = "/auth/callback";
export const DEFAULT_AUTH_NEXT_PATH = "/signup/complete";

const ALLOWED_AUTH_NEXT_PATHS = new Set([
  "/signup/complete",
  "/signup/profile",
  "/signup/stores",
  "/signup/approval",
  "/signup/approval-status",
]);
const AUTH_QUERY_PARAMS = ["code", "token_hash", "type"] as const;

export function getOAuthErrorMessage(code: unknown): string {
  switch (code) {
    case "cancelled": return "SNS 로그인이 취소되었습니다. 다시 로그인할 수 있습니다.";
    case "provider_failed": return "SNS 인증을 완료하지 못했습니다. 다시 시도해주세요. (provider_failed)";
    case "exchange_failed": return "로그인 인증이 만료되었거나 확인되지 않았습니다. 로그인을 다시 시작해주세요. (exchange_failed)";
    case "profile_failed": return "계정 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요. (profile_failed)";
    case "user_failed": return "로그인 세션을 확인하지 못했습니다. 로그인을 다시 시작해주세요. (user_failed)";
    case "OAUTH_START_FAILED": return "SNS 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해주세요. (OAUTH_START_FAILED)";
    case "OAUTH_REDIRECT_INVALID": return "SNS 로그인 연결을 확인하지 못했습니다. (OAUTH_REDIRECT_INVALID)";
    default: return "SNS 로그인을 완료하지 못했습니다. 다시 시도해주세요.";
  }
}

export function getSafeAuthNextPath(value: string | null): string {
  if (!value) return DEFAULT_AUTH_NEXT_PATH;

  try {
    const baseUrl = new URL("http://auth-callback.local");
    const destination = new URL(value, baseUrl);

    if (
      destination.origin !== baseUrl.origin ||
      !ALLOWED_AUTH_NEXT_PATHS.has(destination.pathname)
    ) {
      return DEFAULT_AUTH_NEXT_PATH;
    }

    return `${destination.pathname}${destination.search}`;
  } catch {
    return DEFAULT_AUTH_NEXT_PATH;
  }
}

export function buildAuthCallbackUrl(origin: string, nextPath: string): string {
  const callbackUrl = new URL(AUTH_CALLBACK_PATH, origin);
  callbackUrl.searchParams.set("next", getSafeAuthNextPath(nextPath));
  return callbackUrl.toString();
}

export function getCorrectedAuthCallbackUrl(requestUrl: URL): URL | null {
  if (!ALLOWED_AUTH_NEXT_PATHS.has(requestUrl.pathname)) return null;

  const hasVerificationParameter =
    requestUrl.searchParams.has("code") || requestUrl.searchParams.has("token_hash");
  if (!hasVerificationParameter) return null;

  const nextSearchParams = new URLSearchParams(requestUrl.searchParams);
  AUTH_QUERY_PARAMS.forEach((name) => nextSearchParams.delete(name));
  nextSearchParams.delete("next");

  const nextPath = `${requestUrl.pathname}${nextSearchParams.size ? `?${nextSearchParams}` : ""}`;
  const callbackUrl = new URL(AUTH_CALLBACK_PATH, requestUrl.origin);

  AUTH_QUERY_PARAMS.forEach((name) => {
    const value = requestUrl.searchParams.get(name);
    if (value) callbackUrl.searchParams.set(name, value);
  });
  callbackUrl.searchParams.set("next", nextPath);

  return callbackUrl;
}