export type NoticeRole = "hq" | "owner" | "staff";
export type NoticeTargetType = "all" | "franchise" | "store";
export type NoticeAudience = "owner" | "all_members" | "staff";

export interface NoticeMembership {
  storeId: string;
  franchiseId: string | null;
  role: "owner" | "staff";
  status: string;
}

export interface NoticeScope {
  franchiseId: string;
  targetType: NoticeTargetType;
  targetStoreId: string | null;
  audience: NoticeAudience;
}

interface NoticeWriteAuthorization {
  role: NoticeRole;
  franchiseId: string | null;
  memberships: NoticeMembership[];
  scope: NoticeScope;
  targetStoreFranchiseId: string | null;
}

export function canCreateNotice({
  role,
  franchiseId,
  memberships,
  scope,
  targetStoreFranchiseId,
}: NoticeWriteAuthorization): boolean {
  if (role === "hq") {
    if (
      !franchiseId
      || scope.franchiseId !== franchiseId
      || (scope.audience !== "owner" && scope.audience !== "all_members")
    ) {
      return false;
    }

    if (scope.targetType === "store") {
      return Boolean(
        scope.targetStoreId
        && targetStoreFranchiseId
        && targetStoreFranchiseId === franchiseId,
      );
    }

    return (scope.targetType === "all" || scope.targetType === "franchise")
      && scope.targetStoreId === null;
  }

  if (
    role !== "owner"
    || scope.targetType !== "store"
    || scope.audience !== "staff"
    || !scope.targetStoreId
    || !targetStoreFranchiseId
    || scope.franchiseId !== targetStoreFranchiseId
  ) {
    return false;
  }

  return memberships.some((membership) =>
    membership.role === "owner"
    && membership.status === "approved"
    && membership.storeId === scope.targetStoreId
    && membership.franchiseId === targetStoreFranchiseId,
  );
}

export function canReadNotice(
  role: "owner" | "staff",
  memberships: NoticeMembership[],
  scope: NoticeScope,
): boolean {
  const audienceAllowed = role === "owner"
    ? scope.audience === "owner" || scope.audience === "all_members"
    : scope.audience === "staff" || scope.audience === "all_members";

  if (!audienceAllowed) return false;

  const targetIsValid = scope.targetType === "store"
    ? Boolean(scope.targetStoreId)
    : (scope.targetType === "all" || scope.targetType === "franchise")
      && scope.targetStoreId === null;

  if (!targetIsValid) return false;

  return memberships.some((membership) =>
    membership.status === "approved"
    && membership.role === role
    && membership.franchiseId === scope.franchiseId
    && (scope.targetType !== "store" || membership.storeId === scope.targetStoreId),
  );
}