import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireStoreOwner } from "../../lib/manuals/store-manual-auth.ts";

type MembershipRow = { id: string; user_id: string; store_id: string; role: string; status: string };
type StoreRow = { id: string; franchise_id: string | null };
type FranchiseRow = { id: string; name: string };

// Fake Supabase client following the same chainable-mock convention as
// tests/rag/manual-indexing/persist-chunks.test.ts - only supports the exact `.from(table)
// .select(...).eq(...).eq(...)...maybeSingle()` chain shapes requireStoreOwner actually calls.
function fakeSupabase(options: {
  memberships?: MembershipRow[];
  stores?: StoreRow[];
  franchises?: FranchiseRow[];
}): SupabaseClient {
  const memberships = options.memberships ?? [];
  const stores = options.stores ?? [];
  const franchises = options.franchises ?? [];

  function membershipQuery() {
    const filters: Record<string, unknown> = {};
    const query = {
      eq(column: string, value: unknown) {
        filters[column] = value;
        return query;
      },
      maybeSingle() {
        const match = memberships.find(
          (m) =>
            m.user_id === filters.user_id &&
            m.store_id === filters.store_id &&
            m.role === filters.role &&
            m.status === filters.status,
        );
        return Promise.resolve({ data: match ?? null, error: null });
      },
    };
    return query;
  }

  function storeQuery() {
    let idFilter: unknown;
    const query = {
      eq(_column: string, value: unknown) {
        idFilter = value;
        return query;
      },
      maybeSingle() {
        const match = stores.find((s) => s.id === idFilter);
        return Promise.resolve({ data: match ?? null, error: null });
      },
    };
    return query;
  }

  function franchiseQuery() {
    let idFilter: unknown;
    const query = {
      eq(_column: string, value: unknown) {
        idFilter = value;
        return query;
      },
      maybeSingle() {
        const match = franchises.find((f) => f.id === idFilter);
        return Promise.resolve({ data: match ?? null, error: null });
      },
    };
    return query;
  }

  return {
    from(table: string) {
      if (table === "store_memberships") {
        return { select: () => membershipQuery() };
      }
      if (table === "stores") {
        return { select: () => storeQuery() };
      }
      if (table === "franchises") {
        return { select: () => franchiseQuery() };
      }
      throw new Error(`Unexpected table in fake Supabase client: ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("requireStoreOwner (existing store-manual auth function, reused as-is)", () => {
  test("returns storeAuth using the target store's own stores.franchise_id (not profile.brand_id)", async () => {
    const client = fakeSupabase({
      memberships: [{ id: "m1", user_id: "user-1", store_id: "store-1", role: "owner", status: "approved" }],
      stores: [{ id: "store-1", franchise_id: "franchise-1" }],
      franchises: [{ id: "franchise-1", name: "테스트 프랜차이즈" }],
    });

    const result = await requireStoreOwner(client, "user-1", "store-1");
    assert.deepEqual(result, {
      userId: "user-1",
      storeId: "store-1",
      franchiseId: "franchise-1",
      brandName: "테스트 프랜차이즈",
    });
  });

  test("fails closed (null) for a pending membership (not yet approved)", async () => {
    const client = fakeSupabase({
      memberships: [{ id: "m1", user_id: "user-1", store_id: "store-1", role: "owner", status: "pending" }],
    });
    assert.equal(await requireStoreOwner(client, "user-1", "store-1"), null);
  });

  test("fails closed (null) for a rejected membership", async () => {
    const client = fakeSupabase({
      memberships: [{ id: "m1", user_id: "user-1", store_id: "store-1", role: "owner", status: "rejected" }],
    });
    assert.equal(await requireStoreOwner(client, "user-1", "store-1"), null);
  });

  test("fails closed (null) when the storeId belongs to a different owner", async () => {
    const client = fakeSupabase({
      memberships: [{ id: "m1", user_id: "user-2", store_id: "store-1", role: "owner", status: "approved" }],
    });
    assert.equal(await requireStoreOwner(client, "user-1", "store-1"), null);
  });

  test("fails closed (null) when the user has no membership at all for that store", async () => {
    const client = fakeSupabase({ memberships: [] });
    assert.equal(await requireStoreOwner(client, "user-1", "store-1"), null);
  });

  test("fails closed (null) when the requested storeId differs from the store the owner is approved for", async () => {
    const client = fakeSupabase({
      memberships: [{ id: "m1", user_id: "user-1", store_id: "store-1", role: "owner", status: "approved" }],
      stores: [
        { id: "store-1", franchise_id: "franchise-1" },
        { id: "store-2", franchise_id: "franchise-2" },
      ],
      franchises: [
        { id: "franchise-1", name: "브랜드 A" },
        { id: "franchise-2", name: "브랜드 B" },
      ],
    });
    assert.equal(await requireStoreOwner(client, "user-1", "store-2"), null);
  });

  test("never reads profiles (profile brand_id cannot override the store's franchise_id)", async () => {
    // fakeSupabase throws on any table it does not model, so a profiles query would fail this test.
    const client = fakeSupabase({
      memberships: [{ id: "m1", user_id: "user-1", store_id: "store-1", role: "owner", status: "approved" }],
      stores: [{ id: "store-1", franchise_id: "franchise-1" }],
      franchises: [{ id: "franchise-1", name: "브랜드 A" }],
    });
    const result = await requireStoreOwner(client, "user-1", "store-1");
    assert.equal(result?.franchiseId, "franchise-1");
    assert.equal(result?.brandName, "브랜드 A");
  });

  test("fails closed (null) when the store's franchise_id is null (unbackfilled/legacy store)", async () => {
    const client = fakeSupabase({
      memberships: [{ id: "m1", user_id: "user-1", store_id: "store-1", role: "owner", status: "approved" }],
      stores: [{ id: "store-1", franchise_id: null }],
    });
    assert.equal(await requireStoreOwner(client, "user-1", "store-1"), null);
  });

  test("fails closed (null) when the store row itself cannot be found", async () => {
    const client = fakeSupabase({
      memberships: [{ id: "m1", user_id: "user-1", store_id: "store-1", role: "owner", status: "approved" }],
      stores: [],
    });
    assert.equal(await requireStoreOwner(client, "user-1", "store-1"), null);
  });

  test("fails closed (null) when the store's franchise_id points at a franchise that can't be looked up", async () => {
    const client = fakeSupabase({
      memberships: [{ id: "m1", user_id: "user-1", store_id: "store-1", role: "owner", status: "approved" }],
      stores: [{ id: "store-1", franchise_id: "franchise-missing" }],
      franchises: [],
    });
    assert.equal(await requireStoreOwner(client, "user-1", "store-1"), null);
  });

  test("an owner with memberships at multiple approved stores is authorized for each store independently, using each store's own franchise_id", async () => {
    const client = fakeSupabase({
      memberships: [
        { id: "m1", user_id: "user-1", store_id: "store-1", role: "owner", status: "approved" },
        { id: "m2", user_id: "user-1", store_id: "store-2", role: "owner", status: "approved" },
      ],
      stores: [
        { id: "store-1", franchise_id: "franchise-1" },
        { id: "store-2", franchise_id: "franchise-2" },
      ],
      franchises: [
        { id: "franchise-1", name: "브랜드 A" },
        { id: "franchise-2", name: "브랜드 B" },
      ],
    });

    const first = await requireStoreOwner(client, "user-1", "store-1");
    const second = await requireStoreOwner(client, "user-1", "store-2");
    assert.equal(first?.franchiseId, "franchise-1");
    assert.equal(second?.franchiseId, "franchise-2");
  });
});
