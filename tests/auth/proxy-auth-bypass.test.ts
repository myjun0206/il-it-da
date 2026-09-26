import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { shouldBypassProxyAuth } from "../../lib/auth/proxy-auth-bypass.ts";

describe("shouldBypassProxyAuth", () => {
  test("bypasses public authentication entry routes", () => {
    assert.equal(shouldBypassProxyAuth("/api/auth/login"), true);
    assert.equal(shouldBypassProxyAuth("/api/auth/signup"), true);
    assert.equal(shouldBypassProxyAuth("/auth/callback"), true);
    assert.equal(shouldBypassProxyAuth("/find-account"), true);
  });

  test("keeps session refresh enabled for protected and session-check routes", () => {
    assert.equal(shouldBypassProxyAuth("/api/auth/session"), false);
    assert.equal(shouldBypassProxyAuth("/api/store-manuals"), false);
    assert.equal(shouldBypassProxyAuth("/boss"), false);
  });
});