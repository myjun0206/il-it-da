export type MembershipRow = {
  user_id: unknown;
  store_id: unknown;
  role: unknown;
  status: unknown;
  [key: string]: unknown;
};

export type StoreRow = {
  id: unknown;
  store_name: unknown;
  [key: string]: unknown;
};

export type StaffStore = {
  id: string;
  name: string;
};

export type StaffStoresResult =
  | { status: 401; body: { error: "Unauthorized." } }
  | { status: 200; body: { stores: StaffStore[] } }
  | { status: 500; body: { error: "Unable to load approved stores." } };

export function unauthorizedStaffStoresResult(): StaffStoresResult {
  return { status: 401, body: { error: "Unauthorized." } };
}

export function failedStaffStoresResult(): StaffStoresResult {
  return { status: 500, body: { error: "Unable to load approved stores." } };
}

export function successfulStaffStoresResult(stores: StaffStore[]): StaffStoresResult {
  return { status: 200, body: { stores } };
}

export function filterApprovedStaffMemberships(
  memberships: readonly MembershipRow[],
  userId: string,
): string[] {
  return [...new Set(
    memberships
      .flatMap((membership) => {
        const storeId = membership.store_id;
        if (
          membership.user_id !== userId
          || membership.role !== "staff"
          || membership.status !== "approved"
          || typeof storeId !== "string"
          || storeId.trim().length === 0
        ) {
          return [];
        }

        return [storeId.trim()];
      }),
  )];
}

export function toStaffStores(
  storeIds: readonly string[],
  stores: readonly StoreRow[],
): StaffStore[] {
  const storesById = new Map<string, string>();

  for (const store of stores) {
    if (
      typeof store.id === "string"
      && typeof store.store_name === "string"
      && store.id.trim().length > 0
      && store.store_name.trim().length > 0
    ) {
      storesById.set(store.id, store.store_name.trim());
    }
  }

  return storeIds.flatMap((storeId) => {
    const name = storesById.get(storeId);
    return name ? [{ id: storeId, name }] : [];
  });
}
