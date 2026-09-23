import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { checkRepository } from "../../scripts/integration-check/check-repository.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("repository has no leftover Git merge conflict markers", () => {
  test("check-repository reports zero MERGE_CONFLICT_MARKER_FOUND errors", async () => {
    const report = await checkRepository({ rootDir: repoRoot });
    const conflictErrors = report.results.filter((item) => item.code === "MERGE_CONFLICT_MARKER_FOUND");
    assert.deepEqual(conflictErrors, []);
  });
});
