import type { SupabaseClient } from "@supabase/supabase-js";

export type StoreManualAccess = {
  franchiseId: string | null;
  brandName: string;
};

export async function resolveStoreManualAccess(
  adminClient: SupabaseClient,
  userId: string,
  storeId: string,
  options: { allowHqRead?: boolean } = {},
): Promise<StoreManualAccess | null> {
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role, brand_id")
    .eq("id", userId)
    .maybeSingle<{ role: string; brand_id: string | null }>();

  const { data: store } = await adminClient
    .from("stores")
    .select("franchise_id")
    .eq("id", storeId)
    .maybeSingle<{ franchise_id: string | null }>();

  if (!profile || !store) return null;

  if (profile.role === "hq") {
    if (
      !options.allowHqRead ||
      !profile.brand_id ||
      store.franchise_id !== profile.brand_id
    ) {
      return null;
    }
  } else if (profile.role === "owner") {
    const { data: membership } = await adminClient
      .from("store_memberships")
      .select("id")
      .eq("user_id", userId)
      .eq("store_id", storeId)
      .eq("role", "owner")
      .eq("status", "approved")
      .maybeSingle<{ id: string }>();

    if (!membership) return null;
  } else {
    return null;
  }

  const franchiseId = store.franchise_id ?? profile.brand_id;
  let brandName = "본사";
  if (franchiseId) {
    const { data: franchise } = await adminClient
      .from("franchises")
      .select("name")
      .eq("id", franchiseId)
      .maybeSingle<{ name: string }>();
    if (franchise?.name) brandName = franchise.name;
  }

  return { franchiseId, brandName };
}