import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SUPABASE_SESSION_COOKIE_OPTIONS,
  isSupabaseSessionCookie,
} from "@/lib/supabase/session-cookies";
import { applySessionCookiePolicy, readSessionPolicy } from "@/lib/supabase/session-policy";

export async function createClient(loginOptions?: { rememberMe: boolean; acceptSession?: boolean }): Promise<SupabaseClient> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase server environment variables.");
  }

  const cookieStore = await cookies();
  const policy = readSessionPolicy(cookieStore.getAll());
  const rememberMe = loginOptions?.rememberMe ?? policy?.rememberMe ?? false;

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: SUPABASE_SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll().filter(({ name }) =>
          !isSupabaseSessionCookie(name) || loginOptions?.acceptSession || (!loginOptions && Boolean(policy)),
        );
      },
      setAll(cookiesToSet) {
        const staleCookies = loginOptions && !loginOptions.acceptSession && cookiesToSet.some(({ name, value }) => isSupabaseSessionCookie(name) && value)
          ? cookieStore.getAll().filter(({ name }) => isSupabaseSessionCookie(name) && !cookiesToSet.some((cookie) => cookie.name === name))
              .map(({ name }) => ({ name, value: "", options: { path: "/", maxAge: 0 } }))
          : [];
        const writes = applySessionCookiePolicy(cookieStore.getAll(), [...staleCookies, ...cookiesToSet], rememberMe);
        try {
          writes.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {}
      },
    },
  });
}