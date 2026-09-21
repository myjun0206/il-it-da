import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { main } from "../../scripts/check-integration.mjs";

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

describe("integration-check CLI", () => {
  test("rejects an unknown argument with exit 2", async () => {
    const output = captureOutput();
    const code = await main(["--unknown"], { stdout: output.writeOut, stderr: output.writeError });
    assert.equal(code, 2);
  });

  test("supports --help without running checks", async () => {
    const output = captureOutput();
    let checkCalls = 0;
    const code = await main(["--help"], {
      runChecks: async () => {
        checkCalls += 1;
        throw new Error("must not run");
      },
      stdout: output.writeOut,
      stderr: output.writeError,
    });
    assert.equal(code, 0);
    assert.equal(checkCalls, 0);
  });

  test("prints only safe relative result data", async () => {
    const output = captureOutput();
    const secret = "sensitive-value-that-must-not-appear";
    const absolutePath = path.resolve("outside/repository/file.ts");
    const code = await main([], {
      rootDir: absolutePath,
      runChecks: async () => ({
        results: [{
          level: "warning",
          code: "SAFE_CODE",
          message: "A safe static warning.",
          file: "lib/rag/example.ts",
        }],
        summary: { checks: 8, errors: 0, warnings: 1, info: 0 },
        exitCode: 0,
      }),
      stdout: output.writeOut,
      stderr: output.writeError,
    });
    const combined = [...output.stdout, ...output.stderr].join("\n");
    assert.equal(code, 0);
    assert.equal(combined.includes(absolutePath), false);
    assert.equal(combined.includes(secret), false);
    assert.match(combined, /SAFE_CODE lib\/rag\/example\.ts/);
    assert.match(combined, /PASS/);
  });

  test("returns exit 2 without exposing execution errors", async () => {
    const output = captureOutput();
    const secret = "database-secret-detail";
    const code = await main([], {
      runChecks: async () => {
        throw new Error(secret);
      },
      stdout: output.writeOut,
      stderr: output.writeError,
    });
    assert.equal(code, 2);
    assert.equal(output.stderr.join("\n").includes(secret), false);
  });
});