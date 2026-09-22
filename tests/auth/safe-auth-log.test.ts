import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { logSafeAuthError } from "../../lib/auth/safe-auth-log.ts";

function captureConsoleError() {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      console.error = original;
    },
  };
}

describe("logSafeAuthError", () => {
  test("logs only the fixed code and a safe error name for an Error instance", () => {
    const capture = captureConsoleError();
    try {
      const secretDetail = "sensitive-detail-that-must-not-leak";
      logSafeAuthError("SEND_VERIFICATION_FAILED", new Error(secretDetail));

      assert.equal(capture.calls.length, 1);
      const serialized = JSON.stringify(capture.calls[0]);
      assert.equal(serialized.includes(secretDetail), false);
      assert.equal(serialized.includes("SEND_VERIFICATION_FAILED"), true);
      assert.equal(serialized.includes("Error"), true);
    } finally {
      capture.restore();
    }
  });

  test("uses UnknownError for a non-Error thrown value and never prints the raw value", () => {
    const capture = captureConsoleError();
    try {
      const secretPayload = { email: "someone@example.com", code: "999999" };
      logSafeAuthError("VERIFY_CODE_FAILED", secretPayload);

      const serialized = JSON.stringify(capture.calls[0]);
      assert.equal(serialized.includes("UnknownError"), true);
      assert.equal(serialized.includes("someone@example.com"), false);
      assert.equal(serialized.includes("999999"), false);
    } finally {
      capture.restore();
    }
  });
});
