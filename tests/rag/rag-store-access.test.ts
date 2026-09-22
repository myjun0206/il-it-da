import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  authorizeRagStoreAccess,
  isApprovedStaffMembership,
  runAuthorizedRagStoreOperation,
  type RagStoreAccessDependencies,
} from "../../lib/rag/rag-store-access.ts";

function dependencies(
  getCurrentUserId: RagStoreAccessDependencies["getCurrentUserId"],
  hasApprovedStaffMembership: RagStoreAccessDependencies["hasApprovedStaffMembership"],
): RagStoreAccessDependencies {
  return { getCurrentUserId, hasApprovedStaffMembership };
}

describe("authorizeRagStoreAccess", () => {
  test("returns UNAUTHENTICATED when no current user exists", async () => {
    const result = await authorizeRagStoreAccess("store-a", dependencies(
      async () => null,
      async () => true,
    ));

    assert.equal(result.status, "UNAUTHENTICATED");
  });

  test("returns UNAUTHENTICATED when current user lookup fails", async () => {
    const result = await authorizeRagStoreAccess("store-a", dependencies(
      async () => { throw new Error("authentication lookup failure"); },
      async () => true,
    ));

    assert.equal(result.status, "UNAUTHENTICATED");
  });

  test("returns FORBIDDEN when no membership exists", async () => {
    const result = await authorizeRagStoreAccess("store-a", dependencies(
      async () => "current-user",
      async () => false,
    ));

    assert.equal(result.status, "FORBIDDEN");
  });

  test("returns FORBIDDEN for pending membership", async () => {
    const result = await authorizeRagStoreAccess("store-a", dependencies(
      async () => "current-user",
      async () => false,
    ));

    assert.equal(result.status, "FORBIDDEN");
  });

  test("returns FORBIDDEN for rejected membership", async () => {
    const result = await authorizeRagStoreAccess("store-a", dependencies(
      async () => "current-user",
      async () => false,
    ));

    assert.equal(result.status, "FORBIDDEN");
  });

  test("returns FORBIDDEN for approved owner membership", async () => {
    const result = await authorizeRagStoreAccess("store-a", dependencies(
      async () => "current-user",
      async () => false,
    ));

    assert.equal(result.status, "FORBIDDEN");
  });

  test("returns FORBIDDEN for a membership for another store", async () => {
    const result = await authorizeRagStoreAccess("requested-store", dependencies(
      async () => "current-user",
      async (_userId, storeId) => storeId === "different-store",
    ));

    assert.equal(result.status, "FORBIDDEN");
  });

  test("returns AUTHORIZED only for approved staff membership at the requested store", async () => {
    const result = await authorizeRagStoreAccess("store-a", dependencies(
      async () => "current-user",
      async (userId, storeId) => userId === "current-user" && storeId === "store-a",
    ));

    assert.equal(result.status, "AUTHORIZED");
  });

  test("maps membership lookup errors to FORBIDDEN without exposing raw error details", async () => {
    const result = await authorizeRagStoreAccess("store-a", dependencies(
      async () => "current-user",
      async () => { throw new Error("database detail that must not leak"); },
    ));

    assert.deepEqual(result, { status: "FORBIDDEN" });
    assert.equal(JSON.stringify(result).includes("database detail"), false);
  });
});

describe("isApprovedStaffMembership", () => {
  const userId = "current-user";
  const storeId = "store-a";

  test("rejects missing, pending, rejected, and approved owner memberships", () => {
    assert.equal(isApprovedStaffMembership(null, userId, storeId), false);
    assert.equal(isApprovedStaffMembership(
      { user_id: userId, store_id: storeId, role: "staff", status: "pending" },
      userId,
      storeId,
    ), false);
    assert.equal(isApprovedStaffMembership(
      { user_id: userId, store_id: storeId, role: "staff", status: "rejected" },
      userId,
      storeId,
    ), false);
    assert.equal(isApprovedStaffMembership(
      { user_id: userId, store_id: storeId, role: "owner", status: "approved" },
      userId,
      storeId,
    ), false);
  });

  test("rejects a membership for another user or store", () => {
    assert.equal(isApprovedStaffMembership(
      { user_id: "another-user", store_id: storeId, role: "staff", status: "approved" },
      userId,
      storeId,
    ), false);
    assert.equal(isApprovedStaffMembership(
      { user_id: userId, store_id: "other-store", role: "staff", status: "approved" },
      userId,
      storeId,
    ), false);
  });

  test("accepts only an approved staff membership for the current user and requested store", () => {
    assert.equal(isApprovedStaffMembership(
      { user_id: userId, store_id: storeId, role: "staff", status: "approved" },
      userId,
      storeId,
    ), true);
  });
});

describe("runAuthorizedRagStoreOperation", () => {
  test("does not call the search operation for unauthenticated or forbidden access", async () => {
    let calls = 0;
    const searchWriter = async () => {
      calls += 1;
      return "search-result";
    };

    const unauthenticated = await runAuthorizedRagStoreOperation(
      "store-a",
      dependencies(async () => null, async () => true),
      searchWriter,
    );
    const forbidden = await runAuthorizedRagStoreOperation(
      "store-a",
      dependencies(async () => "current-user", async () => false),
      searchWriter,
    );

    assert.equal(unauthenticated.authorization.status, "UNAUTHENTICATED");
    assert.equal(forbidden.authorization.status, "FORBIDDEN");
    assert.equal(calls, 0);
  });

  test("calls the search operation exactly once for authorized access", async () => {
    let calls = 0;
    const result = await runAuthorizedRagStoreOperation(
      "store-a",
      dependencies(async () => "current-user", async () => true),
      async () => {
        calls += 1;
        return "search-result";
      },
    );

    assert.equal(result.authorization.status, "AUTHORIZED");
    assert.equal(result.value, "search-result");
    assert.equal(calls, 1);
  });
});
