import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseBrowserCookies,
  serializeBrowserCookie,
  SUPABASE_SESSION_COOKIE_OPTIONS,
} from "@/lib/supabase/session-cookies";

export function createClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase browser environment variables.");
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: SUPABASE_SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return parseBrowserCookies(document.cookie);
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          document.cookie = serializeBrowserCookie(name, value, options);
        });
      },
    },
  });
}