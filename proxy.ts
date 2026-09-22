import { NextResponse, type NextRequest } from "next/server";

import { getCorrectedAuthCallbackUrl } from "@/lib/auth/auth-callback";
import { shouldBypassProxyAuth } from "@/lib/auth/proxy-auth-bypass";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16: "middleware.ts" 파일 컨벤션은 폐지되었고 "proxy.ts"로 대체되었다.
export async function proxy(request: NextRequest) {
  const correctedCallbackUrl = getCorrectedAuthCallbackUrl(request.nextUrl);
  if (correctedCallbackUrl) {
    return NextResponse.redirect(correctedCallbackUrl);
  }

  if (shouldBypassProxyAuth(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    // 정적 파일/이미지/파비콘은 제외하고 나머지 모든 요청에서 세션을 갱신한다.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
