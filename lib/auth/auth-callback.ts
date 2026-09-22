export const AUTH_CALLBACK_PATH = "/auth/callback";
export const DEFAULT_AUTH_NEXT_PATH = "/signup/approval";

const ALLOWED_AUTH_NEXT_PATHS = new Set(["/signup/approval", "/signup/stores"]);
const AUTH_QUERY_PARAMS = ["code", "token_hash", "type"] as const;

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