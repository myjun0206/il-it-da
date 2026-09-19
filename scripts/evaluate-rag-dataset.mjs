import { loadQuestionSet } from "./rag-eval/question-set.mjs";
import { loadStoreMap, createStoreMap } from "./rag-eval/store-map.mjs";
import { runEvaluation } from "./rag-eval/run-evaluation.mjs";

const DEFAULT_ENDPOINT = "http://localhost:3000/api/rag/query";
const VERBOSE_WARNING =
  "상세 모드에서는 질문과 답변 원문이 터미널 또는 CI 로그에 남을 수 있습니다.";

const HELP_TEXT = `Usage: node scripts/evaluate-rag-dataset.mjs --input <question-set.json> --stores <store-map.json> [--endpoint <url>] [--verbose]

Loads a validated QA question set and store map, calls the local RAG API for
each case, grades the responses, and prints a de-identified summary.

Options:
  --input <path>     Path to the QA question set JSON file (required)
  --stores <path>    Path to the store map JSON file (required)
  --endpoint <url>   RAG query endpoint (default: ${DEFAULT_ENDPOINT})
  --verbose          Print question/answer text for each case (local use only)
  --help             Show this help message

Exit codes:
  0  All cases passed
  1  One or more API errors or quality failures
  2  Invalid arguments, or a question set / store map failed to load or validate
`;

function parseArgs(argv) {
  const parsed = {
    input: null,
    stores: null,
    endpoint: DEFAULT_ENDPOINT,
    verbose: false,
    help: false,
    unknown: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--verbose") {
      parsed.verbose = true;
      continue;
    }

    if (arg === "--input" || arg === "--stores" || arg === "--endpoint") {
      const value = argv[i + 1];
      if (typeof value !== "string" || value.startsWith("--")) {
        parsed.unknown.push(`${arg} (missing value)`);
        continue;
      }
      if (arg === "--input") parsed.input = value;
      if (arg === "--stores") parsed.stores = value;
      if (arg === "--endpoint") parsed.endpoint = value;
      i += 1;
      continue;
    }

    parsed.unknown.push(arg);
  }

  return parsed;
}

function validateEndpoint(rawEndpoint) {
  let url;

  try {
    url = new URL(rawEndpoint);
  } catch {
    return { valid: false, code: "INVALID_ENDPOINT_URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { valid: false, code: "UNSUPPORTED_ENDPOINT_PROTOCOL" };
  }

  if (url.username || url.password) {
    return { valid: false, code: "ENDPOINT_CONTAINS_USERINFO" };
  }

  return { valid: true };
}

function printSchemaErrors(errors) {
  console.log("오류 목록:");
  for (const error of errors) {
    console.log(
      `- index=${error.index ?? "-"} id=${error.questionId ?? error.name ?? "-"} field=${error.field} code=${error.code}`,
    );
  }
}

function printCaseResults(results) {
  console.log("케이스별 결과:");

  for (const result of results) {
    if (result.error === true) {
      console.log(`- case=${result.questionId ?? "-"} error=true code=${result.code ?? "-"}`);
      continue;
    }

    console.log(
      `- case=${result.questionId ?? "-"} expectedStatus=${result.expectedStatus ?? "-"} actualStatus=${result.actualStatus ?? "-"} statusMatched=${result.statusMatched} keywordPassed=${result.keywordPassed} forbiddenPassed=${result.forbiddenPassed} pass=${result.pass}`,
    );
  }
}

function printSummary(summary) {
  console.log("전체 요약:");
  console.log(
    `총 ${summary.total}건, 통과 ${summary.passed}건, 실패 ${summary.failed}건, 오류 ${summary.errorCount}건`,
  );
  console.log(
    `passRate=${summary.passRate.toFixed(4)} statusAccuracy=${summary.statusAccuracy.toFixed(4)} keywordPassRate=${summary.keywordPassRate.toFixed(4)} forbiddenViolations=${summary.forbiddenViolations}`,
  );
}

function createVerboseCaseLogger() {
  return (detail) => {
    console.log(`[verbose] case=${detail.questionId ?? "-"} store=${detail.targetStoreName ?? "-"}`);
    if (typeof detail.question === "string") {
      console.log(`[verbose] question: ${detail.question}`);
    }
    if (typeof detail.answer === "string") {
      console.log(`[verbose] answer: ${detail.answer}`);
    }
  };
}

async function main() {
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
    console.error("필수 인자가 없습니다: --input <question-set.json>");
    return 2;
  }

  if (!args.stores) {
    console.error("필수 인자가 없습니다: --stores <store-map.json>");
    return 2;
  }

  const endpointCheck = validateEndpoint(args.endpoint);
  if (!endpointCheck.valid) {
    console.error(`잘못된 --endpoint 값입니다: ${endpointCheck.code}`);
    return 2;
  }

  let questionSetResult;
  try {
    questionSetResult = loadQuestionSet(args.input);
  } catch (error) {
    console.error(`질문셋을 불러오지 못했습니다: ${error.code ?? "UNKNOWN_ERROR"}`);
    return 2;
  }

  if (!questionSetResult.valid) {
    console.error(`질문셋 스키마 오류: ${questionSetResult.errors.length}건`);
    printSchemaErrors(questionSetResult.errors);
    return 2;
  }

  let storeMapResult;
  try {
    storeMapResult = loadStoreMap(args.stores);
  } catch (error) {
    console.error(`매장 매핑을 불러오지 못했습니다: ${error.code ?? "UNKNOWN_ERROR"}`);
    return 2;
  }

  if (!storeMapResult.valid) {
    console.error(`매장 매핑 스키마 오류: ${storeMapResult.errors.length}건`);
    printSchemaErrors(storeMapResult.errors);
    return 2;
  }

  if (args.verbose) {
    console.warn(VERBOSE_WARNING);
  }

  const storeMap = createStoreMap(storeMapResult.data);

  const { results, summary } = await runEvaluation({
    questionSet: questionSetResult.data,
    storeMap,
    endpoint: args.endpoint,
    onCaseResult: args.verbose ? createVerboseCaseLogger() : undefined,
  });

  printCaseResults(results);
  printSummary(summary);

  const hasFailure = results.some((result) => result.error === true || result.pass === false);
  return hasFailure ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`예상치 못한 오류가 발생했습니다: ${error?.code ?? error?.name ?? "UNKNOWN_ERROR"}`);
    process.exitCode = 2;
  });
