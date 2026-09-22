import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  failedStaffStoresResult,
  filterApprovedStaffMemberships,
  successfulStaffStoresResult,
  toStaffStores,
  unauthorizedStaffStoresResult,
} from "../../lib/staff/approved-stores.ts";

const CURRENT_USER_ID = "current-user";

function membership(overrides: Record<string, unknown> = {}) {
  return {
    user_id: CURRENT_USER_ID,
    store_id: "store-a",
    role: "staff",
    status: "approved",
    ...overrides,
  };
}

describe("filterApprovedStaffMemberships", () => {
  test("keeps only the current user's approved staff memberships", () => {
    const storeIds = filterApprovedStaffMemberships([
      membership(),
      membership({ status: "pending", store_id: "pending-store" }),
      membership({ status: "rejected", store_id: "rejected-store" }),
      membership({ role: "owner", store_id: "owner-store" }),
      membership({ user_id: "other-user", store_id: "other-user-store" }),
    ], CURRENT_USER_ID);

    assert.deepEqual(storeIds, ["store-a"]);
  });

  test("deduplicates repeated approved memberships for the same store", () => {
    const storeIds = filterApprovedStaffMemberships([
      membership(),
      membership(),
    ], CURRENT_USER_ID);

    assert.deepEqual(storeIds, ["store-a"]);
  });

  test("returns an empty list when no membership is eligible", () => {
    const storeIds = filterApprovedStaffMemberships([
      membership({ status: "pending" }),
      membership({ role: "owner" }),
    ], CURRENT_USER_ID);

    assert.deepEqual(storeIds, []);
  });
});

describe("toStaffStores", () => {
  test("returns only id and name for stores referenced by approved memberships", () => {
    const stores = toStaffStores(
      ["store-a", "store-b"],
      [
        { id: "store-a", store_name: "Store A", boss_id: "internal" },
        { id: "store-b", store_name: "Store B", user_id: "internal" },
        { id: "unapproved-store", store_name: "Do Not Return" },
      ],
    );

    assert.deepEqual(stores, [
      { id: "store-a", name: "Store A" },
      { id: "store-b", name: "Store B" },
    ]);
    const serialized = JSON.stringify(stores);
    assert.equal(serialized.includes("boss_id"), false);
    assert.equal(serialized.includes("user_id"), false);
    assert.equal(serialized.includes("membership"), false);
  });

  test("omits missing or invalid store rows", () => {
    const stores = toStaffStores(
      ["store-a", "missing-store"],
      [{ id: "store-a", store_name: "Store A" }, { id: "missing-store", store_name: "" }],
    );

    assert.deepEqual(stores, [{ id: "store-a", name: "Store A" }]);
  });
});

describe("staff stores API results", () => {
  test("uses a fixed 401 response for unauthenticated users", () => {
    assert.deepEqual(unauthorizedStaffStoresResult(), {
      status: 401,
      body: { error: "Unauthorized." },
    });
  });

  test("returns a 200 empty stores array for users without approved staff membership", () => {
    assert.deepEqual(successfulStaffStoresResult([]), {
      status: 200,
      body: { stores: [] },
    });
  });

  test("uses a fixed 500 response without raw database details", () => {
    assert.deepEqual(failedStaffStoresResult(), {
      status: 500,
      body: { error: "Unable to load approved stores." },
    });
  });
});
