import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { main } from "../../scripts/evaluate-rag-dataset.mjs";

const ISU_ID = "57181130-4449-4299-a864-25a2098147e4";

const VALID_QUESTION_SET = [
  {
    question_id: "q-001",
    question_type: "normal",
    target_store: "이수점",
    question: "영업시간이 어떻게 되나요?",
    expected_status: "answered",
    expected_keywords: ["9시"],
  },
];

const VALID_STORE_MAP = [{ name: "이수점", id: ISU_ID }];

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(calls.length - 1);
  };
  return { fetchImpl, calls };
}

async function withCapturedConsole(fn) {
  const logs = [];
  const errors = [];
  const warns = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  console.warn = (...args) => warns.push(args.join(" "));

  try {
    const code = await fn();
    return { code, logs, errors, warns };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
}

describe("evaluate-rag-dataset CLI --report", () => {
  let tempDir;

  before(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "rag-eval-cli-report-"));
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeFixtures(suffix) {
    const inputPath = path.join(tempDir, `questions-${suffix}.json`);
    const storesPath = path.join(tempDir, `stores-${suffix}.json`);
    writeFileSync(inputPath, JSON.stringify(VALID_QUESTION_SET), "utf8");
    writeFileSync(storesPath, JSON.stringify(VALID_STORE_MAP), "utf8");
    return { inputPath, storesPath };
  }

  test("keeps existing behavior unchanged when --report is omitted", async () => {
    const { inputPath, storesPath } = writeFixtures("no-report");
    const { fetchImpl } = createFetch(() => jsonResponse(200, { status: "answered", answer: "9시부터입니다." }));

    const { code, logs } = await withCapturedConsole(() =>
      main(["--input", inputPath, "--stores", storesPath], { fetchImpl }),
    );

    assert.equal(code, 0);
    assert.ok(logs.some((line) => line.includes("케이스별 결과")));
    assert.equal(logs.some((line) => line.includes("리포트")), false);
  });

  test("saves a de-identified report after a fully passing evaluation", async () => {
    const { inputPath, storesPath } = writeFixtures("pass");
    const reportPath = path.join(tempDir, "pass-report.json");
    const { fetchImpl } = createFetch(() => jsonResponse(200, { status: "answered", answer: "9시부터입니다." }));

    const { code, logs } = await withCapturedConsole(() =>
      main(["--input", inputPath, "--stores", storesPath, "--report", reportPath], { fetchImpl }),
    );

    assert.equal(code, 0);
    assert.ok(logs.some((line) => line.includes("리포트가 저장되었습니다")));
    assert.equal(logs.some((line) => line.includes(reportPath)), false);

    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.summary.total, 1);
    assert.equal(report.cases[0].pass, true);
  });

  test("still saves the report and returns exit code 1 when a case fails", async () => {
    const { inputPath, storesPath } = writeFixtures("fail");
    const reportPath = path.join(tempDir, "fail-report.json");
    const { fetchImpl } = createFetch(() => jsonResponse(200, { status: "cautious", answer: "잘 모르겠습니다." }));

    const { code } = await withCapturedConsole(() =>
      main(["--input", inputPath, "--stores", storesPath, "--report", reportPath], { fetchImpl }),
    );

    assert.equal(code, 1);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.equal(report.cases[0].pass, false);
    assert.equal(report.cases[0].statusMatched, false);
  });

  test("does not create a report file when the question set fails schema validation", async () => {
    const inputPath = path.join(tempDir, "invalid-schema.json");
    const storesPath = path.join(tempDir, "stores-invalid-schema.json");
    writeFileSync(inputPath, JSON.stringify([{ question_id: "q-x" }]), "utf8");
    writeFileSync(storesPath, JSON.stringify(VALID_STORE_MAP), "utf8");
    const reportPath = path.join(tempDir, "should-not-exist.json");
    const { fetchImpl, calls } = createFetch(() => jsonResponse(200, { status: "answered", answer: "9시부터입니다." }));

    const { code } = await withCapturedConsole(() =>
      main(["--input", inputPath, "--stores", storesPath, "--report", reportPath], { fetchImpl }),
    );

    assert.equal(code, 2);
    assert.equal(existsSync(reportPath), false);
    assert.equal(calls.length, 0);
  });

  test("rejects an identical --input and --report path before running the evaluation", async () => {
    const inputPath = path.join(tempDir, "same-path.json");
    const storesPath = path.join(tempDir, "stores-same-path.json");
    writeFileSync(inputPath, JSON.stringify(VALID_QUESTION_SET), "utf8");
    writeFileSync(storesPath, JSON.stringify(VALID_STORE_MAP), "utf8");
    const { fetchImpl, calls } = createFetch(() => jsonResponse(200, { status: "answered", answer: "9시부터입니다." }));

    const { code } = await withCapturedConsole(() =>
      main(["--input", inputPath, "--stores", storesPath, "--report", inputPath], { fetchImpl }),
    );

    assert.equal(code, 2);
    assert.equal(calls.length, 0);
  });

  test("refuses to overwrite an existing report without --force, then succeeds with --force", async () => {
    const { inputPath, storesPath } = writeFixtures("overwrite");
    const reportPath = path.join(tempDir, "overwrite-report.json");
    writeFileSync(reportPath, '{"existing":true}', "utf8");
    const { fetchImpl, calls } = createFetch(() => jsonResponse(200, { status: "answered", answer: "9시부터입니다." }));

    const first = await withCapturedConsole(() =>
      main(["--input", inputPath, "--stores", storesPath, "--report", reportPath], { fetchImpl }),
    );
    assert.equal(first.code, 2);
    assert.equal(calls.length, 0);
    assert.equal(readFileSync(reportPath, "utf8"), '{"existing":true}');

    const second = await withCapturedConsole(() =>
      main(["--input", inputPath, "--stores", storesPath, "--report", reportPath, "--force"], { fetchImpl }),
    );
    assert.equal(second.code, 0);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.equal(report.summary.total, 1);
  });
});
