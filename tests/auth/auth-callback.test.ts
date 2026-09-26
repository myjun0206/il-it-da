import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildAuthCallbackUrl,
  getCorrectedAuthCallbackUrl,
  getSafeAuthNextPath,
} from "../../lib/auth/auth-callback.ts";

describe("auth callback URLs", () => {
  test("builds signup redirects through the server callback", () => {
    const result = new URL(buildAuthCallbackUrl("https://example.com", "/signup/stores"));

    assert.equal(result.origin, "https://example.com");
    assert.equal(result.pathname, "/auth/callback");
    assert.equal(result.searchParams.get("next"), "/signup/stores");
  });

  test("rejects external and unknown next destinations", () => {
    assert.equal(getSafeAuthNextPath("https://evil.example/path"), "/signup/complete");
    assert.equal(getSafeAuthNextPath("/admin"), "/signup/complete");
  });

  test("preserves approval flow destinations", () => {
    assert.equal(getSafeAuthNextPath("/signup/approval"), "/signup/approval");
    assert.equal(getSafeAuthNextPath("/signup/approval-status"), "/signup/approval-status");
  });

  test("moves a code received on a signup page back through the callback", () => {
    const result = getCorrectedAuthCallbackUrl(
      new URL("https://example.com/signup/stores?code=pkce-code&mode=add"),
    );

    assert.ok(result);
    assert.equal(result.pathname, "/auth/callback");
    assert.equal(result.searchParams.get("code"), "pkce-code");
    assert.equal(result.searchParams.get("next"), "/signup/stores?mode=add");
  });

  test("does not redirect ordinary signup page requests", () => {
    assert.equal(
      getCorrectedAuthCallbackUrl(new URL("https://example.com/signup/profile")),
      null,
    );
  });
});