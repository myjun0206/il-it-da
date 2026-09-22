import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headersToSet).forEach(([name, value]) => response.headers.set(name, value));

        // [SESSION_DEBUG] proxy가 이번 요청에서 갱신/세팅하는 쿠키 이름만 출력한다(값은 절대 출력하지 않는다).
        console.log("[SESSION_DEBUG][proxy.setAll]", request.nextUrl.pathname, cookiesToSet.map((c) => c.name));
      },
    },
  });

  // [SESSION_DEBUG] 이 요청이 들어올 때 이미 갖고 있던 sb-* 쿠키 이름만 출력한다(요청 시점 쿠키 스냅샷).
  const incomingAuthCookieNames = request.cookies.getAll()
    .map((c) => c.name)
    .filter((name) => name.startsWith("sb-"));
  console.log("[SESSION_DEBUG][proxy.incoming]", request.nextUrl.pathname, incomingAuthCookieNames);

  // 콜백 Route Handler가 PKCE code를 세션으로 교환하기 전에 getUser()를 호출하면
  // verifier 쿠키만 있는 정상 요청도 "Auth session missing"으로 기록된다.
  if (
    request.nextUrl.pathname === "/auth/callback" &&
    (request.nextUrl.searchParams.has("code") || request.nextUrl.searchParams.has("token_hash"))
  ) {
    return response;
  }

  const hasAuthSessionCookie = incomingAuthCookieNames.some(
    (name) => name.includes("-auth-token") && !name.includes("code-verifier"),
  );
  if (!hasAuthSessionCookie) {
    console.log("[SESSION_DEBUG][proxy.getUser]", request.nextUrl.pathname, {
      skipped: true,
      reason: "auth session cookie missing",
    });
    return response;
  }

  // getUser()를 호출해야 만료된 access token이 refresh token으로 갱신되고,
  // 갱신된 쿠키가 setAll을 통해 response에 반영된다.
  const { data: proxyUser, error: proxyUserError } = await supabase.auth.getUser();
  console.log("[SESSION_DEBUG][proxy.getUser]", request.nextUrl.pathname, {
    hasUser: Boolean(proxyUser.user),
    userId: proxyUser.user?.id ?? null,
    error: proxyUserError?.message ?? null,
  });

  return response;
}
