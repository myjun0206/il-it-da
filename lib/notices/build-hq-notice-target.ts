export type HqNoticeTargetType = "all" | "store";
export type HqNoticeAudience = "owner" | "all_members";

export function buildHqNoticeTarget(
  targetType: HqNoticeTargetType,
  targetStoreId: string,
  audience: HqNoticeAudience,
) {
  if (targetType === "store") {
    return { targetType, targetStoreId, audience };
  }

  return { targetType, audience };
}