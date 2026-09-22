import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Supabase 이메일 인증(컨펌) 링크가 되돌아오는 콜백. URL의 PKCE `code`를 실제 세션으로
 * 교환해 쿠키에 안착시킨 뒤에만 다음 페이지로 이동시킨다. 이 라우트가 없으면 이메일 링크를
 * 눌러도 세션이 전혀 생성되지 않아 승인 화면에서 "세션을 확보하지 못했습니다"가 발생한다.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/signup/approval";

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=verification_failed`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[AUTH_CALLBACK] exchangeCodeForSession failed:", { name: error.name });
    return NextResponse.redirect(`${origin}/?error=verification_failed`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
