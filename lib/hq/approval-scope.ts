/**
 * HQ 승인 큐의 franchise 범위 판정 (GET 목록 필터·PUT 승인 검증 공용).
 * store_memberships.franchise_id는 011 이전 행이나 on delete set null로 NULL일 수 있어 stores.franchise_id로 보완한다.
 * 어느 한쪽이라도 다른 franchise를 가리키면 불일치 데이터로 보고 제외한다(fail closed).
 */
export function isMembershipInHqFranchise(
  membershipFranchiseId: string | null | undefined,
  storeFranchiseId: string | null | undefined,
  hqFranchiseId: string | null | undefined,
): boolean {
  if (!hqFranchiseId) return false;
  if (membershipFranchiseId && membershipFranchiseId !== hqFranchiseId) return false;
  if (storeFranchiseId && storeFranchiseId !== hqFranchiseId) return false;
  return membershipFranchiseId === hqFranchiseId || storeFranchiseId === hqFranchiseId;
}

/** PostgREST or() 필터에 넣기 전 형식 검증용. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
