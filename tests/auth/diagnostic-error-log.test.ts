import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { logDiagnosticError } from "../../lib/auth/diagnostic-error-log.ts";

describe("logDiagnosticError", () => {
  test("keeps failure diagnostics while redacting session and personal identifiers", () => {
    const originalError = console.error;
    let logged: unknown[] = [];
    console.error = (...args: unknown[]) => {
      logged = args;
    };

    try {
      logDiagnosticError("STORE_REQUEST", "membership.insert", {
        name: "PostgrestError",
        code: "23505",
        message: "duplicate store for shop@example.com at 11111111-1111-4111-8111-111111111111",
        details: "requester 010-1234-5678",
        stack: "Bearer eyJabcdefghijk.abcdefghijk.abcdefghijk",
      }, {
        requestId: "request-123",
        stage: "membership.insert",
        userId: "11111111-1111-4111-8111-111111111111",
        storeId: "22222222-2222-4222-8222-222222222222",
        storeName: "테스트 매장",
        sessionPresent: true,
      });
    } finally {
      console.error = originalError;
    }

    const serialized = JSON.stringify(logged);
    assert.match(serialized, /23505/);
    assert.match(serialized, /membership\.insert/);
    assert.match(serialized, /redacted-email/);
    assert.match(serialized, /redacted/);
    assert.match(serialized, /redacted-phone/);
    assert.match(serialized, /Bearer \[redacted\]/);
    assert.equal(serialized.includes("shop@example.com"), false);
    assert.equal(serialized.includes("eyJabcdefghijk"), false);
    assert.equal(serialized.includes("테스트 매장"), false);
    assert.equal(serialized.includes("11111111-1111-4111-8111-111111111111"), false);
  });
});