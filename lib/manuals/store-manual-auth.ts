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
 *
 * franchiseId/brandName은 profiles.brand_id(가입 시 자가 입력값)가 아니라, 이 storeId가
 * 실제로 소속된 stores.franchise_id를 서버에서 조회해 결정한다. profile의 brand_id는
 * 오타/가입 오류 등으로 store의 실제 소속 브랜드와 어긋날 수 있어, 이를 신뢰하면
 * 다른 브랜드로 매뉴얼이 스코핑되는 데이터 범위 결함으로 이어진다. stores.franchise_id가
 * 없거나(011 이전 레거시/미백필 매장) 그 franchise를 조회할 수 없으면 fail-closed(null)한다.
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

  const { data: store, error: storeError } = await adminClient
    .from("stores")
    .select("franchise_id")
    .eq("id", storeId)
    .maybeSingle<{ franchise_id: string | null }>();

  if (storeError || !store || !store.franchise_id) {
    return null;
  }

  const { data: franchise, error: franchiseError } = await adminClient
    .from("franchises")
    .select("id, name")
    .eq("id", store.franchise_id)
    .maybeSingle<{ id: string; name: string }>();

  if (franchiseError || !franchise) {
    return null;
  }

  return { userId, storeId, franchiseId: franchise.id, brandName: franchise.name };
}
