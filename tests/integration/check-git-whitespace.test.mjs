import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_TREE_SHA,
  ZERO_SHA,
  determineWhitespaceCheckPlan,
  isValidSha,
  main,
} from "../../scripts/check-git-whitespace.mjs";

const VALID_SHA_A = "a".repeat(40);
const VALID_SHA_B = "b".repeat(40);

function captureOutput() {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    writeOut: (line) => stdout.push(String(line)),
    writeError: (line) => stderr.push(String(line)),
  };
}

describe("isValidSha", () => {
  test("accepts only exactly 40 lowercase hex characters", () => {
    assert.equal(isValidSha("a".repeat(40)), true);
    assert.equal(isValidSha("A".repeat(40)), false);
    assert.equal(isValidSha("a".repeat(39)), false);
    assert.equal(isValidSha("g".repeat(40)), false);
    assert.equal(isValidSha("--upload-pack=evil"), false);
    assert.equal(isValidSha(undefined), false);
  });
});

describe("determineWhitespaceCheckPlan", () => {
  test("runs local worktree + staged checks outside CI", () => {
    const plan = determineWhitespaceCheckPlan({});
    assert.equal(plan.status, "ok");
    assert.equal(plan.mode, "local");
    assert.deepEqual(plan.commands, [
      ["diff", "--check"],
      ["diff", "--cached", "--check"],
    ]);
  });

  test("checks the PR base...head range on pull_request events", () => {
    const plan = determineWhitespaceCheckPlan({
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "pull_request",
      PR_BASE_SHA: VALID_SHA_A,
      PR_HEAD_SHA: VALID_SHA_B,
    });
    assert.equal(plan.status, "ok");
    assert.equal(plan.mode, "pull_request");
    assert.deepEqual(plan.commands, [["diff", "--check", `${VALID_SHA_A}...${VALID_SHA_B}`]]);
  });

  test("checks the before..after range on push events", () => {
    const plan = determineWhitespaceCheckPlan({
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "push",
      PUSH_BEFORE_SHA: VALID_SHA_A,
      PUSH_AFTER_SHA: VALID_SHA_B,
    });
    assert.equal(plan.status, "ok");
    assert.equal(plan.mode, "push");
    assert.deepEqual(plan.commands, [["diff", "--check", `${VALID_SHA_A}..${VALID_SHA_B}`]]);
  });

  test("falls back to the empty-tree SHA when PUSH_BEFORE_SHA is the all-zero SHA (first push)", () => {
    const plan = determineWhitespaceCheckPlan({
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "push",
      PUSH_BEFORE_SHA: ZERO_SHA,
      PUSH_AFTER_SHA: VALID_SHA_B,
    });
    assert.equal(plan.status, "ok");
    assert.equal(plan.mode, "push-initial");
    assert.deepEqual(plan.commands, [["diff", "--check", `${EMPTY_TREE_SHA}..${VALID_SHA_B}`]]);
  });

  test("also falls back to the empty-tree SHA when PUSH_BEFORE_SHA is absent", () => {
    const plan = determineWhitespaceCheckPlan({
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "push",
      PUSH_AFTER_SHA: VALID_SHA_B,
    });
    assert.equal(plan.status, "ok");
    assert.equal(plan.mode, "push-initial");
  });

  test("fails closed when PR_BASE_SHA/PR_HEAD_SHA are missing or malformed", () => {
    const plan = determineWhitespaceCheckPlan({
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "pull_request",
      PR_BASE_SHA: "not-a-sha",
      PR_HEAD_SHA: VALID_SHA_B,
    });
    assert.equal(plan.status, "error");
    assert.equal(typeof plan.reason, "string");
  });

  test("fails closed when PUSH_AFTER_SHA is missing or malformed", () => {
    const plan = determineWhitespaceCheckPlan({
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "push",
      PUSH_BEFORE_SHA: VALID_SHA_A,
      PUSH_AFTER_SHA: "; rm -rf /",
    });
    assert.equal(plan.status, "error");
  });

  test("fails closed when PUSH_BEFORE_SHA is present but invalid (not the zero SHA)", () => {
    const plan = determineWhitespaceCheckPlan({
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "push",
      PUSH_BEFORE_SHA: "--upload-pack=evil",
      PUSH_AFTER_SHA: VALID_SHA_B,
    });
    assert.equal(plan.status, "error");
  });

  test("fails closed on an unsupported CI event instead of silently skipping the check", () => {
    const plan = determineWhitespaceCheckPlan({
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "workflow_dispatch",
    });
    assert.equal(plan.status, "error");
  });
});

describe("main (injected git runner, never spawns a real git process)", () => {
  test("runs both local checks in order when the worktree check succeeds", async () => {
    const calls = [];
    const code = await main({
      env: {},
      runGitDiffCheck: async (args) => {
        calls.push(args);
        return 0;
      },
      stdout: () => {},
      stderr: () => {},
    });

    assert.equal(code, 0);
    assert.deepEqual(calls, [["diff", "--check"], ["diff", "--cached", "--check"]]);
  });

  test("stops after the worktree check fails and preserves its exit code", async () => {
    const calls = [];
    const code = await main({
      env: {},
      runGitDiffCheck: async (args) => {
        calls.push(args);
        return 2;
      },
      stdout: () => {},
      stderr: () => {},
    });

    assert.equal(code, 2);
    assert.deepEqual(calls, [["diff", "--check"]]);
  });

  test("preserves a non-zero exit code from the staged check", async () => {
    const code = await main({
      env: {},
      runGitDiffCheck: async (args) => (args.includes("--cached") ? 137 : 0),
      stdout: () => {},
      stderr: () => {},
    });

    assert.equal(code, 137);
  });

  test("fails closed with exit code 1 and never invokes git when the plan cannot be determined", async () => {
    const output = captureOutput();
    let gitInvoked = false;
    const code = await main({
      env: { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "pull_request" },
      runGitDiffCheck: async () => {
        gitInvoked = true;
        return 0;
      },
      stdout: output.writeOut,
      stderr: output.writeError,
    });

    assert.equal(code, 1);
    assert.equal(gitInvoked, false);
    assert.ok(output.stderr.join("\n").length > 0);
  });

  test("does not print environment variable values, SHAs, or the full git command string", async () => {
    const output = captureOutput();
    const secretValue = "sk-test-secret-should-not-leak";
    const code = await main({
      env: {
        GITHUB_ACTIONS: "true",
        GITHUB_EVENT_NAME: "push",
        PUSH_BEFORE_SHA: VALID_SHA_A,
        PUSH_AFTER_SHA: VALID_SHA_B,
        __SECRET_TOKEN__: secretValue,
      },
      runGitDiffCheck: async () => 0,
      stdout: output.writeOut,
      stderr: output.writeError,
    });

    assert.equal(code, 0);
    const combined = [...output.stdout, ...output.stderr].join("\n");
    assert.equal(combined.includes(secretValue), false);
    assert.equal(combined.includes(VALID_SHA_A), false);
    assert.equal(combined.includes(VALID_SHA_B), false);
  });
});
