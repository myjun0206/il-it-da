import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 매장명(예: "버거킹 종로구청점")이 어느 프랜차이즈 소속인지 public.franchises 이름과
 * 대조해 자동으로 찾는다. 가장 긴 이름이 매칭되도록 정렬해 "BHC"/"BHC 치킨"처럼
 * 이름이 겹치는 브랜드가 있어도 더 구체적인 쪽을 우선 선택한다.
 */
export async function resolveFranchiseIdForStoreName(
  supabase: SupabaseClient,
  storeName: string,
): Promise<string | null> {
  const normalizedStoreName = storeName.trim().toLowerCase();

  if (!normalizedStoreName) {
    return null;
  }

  const { data: franchises, error } = await supabase
    .from("franchises")
    .select("id, name");

  if (error || !franchises) {
    return null;
  }

  const matches = (franchises as { id: string; name: string | null }[])
    // 이름이 비어있는(공백) franchise row는 제외한다 - 그대로 두면 모든 store가
    // `"anything".startsWith("")`에 걸려 이 브랜드로 잘못 몰리게 된다(브랜드 쏠림 버그).
    .filter((franchise) => {
      const normalizedFranchiseName = franchise.name?.trim().toLowerCase();
      return !!normalizedFranchiseName && normalizedStoreName.startsWith(normalizedFranchiseName);
    })
    .sort((a, b) => (b.name?.trim().length ?? 0) - (a.name?.trim().length ?? 0));

  return matches[0]?.id ?? null;
}
