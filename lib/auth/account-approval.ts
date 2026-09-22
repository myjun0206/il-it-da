import type { SupabaseClient } from "@supabase/supabase-js";

export type AccountApprovalStatus = "approved" | "pending" | "rejected" | "not_requested";

type MembershipStatusRow = {
  status: "approved" | "pending" | "rejected";
};

export function deriveAccountApprovalStatus(
  role: string,
  statuses: readonly MembershipStatusRow["status"][],
): AccountApprovalStatus {
  if (role === "hq") return "approved";
  if (statuses.includes("approved")) return "approved";
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("rejected")) return "rejected";
  return "not_requested";
}

export async function getAccountApprovalStatus(
  adminClient: SupabaseClient,
  userId: string,
  role: string,
): Promise<AccountApprovalStatus> {
  if (role === "hq") return "approved";

  const { data, error } = await adminClient
    .from("store_memberships")
    .select("status")
    .eq("user_id", userId)
    .returns<MembershipStatusRow[]>();

  if (error) throw error;

  const statuses = data?.map((membership) => membership.status) ?? [];
  return deriveAccountApprovalStatus(role, statuses);
}