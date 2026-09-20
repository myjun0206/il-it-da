import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { main } from "../../scripts/compare-rag-reports.mjs";

function makeReport({ summary, cases } = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    summary: {
      total: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
      statusMatched: 1,
      statusAccuracy: 1,
      keywordPassed: 1,
      keywordPassRate: 1,
      forbiddenViolations: 0,
      errorCount: 0,
      ...summary,
    },
    cases: cases ?? [
      {
        questionId: "QA-001",
        expectedStatus: "answered",
        actualStatus: "answered",
        statusMatched: true,
        keywordPassed: true,
        missingKeywordCount: 0,
        forbiddenPassed: true,
        forbiddenMatchCount: 0,
        pass: true,
      },
    ],
  };
}

async function withCapturedConsole(fn) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));

  try {
    const code = await fn();
    return { code, logs, errors };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

describe("compare-rag-reports CLI", () => {
  let tempDir;

  before(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "rag-eval-compare-cli-"));
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("exits 0 when there is no regression", async () => {
    const report = makeReport();
    const baselinePath = path.join(tempDir, "baseline-ok.json");
    const candidatePath = path.join(tempDir, "candidate-ok.json");
    writeFileSync(baselinePath, JSON.stringify(report), "utf8");
    writeFileSync(candidatePath, JSON.stringify(report), "utf8");

    const { code, logs } = await withCapturedConsole(() => main(["--baseline", baselinePath, "--candidate", candidatePath]));

    assert.equal(code, 0);
    assert.ok(logs.some((line) => line.includes("리포트 비교 결과")));
  });

  test("exits 1 when a regression is found", async () => {
    const baselinePath = path.join(tempDir, "baseline-regress.json");
    const candidatePath = path.join(tempDir, "candidate-regress.json");
    writeFileSync(baselinePath, JSON.stringify(makeReport({ summary: { passRate: 1 } })), "utf8");
    writeFileSync(
      candidatePath,
      JSON.stringify(
        makeReport({
          summary: { passRate: 0, passed: 0, failed: 1 },
          cases: [
            {
              questionId: "QA-001",
              expectedStatus: "answered",
              actualStatus: "cautious",
              statusMatched: false,
              keywordPassed: true,
              missingKeywordCount: 0,
              forbiddenPassed: true,
              forbiddenMatchCount: 0,
              pass: false,
            },
          ],
        }),
      ),
      "utf8",
    );

    const { code, logs } = await withCapturedConsole(() => main(["--baseline", baselinePath, "--candidate", candidatePath]));

    assert.equal(code, 1);
    assert.ok(logs.some((line) => line.includes("회귀")));
  });

  test("exits 2 when a required argument is missing", async () => {
    const { code } = await withCapturedConsole(() => main(["--baseline", "somewhere.json"]));

    assert.equal(code, 2);
  });

  test("exits 2 when baseline and candidate point to the same file", async () => {
    const filePath = path.join(tempDir, "same.json");
    writeFileSync(filePath, JSON.stringify(makeReport()), "utf8");

    const { code } = await withCapturedConsole(() => main(["--baseline", filePath, "--candidate", filePath]));

    assert.equal(code, 2);
  });

  test("exits 2 on invalid JSON syntax", async () => {
    const baselinePath = path.join(tempDir, "invalid.json");
    const candidatePath = path.join(tempDir, "candidate-for-invalid.json");
    writeFileSync(baselinePath, "{ not valid json", "utf8");
    writeFileSync(candidatePath, JSON.stringify(makeReport()), "utf8");

    const { code } = await withCapturedConsole(() => main(["--baseline", baselinePath, "--candidate", candidatePath]));

    assert.equal(code, 2);
  });

  test("exits 2 on a schemaVersion mismatch", async () => {
    const baselinePath = path.join(tempDir, "wrong-schema.json");
    const candidatePath = path.join(tempDir, "candidate-for-wrong-schema.json");
    const badReport = makeReport();
    badReport.schemaVersion = 2;
    writeFileSync(baselinePath, JSON.stringify(badReport), "utf8");
    writeFileSync(candidatePath, JSON.stringify(makeReport()), "utf8");

    const { code } = await withCapturedConsole(() => main(["--baseline", baselinePath, "--candidate", candidatePath]));

    assert.equal(code, 2);
  });

  test("does not print question, answer, UUID, or store text, nor the full file path", async () => {
    const report = makeReport();
    const baselinePath = path.join(tempDir, "baseline-clean.json");
    const candidatePath = path.join(tempDir, "candidate-clean.json");
    writeFileSync(baselinePath, JSON.stringify(report), "utf8");
    writeFileSync(candidatePath, JSON.stringify(report), "utf8");

    const { logs, errors } = await withCapturedConsole(() =>
      main(["--baseline", baselinePath, "--candidate", candidatePath]),
    );

    const combined = [...logs, ...errors].join("\n");
    assert.equal(combined.includes(tempDir), false);
    assert.equal(combined.includes("storeId"), false);
    assert.equal(combined.includes("target_store"), false);
  });
});
