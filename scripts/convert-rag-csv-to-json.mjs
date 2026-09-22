import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadCsvQuestionSet } from "./rag-eval/csv-question-set.mjs";

const HELP_TEXT = `Usage: node scripts/convert-rag-csv-to-json.mjs --input <question-set.csv> --output <question-set.json> [--force]

Converts a "CSV UTF-8 (comma delimited)" QA question set exported from Excel
into the JSON array format used by the RAG evaluation tools, and validates it
against the existing question-set schema before writing any output.
No external API, database, or environment variable access is performed.

Options:
  --input <path>   Path to the CSV question set file (required)
  --output <path>  Path to write the converted JSON file (required)
  --force          Overwrite an existing output file
  --help           Show this help message

Exit codes:
  0  Conversion and schema validation succeeded
  2  Invalid arguments, CSV syntax/header error, or schema validation error
`;

function parseArgs(argv) {
  const parsed = { input: null, output: null, force: false, help: false, unknown: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--force") {
      parsed.force = true;
      continue;
    }

    if (arg === "--input" || arg === "--output") {
      const value = argv[i + 1];
      if (typeof value !== "string" || value.startsWith("--")) {
        parsed.unknown.push(`${arg} (missing value)`);
        continue;
      }
      if (arg === "--input") parsed.input = value;
      if (arg === "--output") parsed.output = value;
      i += 1;
      continue;
    }

    parsed.unknown.push(arg);
  }

  return parsed;
}

function printErrors(errors) {
  console.log("오류 목록:");
  for (const error of errors) {
    console.log(
      `- row=${error.row ?? "-"} questionId=${error.questionId ?? "-"} field=${error.field} code=${error.code}`,
    );
  }
}

function pathsPointToSameFile(a, b) {
  return path.resolve(a) === path.resolve(b);
}

function writeJsonAtomically(outputPath, data) {
  const resolvedOutput = path.resolve(outputPath);
  const outputDir = path.dirname(resolvedOutput);
  const tempPath = path.join(outputDir, `.${path.basename(resolvedOutput)}.tmp-${process.pid}`);

  try {
    writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    renameSync(tempPath, resolvedOutput);
  } catch (cause) {
    try {
      unlinkSync(tempPath);
    } catch {
      // temp file may never have been created; nothing further to clean up
    }
    const error = new Error("Failed to write output file.");
    error.code = "OUTPUT_WRITE_ERROR";
    error.cause = cause;
    throw error;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP_TEXT);
    return 0;
  }

  if (args.unknown.length > 0) {
    console.error(`알 수 없거나 잘못된 인자: ${args.unknown.join(", ")}`);
    console.error(HELP_TEXT);
    return 2;
  }

  if (!args.input) {
    console.error("필수 인자가 없습니다: --input <question-set.csv>");
    return 2;
  }

  if (!args.output) {
    console.error("필수 인자가 없습니다: --output <question-set.json>");
    return 2;
  }

  if (pathsPointToSameFile(args.input, args.output)) {
    console.error("입력과 출력 경로가 같습니다.");
    return 2;
  }

  if (existsSync(args.output) && !args.force) {
    console.error("출력 파일이 이미 존재합니다. 덮어쓰려면 --force를 사용하세요.");
    return 2;
  }

  let result;

  try {
    result = loadCsvQuestionSet(args.input);
  } catch (error) {
    console.error(`CSV 질문셋을 불러오지 못했습니다: ${error.code ?? "UNKNOWN_ERROR"}`);
    return 2;
  }

  if (!result.valid) {
    console.error(`변환/검증 오류: ${result.errors.length}건`);
    printErrors(result.errors);
    return 2;
  }

  try {
    writeJsonAtomically(args.output, result.data);
  } catch (error) {
    console.error(`출력 파일을 저장하지 못했습니다: ${error.code ?? "UNKNOWN_ERROR"}`);
    return 2;
  }

  console.log("RAG 질문셋 변환 결과");
  console.log(`입력 건수: ${result.data.length}`);
  console.log(`출력 건수: ${result.data.length}`);

  return 0;
}

process.exitCode = main();
