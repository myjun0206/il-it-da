import { loadQuestionSet } from "./rag-eval/question-set.mjs";

const HELP_TEXT = `Usage: node scripts/validate-rag-dataset.mjs --input <json-path>

Validates a RAG QA question set JSON file (loader + schema validation only).
No external API, database, or environment variable access is performed.

Options:
  --input <path>  Path to the QA question set JSON file (required)
  --help          Show this help message

Exit codes:
  0  Question set is valid
  2  Invalid arguments, JSON syntax error, or schema validation error
`;

function parseArgs(argv) {
  const parsed = { input: null, help: false, unknown: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
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

function printErrors(errors) {
  console.log("오류 목록:");
  for (const error of errors) {
    console.log(
      `- index=${error.index ?? "-"} questionId=${error.questionId ?? "-"} field=${error.field} code=${error.code}`,
    );
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
    console.error("필수 인자가 없습니다: --input <json-path>");
    console.error(HELP_TEXT);
    return 2;
  }

  let result;

  try {
    result = loadQuestionSet(args.input);
  } catch (error) {
    console.error(`질문셋을 불러오지 못했습니다: ${error.code ?? "UNKNOWN_ERROR"}`);
    return 2;
  }

  const totalCount = Array.isArray(result.data) ? result.data.length : 0;

  console.log("RAG 질문셋 검증 결과");
  console.log(`총 항목 수: ${totalCount}`);
  console.log(`오류 수: ${result.errors.length}`);

  if (result.errors.length > 0) {
    printErrors(result.errors);
    return 2;
  }

  return 0;
}

process.exitCode = main();
