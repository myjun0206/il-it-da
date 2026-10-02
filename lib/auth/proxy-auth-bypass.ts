const PUBLIC_AUTH_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/signup",
  "/auth/callback",
  "/find-account",
]);

export function shouldBypassProxyAuth(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.has(pathname);
}