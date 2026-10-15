import type { SupabaseClient } from "@supabase/supabase-js";

export type StoreMembershipAccess = "ACTIVE" | "PENDING" | "UNLINKED" | "ERROR";

type MembershipStatusRow = { status: string };

export async function getStoreMembershipAccess(
  adminClient: SupabaseClient,
  userId: string,
): Promise<StoreMembershipAccess> {
  const { data: membershipData, error } = await adminClient
    .from("store_memberships")
    .select("status")
    .eq("user_id", userId);

  if (error) return "ERROR";
  const data = membershipData as MembershipStatusRow[] | null;
  if (data?.some((membership) => membership.status === "approved")) return "ACTIVE";
  if (data?.some((membership) => membership.status === "pending")) return "PENDING";
  return "UNLINKED";
}