import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** 요청 쿠키 세션과 분리된 일회용 client. 세션을 저장·자동 갱신하지 않는다. */
export function createPasswordVerificationClient(supabaseUrl: string, supabaseAnonKey: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * 비밀번호만 검증한다. 현재 로그인 세션(쿠키)은 바꾸지 않으며,
 * 검증 과정에서 생긴 세션은 즉시 폐기(scope: local)해 Auth에 남기지 않는다.
 */
export async function verifyPasswordWithIsolatedClient(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<boolean> {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;

  const { error: signOutError } = await client.auth.signOut({ scope: "local" });
  if (signOutError) {
    console.warn("[VERIFY_PASSWORD] Failed to revoke verification session:", signOutError.message);
  }
  return true;
}
