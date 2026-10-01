import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isSupabaseSessionInvalidationError,
  SESSION_EXPIRED_QUERY_PARAM,
  SESSION_EXPIRED_QUERY_VALUE,
} from "@/lib/auth/session-expiration";
import {
  isLegacySupabaseAuthCookie,
  SUPABASE_SESSION_COOKIE_OPTIONS,
  toSessionCookieOptions,
} from "@/lib/supabase/session-cookies";

function copyCookies(source: NextResponse, target: NextResponse): void {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
}

function expireLegacySupabaseCookies(request: NextRequest, response: NextResponse): void {
  request.cookies.getAll().forEach(({ name }) => {
    if (isLegacySupabaseAuthCookie(name)) {
      response.cookies.set(name, "", { path: "/", maxAge: 0, sameSite: "lax" });
    }
  });
}

/**
 * 매 요청마다 Supabase 세션 쿠키를 갱신한다. 이 갱신이 없으면 access token이 만료된 뒤
 * 클라이언트가 보낸 쿠키가 서버에서 계속 유효하지 않아 API 라우트가 401을 반환하게 된다.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: SUPABASE_SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, toSessionCookieOptions(value, options));
        });
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  // getUser()를 호출해야 만료된 access token이 refresh token으로 갱신되고,
  // 갱신된 쿠키가 setAll을 통해 response에 반영된다.
  const { error } = await supabase.auth.getUser();

  if (isSupabaseSessionInvalidationError(error) && request.nextUrl.pathname !== "/api/auth/login") {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // The session may already have been removed by Supabase Auth.
    }

    if (request.nextUrl.pathname.startsWith("/api/")) {
      const expiredResponse = NextResponse.json(
        { error: "세션이 만료되었습니다. 다시 로그인해 주세요.", code: "SESSION_EXPIRED" },
        { status: 401 },
      );
      copyCookies(response, expiredResponse);
      expireLegacySupabaseCookies(request, expiredResponse);
      return expiredResponse;
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/";
    loginUrl.search = "";
    loginUrl.searchParams.set(SESSION_EXPIRED_QUERY_PARAM, SESSION_EXPIRED_QUERY_VALUE);
    const redirectResponse = NextResponse.redirect(loginUrl);
    copyCookies(response, redirectResponse);
    expireLegacySupabaseCookies(request, redirectResponse);
    return redirectResponse;
  }

  expireLegacySupabaseCookies(request, response);
  return response;
}
