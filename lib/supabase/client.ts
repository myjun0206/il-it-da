import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseBrowserCookies,
  serializeBrowserCookie,
  SUPABASE_SESSION_COOKIE_OPTIONS,
  SESSION_MODE_COOKIE,
  isSupabaseSessionCookie,
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
      async setAll(cookiesToSet) {
        const rememberMe = parseBrowserCookies(document.cookie).some(({ name, value }) =>
          name === SESSION_MODE_COOKIE && value === "persistent",
        );
        cookiesToSet.forEach(({ name, value, options }) => {
          document.cookie = serializeBrowserCookie(name, value, options, rememberMe);
        });
        if (cookiesToSet.some(({ name }) => isSupabaseSessionCookie(name)) &&
            !parseBrowserCookies(document.cookie).some(({ name }) => isSupabaseSessionCookie(name))) {
          document.cookie = serializeBrowserCookie(SESSION_MODE_COOKIE, "", { path: "/", maxAge: 0 });
          await fetch("/api/auth/session", { method: "DELETE" });
        } else if (cookiesToSet.some(({ name, value }) => isSupabaseSessionCookie(name) && value)) {
          const response = await fetch("/api/auth/session", { method: "POST" });
          if (!response.ok) throw new Error("Could not establish browser session policy.");
        }
      },
    },
  });
}