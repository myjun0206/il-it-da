import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { UserRole } from "@/lib/types/user";

export type AuthenticatedProfile = {
  user: User;
  role: UserRole;
  approvalStatus: "pending" | "approved" | "rejected";
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
    .select("role, approval_status")
    .eq("id", userData.user.id)
    .maybeSingle<{ role: string; approval_status: string | null }>();

  if (
    profileError ||
    !profile ||
    (profile.role !== "hq" && profile.role !== "owner" && profile.role !== "staff")
  ) {
    return null;
  }

  const approvalStatus = profile.approval_status === "approved" || profile.approval_status === "rejected"
    ? profile.approval_status
    : "pending";

  return { user: userData.user, role: profile.role, approvalStatus };
}