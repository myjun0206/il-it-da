const SESSION_INVALIDATION_CODES = new Set([
  "refresh_token_not_found",
  "session_expired",
  "session_not_found",
]);

export const SESSION_EXPIRED_QUERY_PARAM = "session";
export const SESSION_EXPIRED_QUERY_VALUE = "expired";

export function isSupabaseSessionInvalidationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && SESSION_INVALIDATION_CODES.has(code);
}