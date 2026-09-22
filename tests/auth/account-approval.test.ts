import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { deriveAccountApprovalStatus } from "../../lib/auth/account-approval.ts";

describe("deriveAccountApprovalStatus", () => {
  test("HQ accounts are immediately available", () => {
    assert.equal(deriveAccountApprovalStatus("hq", []), "approved");
  });

  test("new owner and staff accounts have no implicit approval", () => {
    assert.equal(deriveAccountApprovalStatus("owner", []), "not_requested");
    assert.equal(deriveAccountApprovalStatus("staff", []), "not_requested");
  });

  test("pending membership remains pending", () => {
    assert.equal(deriveAccountApprovalStatus("owner", ["pending"]), "pending");
  });

  test("an approved membership takes precedence over pending or rejected ones", () => {
    assert.equal(
      deriveAccountApprovalStatus("owner", ["rejected", "pending", "approved"]),
      "approved",
    );
  });

  test("pending takes precedence over rejected when no membership is approved", () => {
    assert.equal(deriveAccountApprovalStatus("staff", ["rejected", "pending"]), "pending");
  });
});