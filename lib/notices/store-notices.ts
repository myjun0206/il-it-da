import type { SupabaseClient } from "@supabase/supabase-js";

// 매장 기준 본사 공지 조회 (직원 /api/staff/notices). 점주 /api/boss/notices와 같은 notices 테이블·같은 범위 규칙이다.
// 호출 전에 반드시 "이 사용자가 storeId에 approved membership을 가졌는지" 서버에서 검증해야 한다.
// 범위는 요청값이 아니라 stores.franchise_id(서버 조회값)로만 정한다:
//   해당 프랜차이즈의 "전체 지점" 공지 + "이 매장" 대상 공지. 다른 매장/다른 프랜차이즈 공지는 포함되지 않는다.

export type StoreNoticeRow = {
  id: string;
  target_type: "all" | "store";
  target_store_id: string | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string | null;
};

export type StoreNoticesResult = {
  franchiseName: string;
  rows: StoreNoticeRow[];
};

function isMissingNoticesTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export async function fetchNoticesForStore(adminClient: SupabaseClient, storeId: string): Promise<StoreNoticesResult> {
  const { data: store } = await adminClient
    .from("stores")
    .select("franchise_id")
    .eq("id", storeId)
    .maybeSingle<{ franchise_id: string | null }>();

  // 매장의 프랜차이즈를 확인할 수 없으면 다른 브랜드 공지가 섞이지 않도록 빈 목록(fail-closed)
  if (!store?.franchise_id) {
    return { franchiseName: "", rows: [] };
  }

  const [{ data: rows, error }, { data: franchise }] = await Promise.all([
    adminClient
      .from("notices")
      .select("id, target_type, target_store_id, title, content, created_at, updated_at")
      .eq("franchise_id", store.franchise_id)
      .or(`target_type.eq.all,target_store_id.eq.${storeId}`)
      .order("created_at", { ascending: false }),
    adminClient.from("franchises").select("name").eq("id", store.franchise_id).maybeSingle<{ name: string }>(),
  ]);

  if (error) {
    // migration 021(notices 테이블)이 아직 적용되지 않은 환경에서는 공지가 없는 것으로 본다.
    if (isMissingNoticesTable(error)) return { franchiseName: franchise?.name ?? "", rows: [] };
    throw error;
  }

  return { franchiseName: franchise?.name ?? "", rows: (rows ?? []) as StoreNoticeRow[] };
}
