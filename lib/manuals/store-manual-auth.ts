import type { SupabaseClient } from "@supabase/supabase-js";

// saveManualGroupsWithChunks/addItemsToManualGroup가 기대하는 HqAuthResult와 구조적으로 호환된다
// (userId, franchiseId, brandName) - 지점 매뉴얼도 같은 저장 로직을 그대로 재사용하기 위함.
export interface StoreManualAuthResult {
  userId: string;
  storeId: string;
  franchiseId: string | null;
  brandName: string;
}

/**
 * 호출자가 해당 store_id에 대해 승인된 owner 멤버십을 가지고 있는지 확인한다.
 * 지점 매뉴얼의 모든 조회/쓰기는 이 검증을 통과한 storeId로만 스코핑되어야 한다.
 */
export async function requireStoreOwner(
  adminClient: SupabaseClient,
  userId: string,
  storeId: string,
): Promise<StoreManualAuthResult | null> {
  const { data: membership, error: membershipError } = await adminClient
    .from("store_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("store_id", storeId)
    .eq("role", "owner")
    .eq("status", "approved")
    .maybeSingle<{ id: string }>();

  if (membershipError || !membership) {
    return null;
  }

  const { data: profile } = await adminClient
    .from("profiles")
    .select("brand_id")
    .eq("id", userId)
    .maybeSingle<{ brand_id: string | null }>();

  let franchiseId: string | null = null;
  let brandName = "매장";

  if (profile?.brand_id) {
    const { data: franchise } = await adminClient
      .from("franchises")
      .select("id, name")
      .eq("id", profile.brand_id)
      .maybeSingle<{ id: string; name: string }>();

    if (franchise) {
      franchiseId = franchise.id;
      brandName = franchise.name;
    }
  }

  return { userId, storeId, franchiseId, brandName };
}
