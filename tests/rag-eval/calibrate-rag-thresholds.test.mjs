import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { main } from "../../scripts/calibrate-rag-thresholds.mjs";

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

function makeCase(overrides) {
  return {
    caseId: "case-1",
    questionId: "q-1",
    groupId: "group-1",
    partition: "calibration",
    expectedStatus: "answered",
    similarity: 0.7,
    answerCorrect: true,
    scopeSafe: true,
    ...overrides,
  };
}

function validDatasetLoader(cases) {
  return () => ({
    valid: true,
    errors: [],
    warnings: [],
    data: cases,
  });
}

describe("calibrate-rag-thresholds CLI", () => {
  test("--help exits 0 without loading any dataset", async () => {
    const output = captureOutput();
    let loadCalls = 0;
    const code = await main(["--help"], {
      loadDataset: () => {
        loadCalls += 1;
        throw new Error("must not load");
      },
      stdout: output.writeOut,
      stderr: output.writeError,
    });
    assert.equal(code, 0);
    assert.equal(loadCalls, 0);
  });

  test("exits 2 when --input is missing", async () => {
    const output = captureOutput();
    const code = await main([], { stdout: output.writeOut, stderr: output.writeError });
    assert.equal(code, 2);
  });

  test("exits 2 for an unknown argument", async () => {
    const output = captureOutput();
    const code = await main(["--input", "x.json", "--bogus"], { stdout: output.writeOut, stderr: output.writeError });
    assert.equal(code, 2);
  });

  test("exits 2 when the dataset loader throws (file/JSON error)", async () => {
    const output = captureOutput();
    const code = await main(["--input", "missing.json"], {
      loadDataset: () => {
        const error = new Error("boom");
        error.code = "CALIBRATION_DATASET_READ_ERROR";
        throw error;
      },
      stdout: output.writeOut,
      stderr: output.writeError,
    });
    assert.equal(code, 2);
    assert.equal(output.stderr.join("\n").includes("CALIBRATION_DATASET_READ_ERROR"), true);
  });

  test("exits 2 when the dataset fails schema validation, printing only safe error fields", async () => {
    const output = captureOutput();
    const code = await main(["--input", "bad.json"], {
      loadDataset: () => ({
        valid: false,
        errors: [{ index: 0, caseId: "c1", field: "similarity", code: "INVALID_SIMILARITY" }],
        warnings: [],
        data: null,
      }),
      stdout: output.writeOut,
      stderr: output.writeError,
    });
    assert.equal(code, 2);
    const combined = output.stderr.join("\n");
    assert.equal(combined.includes("INVALID_SIMILARITY"), true);
  });

  test("exits 2 for an invalid threshold range option", async () => {
    const output = captureOutput();
    const code = await main(["--input", "x.json", "--answered-min", "0.9", "--answered-max", "0.5"], {
      loadDataset: validDatasetLoader([makeCase({})]),
      stdout: output.writeOut,
      stderr: output.writeError,
    });
    assert.equal(code, 2);
  });

  test("exits 0 and always reports the baseline for a valid dataset", async () => {
    const output = captureOutput();
    const cases = [
      makeCase({ caseId: "c1", groupId: "g1", partition: "calibration", expectedStatus: "answered", similarity: 0.9 }),
      makeCase({ caseId: "c2", groupId: "g2", partition: "calibration", expectedStatus: "cautious", similarity: 0.5 }),
      makeCase({ caseId: "c3", groupId: "g3", partition: "calibration", expectedStatus: "insufficient", similarity: 0.1, answerCorrect: false }),
      makeCase({ caseId: "v1", groupId: "g4", partition: "validation", expectedStatus: "answered", similarity: 0.88 }),
    ];
    const code = await main(["--input", "x.json", "--top", "3"], {
      loadDataset: validDatasetLoader(cases),
      stdout: output.writeOut,
      stderr: output.writeError,
    });
    assert.equal(code, 0);
    const combined = output.stdout.join("\n");
    assert.match(combined, /baseline/);
    assert.match(combined, /answered=0\.60 cautious=0\.40/);
    assert.match(combined, /상위 후보/);
    assert.match(combined, /최적.*아닌|아닌.*최적/);
    assert.match(combined, /calibrationEligible: true/);
    assert.match(combined, /scopeSafe=false 사례 수: 0/);
  });

  test("reports calibrationEligible=false and a fixed safety notice when scopeSafe=false is present", async () => {
    const output = captureOutput();
    const cases = [
      makeCase({ caseId: "c1", groupId: "g1", partition: "calibration", expectedStatus: "answered", similarity: 0.9, scopeSafe: false }),
      makeCase({ caseId: "c2", groupId: "g2", partition: "calibration", expectedStatus: "cautious", similarity: 0.5 }),
    ];
    const code = await main(["--input", "x.json"], {
      loadDataset: validDatasetLoader(cases),
      stdout: output.writeOut,
      stderr: output.writeError,
    });
    assert.equal(code, 0);
    const combined = output.stdout.join("\n");
    assert.match(combined, /calibrationEligible: false/);
    assert.match(combined, /scopeSafe=false 사례 수: 1/);
    assert.match(combined, /SCOPE_UNSAFE_PRESENT/);
    assert.match(combined, /배포 가능한 추천이나 선택 가능한 최종 후보가 아니라 진단 참고용/);
  });

  test("reports a group-partition-leakage notice exactly once and marks validation as diagnostic-only", async () => {
    const output = captureOutput();
    const cases = [
      makeCase({ caseId: "c1", groupId: "shared", partition: "calibration", expectedStatus: "answered", similarity: 0.9 }),
      makeCase({ caseId: "v1", groupId: "shared", partition: "validation", expectedStatus: "answered", similarity: 0.9 }),
    ];
    const code = await main(["--input", "x.json"], {
      loadDataset: validDatasetLoader(cases),
      stdout: output.writeOut,
      stderr: output.writeError,
    });
    assert.equal(code, 0);
    const combined = output.stdout.join("\n");
    const occurrences = combined.split("GROUP_PARTITION_LEAKAGE").length - 1;
    assert.equal(occurrences, 1);
    assert.match(combined, /독립 검증 아님/);
    assert.match(combined, /calibrationEligible: false/);
  });

  test("never prints question/answer/store/UUID/token-shaped values even with unexpected extra fields", async () => {
    const output = captureOutput();
    const secretUuid = "11111111-2222-4333-8444-555555555555";
    const cases = [
      makeCase({
        caseId: "c1",
        similarity: 0.9,
        // Defensive: even if an upstream bug added these fields, the CLI must never print them.
        question: "실제 질문 원문입니다",
        answer: "실제 답변 원문입니다",
        storeId: secretUuid,
        authorizationHeader: "Bearer sk-secret-token-value",
      }),
    ];
    const code = await main(["--input", "x.json"], {
      loadDataset: validDatasetLoader(cases),
      stdout: output.writeOut,
      stderr: output.writeError,
    });
    assert.equal(code, 0);
    const combined = [...output.stdout, ...output.stderr].join("\n");
    assert.equal(combined.includes("실제 질문 원문입니다"), false);
    assert.equal(combined.includes("실제 답변 원문입니다"), false);
    assert.equal(combined.includes(secretUuid), false);
    assert.equal(combined.includes("sk-secret-token-value"), false);
  });

  test("uses the injected loadDataset and performs no real file I/O", async () => {
    const output = captureOutput();
    let calledWithPath = null;
    const code = await main(["--input", "some/path.json"], {
      loadDataset: (filePath) => {
        calledWithPath = filePath;
        return { valid: true, errors: [], warnings: [], data: [makeCase({})] };
      },
      stdout: output.writeOut,
      stderr: output.writeError,
    });
    assert.equal(code, 0);
    assert.equal(calledWithPath, "some/path.json");
  });
});
