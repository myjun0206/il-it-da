import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isAllowedDevTestEmail,
  isDevelopmentEnvironment,
  shouldIssueDevTestVerificationCode,
} from "../../lib/auth/dev-test-verification.ts";

const ALLOWED_EMAILS = ["hq@ilitda.test", "boss@ilitda.test"];
const REGISTERED_TEST_EMAIL = ALLOWED_EMAILS[0];

describe("isDevelopmentEnvironment", () => {
  test("is true only for the literal string development", () => {
    assert.equal(isDevelopmentEnvironment("development"), true);
    assert.equal(isDevelopmentEnvironment("production"), false);
    assert.equal(isDevelopmentEnvironment("test"), false);
    assert.equal(isDevelopmentEnvironment(undefined), false);
  });
});

describe("isAllowedDevTestEmail", () => {
  test("matches a registered test email regardless of case/whitespace", () => {
    assert.equal(isAllowedDevTestEmail(REGISTERED_TEST_EMAIL, ALLOWED_EMAILS), true);
    assert.equal(isAllowedDevTestEmail(`  ${REGISTERED_TEST_EMAIL.toUpperCase()}  `, ALLOWED_EMAILS), true);
  });

  test("rejects an email that is not on the list", () => {
    assert.equal(isAllowedDevTestEmail("someone-not-registered@example.com", ALLOWED_EMAILS), false);
  });
});

describe("shouldIssueDevTestVerificationCode", () => {
  test("development + allowed test email -> true (fixed test code path)", () => {
    assert.equal(shouldIssueDevTestVerificationCode(REGISTERED_TEST_EMAIL, ALLOWED_EMAILS, "development"), true);
  });

  test("development + unregistered email -> false (no bypass)", () => {
    assert.equal(
      shouldIssueDevTestVerificationCode("someone-not-registered@example.com", ALLOWED_EMAILS, "development"),
      false,
    );
  });

  test("production + allowed test email -> false (fixed code never works outside development)", () => {
    assert.equal(shouldIssueDevTestVerificationCode(REGISTERED_TEST_EMAIL, ALLOWED_EMAILS, "production"), false);
  });

  test("an undefined/other NODE_ENV value never enables the bypass", () => {
    assert.equal(shouldIssueDevTestVerificationCode(REGISTERED_TEST_EMAIL, ALLOWED_EMAILS, undefined), false);
    assert.equal(shouldIssueDevTestVerificationCode(REGISTERED_TEST_EMAIL, ALLOWED_EMAILS, "staging"), false);
  });
});
