import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface HqAuthResult {
  userId: string;
  franchiseId: string | null;
  brandName: string;
}

/**
 * 계정 생성 시점에 franchise_id가 기록되지 않은 레거시 계정을 위한 대체값.
 * (signup은 "{프랜차이즈명} {담당자명}" 형태로 이름을 저장하므로 첫 단어를 사용)
 */
function deriveBrandNameFromMetadata(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) {
    return "본사";
  }

  const [first] = name.trim().split(/\s+/);
  return first || "본사";
}

/**
 * Verifies the caller is logged in and has the "hq" role in public.profiles.
 * Resolves the brand name via public.franchises using profiles.brand_id.
 * Returns null when unauthorized so callers can respond with 401/403.
 */
export async function requireHqUser(): Promise<HqAuthResult | null> {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return null;
  }

  const adminClient = createAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role, brand_id")
    .eq("id", userData.user.id)
    .maybeSingle<{ role: string; brand_id: string | null }>();

  if (profileError || profile?.role !== "hq") {
    return null;
  }

  if (profile.brand_id) {
    const { data: franchise } = await adminClient
      .from("franchises")
      .select("id, name")
      .eq("id", profile.brand_id)
      .maybeSingle<{ id: string; name: string }>();

    if (franchise) {
      return {
        userId: userData.user.id,
        franchiseId: franchise.id,
        brandName: franchise.name,
      };
    }
  }

  return {
    userId: userData.user.id,
    franchiseId: null,
    brandName: deriveBrandNameFromMetadata(userData.user.user_metadata?.name),
  };
}
