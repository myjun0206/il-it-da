import { pathToFileURL } from "node:url";

import { loadQuestionSet } from "./rag-eval/question-set.mjs";
import { analyzeQuestionSet, computeRate } from "./rag-eval/analyze-question-set.mjs";

const HELP_TEXT = `Usage: node scripts/analyze-rag-dataset.mjs --input <question-set.json> [--strict]

Computes de-identified distribution/completeness statistics and quality
warnings for a validated QA question set. Only accepts JSON that already
passes the existing question-set schema (run convert:rag-dataset and
validate:rag-dataset first for CSV-authored data).
No external API, database, or environment variable access is performed.

Options:
  --input <path>  Path to the QA question set JSON file (required)
  --strict        Exit with code 1 if any quality warning is found
  --help          Show this help message

Exit codes:
  0  Valid data, and either no warnings or warnings without --strict
  1  Valid data but --strict is set and at least one warning was found
  2  Invalid arguments, file read error, JSON syntax error, or schema error
`;

function parseArgs(argv) {
  const parsed = { input: null, strict: false, help: false, unknown: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }

    if (arg === "--input") {
      const value = argv[i + 1];
      if (typeof value !== "string" || value.startsWith("--")) {
        parsed.unknown.push(`${arg} (missing value)`);
      } else {
        parsed.input = value;
        i += 1;
      }
      continue;
    }

    parsed.unknown.push(arg);
  }

  return parsed;
}

function printSchemaErrors(errors) {
  console.log("오류 목록:");
  for (const error of errors) {
    console.log(
      `- index=${error.index ?? "-"} questionId=${error.questionId ?? "-"} field=${error.field} code=${error.code}`,
    );
  }
}

function printDistribution(label, distribution, total) {
  const entries = Object.entries(distribution).sort(([a], [b]) => a.localeCompare(b));
  console.log(`${label}:`);
  if (entries.length === 0) {
    console.log("  (없음)");
    return;
  }
  for (const [name, count] of entries) {
    console.log(`  - ${name}: ${count}건 (${computeRate(count, total).toFixed(4)})`);
  }
}

function printCompleteness(completeness) {
  console.log("완성도:");
  for (const [field, count] of Object.entries(completeness)) {
    console.log(`  - ${field}: ${count}건`);
  }
}

function printWarnings(warnings) {
  console.log(`경고: ${warnings.length}건`);
  for (const warning of warnings) {
    console.log(`  - code=${warning.code} severity=${warning.severity} count=${warning.count}`);
    if (Array.isArray(warning.questionIds) && warning.questionIds.length > 0) {
      console.log(`    questionIds=${warning.questionIds.join(",")}`);
    }
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

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
    console.error("필수 인자가 없습니다: --input <question-set.json>");
    return 2;
  }

  let result;
  try {
    result = loadQuestionSet(args.input);
  } catch (error) {
    console.error(`질문셋을 불러오지 못했습니다: ${error.code ?? "UNKNOWN_ERROR"}`);
    return 2;
  }

  if (!result.valid) {
    console.error(`질문셋 스키마 오류: ${result.errors.length}건`);
    printSchemaErrors(result.errors);
    return 2;
  }

  const analysis = analyzeQuestionSet(result.data);

  console.log("RAG 질문셋 분석 결과");
  console.log(`전체 질문 수: ${analysis.total}`);
  printDistribution("question_type 분포", analysis.distributions.questionType, analysis.total);
  printDistribution("target_store 분포", analysis.distributions.targetStore, analysis.total);
  printDistribution("expected_status 분포", analysis.distributions.expectedStatus, analysis.total);
  printDistribution("manual_scope 분포", analysis.distributions.manualScope, analysis.total);
  printDistribution("category 분포", analysis.distributions.category, analysis.total);
  printDistribution("priority 분포", analysis.distributions.priority, analysis.total);
  printCompleteness(analysis.completeness);
  printWarnings(analysis.warnings);

  if (args.strict && analysis.warnings.length > 0) {
    return 1;
  }

  return 0;
}

export { main };

const isDirectlyExecuted = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectlyExecuted) {
  process.exitCode = main();
}
