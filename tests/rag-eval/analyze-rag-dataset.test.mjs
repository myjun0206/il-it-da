import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { main } from "../../scripts/analyze-rag-dataset.mjs";

function makeDataset() {
  return [
    {
      question_id: "QA-001",
      question_type: "normal",
      target_store: "이수점",
      question: "질문 하나입니다",
      expected_status: "answered",
      expected_keywords: [],
      priority: "medium",
      category: "카테고리",
    },
  ];
}

function withCapturedConsole(fn) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));

  try {
    const code = fn();
    return { code, logs, errors };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

describe("analyze-rag-dataset CLI", () => {
  let tempDir;

  before(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "rag-eval-analyze-cli-"));
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("default mode exits 0 even when warnings are present", () => {
    const inputPath = path.join(tempDir, "with-warnings.json");
    writeFileSync(inputPath, JSON.stringify(makeDataset()), "utf8");

    const { code, logs } = withCapturedConsole(() => main(["--input", inputPath]));

    assert.equal(code, 0);
    assert.ok(logs.some((line) => line.includes("경고")));
  });

  test("--strict exits 1 when warnings are present", () => {
    const inputPath = path.join(tempDir, "strict-warnings.json");
    writeFileSync(inputPath, JSON.stringify(makeDataset()), "utf8");

    const { code } = withCapturedConsole(() => main(["--input", inputPath, "--strict"]));

    assert.equal(code, 1);
  });

  test("exits 2 on a question-set schema error", () => {
    const inputPath = path.join(tempDir, "invalid-schema.json");
    writeFileSync(inputPath, JSON.stringify([{ question_id: "QA-x" }]), "utf8");

    const { code } = withCapturedConsole(() => main(["--input", inputPath]));

    assert.equal(code, 2);
  });

  test("exits 2 on invalid JSON syntax", () => {
    const inputPath = path.join(tempDir, "invalid.json");
    writeFileSync(inputPath, "{ not valid json", "utf8");

    const { code } = withCapturedConsole(() => main(["--input", inputPath]));

    assert.equal(code, 2);
  });

  test("rejects an unknown argument", () => {
    const { code } = withCapturedConsole(() => main(["--input", "somewhere.json", "--bogus"]));

    assert.equal(code, 2);
  });

  test("does not print the question text or the full input file path", () => {
    const inputPath = path.join(tempDir, "secret-question.json");
    const dataset = makeDataset();
    dataset[0].question = "이것은-CLI-출력에-남으면-안되는-질문-원문-VERY-SECRET-TEXT";
    writeFileSync(inputPath, JSON.stringify(dataset), "utf8");

    const { logs, errors } = withCapturedConsole(() => main(["--input", inputPath]));
    const combined = [...logs, ...errors].join("\n");

    assert.equal(combined.includes("VERY-SECRET-TEXT"), false);
    assert.equal(combined.includes(inputPath), false);
  });
});
