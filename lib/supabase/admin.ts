import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createAdminClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("Supabase admin client is only available on the server.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseSecretKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();

  if (!supabaseUrl || !supabaseSecretKey) {
    const missing = [
      !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
      !supabaseSecretKey && "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY",
    ].filter(Boolean);

    const message = `Missing Supabase admin environment variables: ${missing.join(", ")}. Set these in .env.local at the project root (or in the process environment), then restart the server. Never expose the admin key through NEXT_PUBLIC_ variables.`;
    console.error(`[Supabase configuration] ${message}`);
    throw new Error(message);
  }

  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
