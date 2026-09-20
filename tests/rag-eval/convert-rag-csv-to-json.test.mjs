import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { validateQuestionSet } from "../../scripts/rag-eval/question-set.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const CLI_SCRIPT = path.join(REPO_ROOT, "scripts", "convert-rag-csv-to-json.mjs");

const HEADER =
  "question_id,question_type,manual_scope,target_store,category,question,expected_status,expected_result,expected_keywords,forbidden_content,priority,note";

function validCsv(questionId = "q-001", question = "영업시간이 어떻게 되나요?") {
  return [HEADER, `${questionId},normal,store,이수점,카테고리,${question},answered,,,,,`].join("\n");
}

function invalidCsv(question = "질문입니다") {
  return [HEADER, `q-err,not-a-real-type,store,이수점,카테고리,${question},answered,,,,,`].join("\n");
}

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI_SCRIPT, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

describe("convert-rag-csv-to-json CLI", () => {
  let tempDir;

  before(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "rag-eval-convert-"));
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("converts a valid CSV into JSON that passes the existing validator", () => {
    const inputPath = path.join(tempDir, "valid.csv");
    const outputPath = path.join(tempDir, "valid.json");
    writeFileSync(inputPath, validCsv(), "utf8");

    const result = runCli(["--input", inputPath, "--output", outputPath]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /입력 건수: 1/);
    assert.match(result.stdout, /출력 건수: 1/);

    const written = JSON.parse(readFileSync(outputPath, "utf8"));
    const validation = validateQuestionSet(written);
    assert.equal(validation.valid, true);
  });

  test("does not create an output file when conversion/schema validation fails", () => {
    const inputPath = path.join(tempDir, "invalid.csv");
    const outputPath = path.join(tempDir, "invalid.json");
    writeFileSync(inputPath, invalidCsv(), "utf8");

    const result = runCli(["--input", inputPath, "--output", outputPath]);

    assert.equal(result.status, 2);
    assert.equal(existsSync(outputPath), false);
  });

  test("refuses to overwrite an existing output file without --force", () => {
    const inputPath = path.join(tempDir, "overwrite-source.csv");
    const outputPath = path.join(tempDir, "overwrite-target.json");
    writeFileSync(inputPath, validCsv(), "utf8");
    writeFileSync(outputPath, '{"existing":"content"}', "utf8");

    const result = runCli(["--input", inputPath, "--output", outputPath]);

    assert.equal(result.status, 2);
    assert.equal(readFileSync(outputPath, "utf8"), '{"existing":"content"}');
  });

  test("overwrites an existing output file when --force is given", () => {
    const inputPath = path.join(tempDir, "force-source.csv");
    const outputPath = path.join(tempDir, "force-target.json");
    writeFileSync(inputPath, validCsv(), "utf8");
    writeFileSync(outputPath, '{"existing":"content"}', "utf8");

    const result = runCli(["--input", inputPath, "--output", outputPath, "--force"]);

    assert.equal(result.status, 0);
    const written = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(written.length, 1);
  });

  test("rejects identical input and output paths", () => {
    const samePath = path.join(tempDir, "same.csv");
    writeFileSync(samePath, validCsv(), "utf8");

    const result = runCli(["--input", samePath, "--output", samePath]);

    assert.equal(result.status, 2);
  });

  test("does not print the question text or the full CSV row on failure", () => {
    const secretLikeQuestion = "이것은-CLI-로그에-남으면-안되는-질문-원문-VERY-SECRET-TEXT";
    const inputPath = path.join(tempDir, "secret.csv");
    const outputPath = path.join(tempDir, "secret.json");
    writeFileSync(inputPath, invalidCsv(secretLikeQuestion), "utf8");

    const result = runCli(["--input", inputPath, "--output", outputPath]);

    assert.equal(result.status, 2);
    assert.equal(result.stdout.includes(secretLikeQuestion), false);
    assert.equal(result.stderr.includes(secretLikeQuestion), false);
  });
});
