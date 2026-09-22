const PUBLIC_AUTH_API_PREFIX = "/api/auth/";

export function shouldBypassProxyAuth(pathname: string): boolean {
  if (pathname.startsWith("/auth/")) return true;
  if (pathname === "/find-account") return true;

  return pathname.startsWith(PUBLIC_AUTH_API_PREFIX) && pathname !== "/api/auth/session";
}