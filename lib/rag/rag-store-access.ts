export type RagStoreAuthorizationStatus =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "AUTHORIZED";

export type RagStoreAuthorization = {
  status: RagStoreAuthorizationStatus;
};

export type RagStoreAccessDependencies = {
  getCurrentUserId: () => Promise<string | null>;
  hasApprovedStaffMembership: (userId: string, storeId: string) => Promise<boolean>;
};

export type RagStoreMembershipRow = {
  user_id: unknown;
  store_id: unknown;
  role: unknown;
  status: unknown;
};

export function isApprovedStaffMembership(
  membership: RagStoreMembershipRow | null,
  userId: string,
  storeId: string,
): boolean {
  return membership?.user_id === userId
    && membership.store_id === storeId
    && membership.role === "staff"
    && membership.status === "approved";
}

export async function authorizeRagStoreAccess(
  storeId: string,
  dependencies: RagStoreAccessDependencies,
): Promise<RagStoreAuthorization> {
  let userId: string | null;

  try {
    userId = await dependencies.getCurrentUserId();
  } catch {
    return { status: "UNAUTHENTICATED" };
  }

  if (!userId) {
    return { status: "UNAUTHENTICATED" };
  }

  try {
    const authorized = await dependencies.hasApprovedStaffMembership(userId, storeId);
    return { status: authorized ? "AUTHORIZED" : "FORBIDDEN" };
  } catch {
    return { status: "FORBIDDEN" };
  }
}

export async function runAuthorizedRagStoreOperation<T>(
  storeId: string,
  dependencies: RagStoreAccessDependencies,
  operation: () => Promise<T>,
): Promise<{ authorization: RagStoreAuthorization; value?: T }> {
  const authorization = await authorizeRagStoreAccess(storeId, dependencies);

  if (authorization.status !== "AUTHORIZED") {
    return { authorization };
  }

  return { authorization, value: await operation() };
}
