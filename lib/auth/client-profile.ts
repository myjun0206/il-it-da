import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { UserRole } from "@/lib/types/user";

export type AuthenticatedProfile = {
  user: User;
  role: UserRole;
};

export async function getAuthenticatedProfile(
  supabase: SupabaseClient,
): Promise<AuthenticatedProfile | null> {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle<{ role: string }>();

  if (
    profileError ||
    !profile ||
    (profile.role !== "hq" && profile.role !== "owner" && profile.role !== "staff")
  ) {
    return null;
  }

  return { user: userData.user, role: profile.role };
}