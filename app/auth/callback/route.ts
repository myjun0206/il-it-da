import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType, Session } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getSafeAuthNextPath } from "@/lib/auth/auth-callback";

const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  "email",
  "email_change",
  "invite",
  "magiclink",
  "recovery",
  "signup",
]);

function verificationFailedResponse(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/?error=verification_failed", request.url));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[AUTH_CALLBACK] Missing Supabase environment variables.");
    return verificationFailedResponse(request);
  }

  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const requestedOtpType = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const nextPath = getSafeAuthNextPath(request.nextUrl.searchParams.get("next"));
  const response = NextResponse.redirect(new URL(nextPath, request.url));
  response.headers.set("Cache-Control", "no-store");
  const writtenCookieNames = new Set<string>();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          writtenCookieNames.add(name);
          response.cookies.set(name, value, options);
        });
        Object.entries(headersToSet).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  try {
    let session: Session | null = null;

    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      session = data.session;
    } else if (tokenHash) {
      const otpType = requestedOtpType && ALLOWED_OTP_TYPES.has(requestedOtpType)
        ? requestedOtpType
        : "signup";
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
      if (error) throw error;
      session = data.session;
    } else {
      console.error("[AUTH_CALLBACK] Verification parameters are missing.");
      return verificationFailedResponse(request);
    }

    if (!session) {
      throw new Error("No session after authentication callback.");
    }

    const hasWrittenAuthCookie = [...writtenCookieNames].some(
      (name) => name.includes("-auth-token") && !name.includes("code-verifier"),
    );
    if (!hasWrittenAuthCookie) {
      throw new Error("Authentication callback did not write a session cookie.");
    }

    console.log("[AUTH_CALLBACK] Session established.", {
      userId: session.user.id,
      nextPath,
      cookieNames: [...writtenCookieNames],
    });
    return response;
  } catch (error) {
    console.error("[AUTH_CALLBACK] Verification failed:", error);
    return verificationFailedResponse(request);
  }
}