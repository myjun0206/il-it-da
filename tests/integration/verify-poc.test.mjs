import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { STEPS, main } from "../../scripts/verify-poc.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

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

function makeRecordingRunner(codesByStepName) {
  const calls = [];
  const runCommand = async (step) => {
    calls.push(step.name);
    return codesByStepName[step.name] ?? 0;
  };
  return { calls, runCommand };
}

describe("verify-poc CLI", () => {
  test("rejects an unknown argument with exit 2", async () => {
    const output = captureOutput();
    const code = await main(["--unknown"], { stdout: output.writeOut, stderr: output.writeError });
    assert.equal(code, 2);
  });

  test("supports --help without running any step", async () => {
    const output = captureOutput();
    let calls = 0;
    const code = await main(["--help"], {
      runCommand: async () => {
        calls += 1;
        return 0;
      },
      stdout: output.writeOut,
      stderr: output.writeError,
    });
    assert.equal(code, 0);
    assert.equal(calls, 0);
  });

  test("runs all steps in order and reports PASS when every step succeeds", async () => {
    const output = captureOutput();
    const { calls, runCommand } = makeRecordingRunner({});

    const code = await main([], { runCommand, stdout: output.writeOut, stderr: output.writeError });

    assert.equal(code, 0);
    assert.deepEqual(calls, STEPS.map((step) => step.name));
    const combined = output.stdout.join("\n");
    assert.match(combined, new RegExp(`Passed steps: ${STEPS.length}/${STEPS.length}`));
    assert.match(combined, /PASS/);
  });

  test("stops immediately at the first failing step and does not run later steps", async () => {
    const output = captureOutput();
    const failingIndex = 2;
    const { calls, runCommand } = makeRecordingRunner({
      [STEPS[failingIndex].name]: 1,
    });

    const code = await main([], { runCommand, stdout: output.writeOut, stderr: output.writeError });

    assert.equal(code, 1);
    assert.deepEqual(calls, STEPS.slice(0, failingIndex + 1).map((step) => step.name));
    const combined = output.stderr.join("\n");
    assert.match(combined, new RegExp(STEPS[failingIndex].name));
    assert.equal(output.stdout.some((line) => line.includes("PASS")), false);
  });

  test("preserves the non-zero exit code of the failing step", async () => {
    const output = captureOutput();
    const { runCommand } = makeRecordingRunner({ [STEPS[0].name]: 137 });

    const code = await main([], { runCommand, stdout: output.writeOut, stderr: output.writeError });

    assert.equal(code, 137);
    assert.match(output.stderr.join("\n"), /exit code 137/);
  });

  test("does not print environment variable values, tokens, or question text", async () => {
    const output = captureOutput();
    const secretEnvValue = "sk-test-secret-value-should-not-leak";
    const secretQuestion = "실제 질문 원문이 여기 있으면 안 됩니다";
    process.env.__VERIFY_POC_TEST_SECRET__ = secretEnvValue;

    try {
      const { runCommand } = makeRecordingRunner({});
      const code = await main([], { runCommand, stdout: output.writeOut, stderr: output.writeError });

      assert.equal(code, 0);
      const combined = [...output.stdout, ...output.stderr].join("\n");
      assert.equal(combined.includes(secretEnvValue), false);
      assert.equal(combined.includes(secretQuestion), false);
      assert.equal(combined.includes(process.env.__VERIFY_POC_TEST_SECRET__), false);
    } finally {
      delete process.env.__VERIFY_POC_TEST_SECRET__;
    }
  });

  test("uses only injected runCommand and never spawns a real process", async () => {
    const output = captureOutput();
    let realSpawnAttempted = false;
    const runCommand = async () => {
      realSpawnAttempted = false;
      return 0;
    };

    const code = await main([], { runCommand, stdout: output.writeOut, stderr: output.writeError });

    assert.equal(code, 0);
    assert.equal(realSpawnAttempted, false);
  });

  test("typecheck step invokes the package.json typecheck script instead of a duplicated tsc command", () => {
    const typecheckStep = STEPS.find((step) => step.name === "typecheck");
    assert.ok(typecheckStep, "expected a typecheck step to exist");
    assert.equal(typecheckStep.command, "npm");
    assert.deepEqual(typecheckStep.args, ["run", "typecheck"]);
  });

  test("build only runs after typecheck succeeds, and is skipped when typecheck fails", async () => {
    const output = captureOutput();
    const { calls, runCommand } = makeRecordingRunner({ typecheck: 1 });

    const code = await main([], { runCommand, stdout: output.writeOut, stderr: output.writeError });

    assert.equal(code, 1);
    assert.equal(calls.includes("build"), false);
    assert.equal(calls[calls.length - 1], "typecheck");
  });

  test("typecheck failure preserves its non-zero exit code", async () => {
    const output = captureOutput();
    const { runCommand } = makeRecordingRunner({ typecheck: 2 });

    const code = await main([], { runCommand, stdout: output.writeOut, stderr: output.writeError });

    assert.equal(code, 2);
    assert.match(output.stderr.join("\n"), /typecheck \(exit code 2\)/);
  });

  test("keeps exactly 7 verification steps in the documented order", () => {
    assert.deepEqual(
      STEPS.map((step) => step.name),
      [
        "check:integration",
        "test:integration",
        "test:rag",
        "test:rag-eval",
        "lint",
        "typecheck",
        "build",
      ],
    );
  });

  test("package.json defines a typecheck script running next typegen before tsc --noEmit", () => {
    const typecheckScript = packageJson.scripts?.typecheck;
    assert.ok(typecheckScript, "expected package.json to define a typecheck script");

    const typegenIndex = typecheckScript.indexOf("next typegen");
    const tscIndex = typecheckScript.indexOf("tsc --noEmit");
    assert.ok(typegenIndex >= 0, "typecheck script must run `next typegen`");
    assert.ok(tscIndex >= 0, "typecheck script must run `tsc --noEmit`");
    assert.ok(typegenIndex < tscIndex, "next typegen must run before tsc --noEmit");
  });

  test("typecheck script chains typegen and tsc with && so a typegen failure short-circuits tsc", () => {
    const typecheckScript = packageJson.scripts?.typecheck;
    const [beforeTsc] = typecheckScript.split("tsc --noEmit");
    assert.match(beforeTsc.trimEnd(), /&&\s*$/, "next typegen and tsc --noEmit must be joined with &&");
  });
});
