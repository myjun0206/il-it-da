import { pathToFileURL } from "node:url";

import {
  BASELINE_THRESHOLDS,
  analyzeThresholds,
  generateThresholdPairs,
  loadCalibrationDataset,
} from "./rag-eval/threshold-calibration.mjs";

const HELP_TEXT = `Usage: node scripts/calibrate-rag-thresholds.mjs --input <json-path> [options]

Offline calibration tool: compares candidate answered/cautious threshold
combinations against a de-identified calibration dataset (no question/answer
text, no store name, no UUID). Does not call Supabase/OpenAI/any real API, and
does not change the current runtime threshold (0.60/0.40). This tool only
reports ranked candidates for a human to review — it never auto-selects a
"best"/"optimal" value.

Options:
  --input <path>         Path to the calibration dataset JSON file (required)
  --top <n>               Number of top candidates to show (default: 10)
  --step <number>          Threshold grid step (default: 0.01)
  --answered-min <number>  Lower bound for answeredThreshold (default: 0.50)
  --answered-max <number>  Upper bound for answeredThreshold (default: 0.90)
  --cautious-min <number>  Lower bound for cautiousThreshold (default: 0.20)
  --cautious-max <number>  Upper bound for cautiousThreshold (default: 0.70)
  --help                   Show this help message

Exit codes:
  0  Analysis completed (quality results themselves never cause a non-zero exit)
  2  Invalid arguments, file, JSON, or schema error
`;

const NUMBER_OPTIONS = Object.freeze({
  "--step": "step",
  "--answered-min": "answeredMin",
  "--answered-max": "answeredMax",
  "--cautious-min": "cautiousMin",
  "--cautious-max": "cautiousMax",
});

function parseArgs(argv) {
  const parsed = {
    input: null,
    top: 10,
    step: null,
    answeredMin: null,
    answeredMax: null,
    cautiousMin: null,
    cautiousMax: null,
    help: false,
    unknown: [],
  };

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

    if (arg === "--top") {
      const value = argv[i + 1];
      const num = Number(value);
      if (typeof value !== "string" || value.startsWith("--") || !Number.isInteger(num) || num <= 0) {
        parsed.unknown.push(`${arg} (must be a positive integer)`);
      } else {
        parsed.top = num;
        i += 1;
      }
      continue;
    }

    if (arg in NUMBER_OPTIONS) {
      const value = argv[i + 1];
      const num = Number(value);
      if (typeof value !== "string" || value.startsWith("--") || Number.isNaN(num)) {
        parsed.unknown.push(`${arg} (must be a number)`);
      } else {
        parsed[NUMBER_OPTIONS[arg]] = num;
        i += 1;
      }
      continue;
    }

    parsed.unknown.push(arg);
  }

  return parsed;
}

function resolveRangeConfig(args) {
  const config = {};
  if (args.step !== null) config.step = args.step;
  if (args.answeredMin !== null) config.answeredMin = args.answeredMin;
  if (args.answeredMax !== null) config.answeredMax = args.answeredMax;
  if (args.cautiousMin !== null) config.cautiousMin = args.cautiousMin;
  if (args.cautiousMax !== null) config.cautiousMax = args.cautiousMax;
  return config;
}

function formatPercent(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-";
}

function formatPair(pair) {
  return `answered=${pair.answeredThreshold.toFixed(2)} cautious=${pair.cautiousThreshold.toFixed(2)}`;
}

function formatMetricsLine(label, metrics) {
  if (!metrics) {
    return `${label}: (no data)`;
  }
  return [
    `${label}: total=${metrics.total}`,
    `statusAccuracy=${formatPercent(metrics.statusAccuracy)}`,
    `answeredP=${formatPercent(metrics.answeredPrecision)}`,
    `answeredR=${formatPercent(metrics.answeredRecall)}`,
    `cautiousP=${formatPercent(metrics.cautiousPrecision)}`,
    `insufficientR=${formatPercent(metrics.insufficientRecall)}`,
    `macroF1=${formatPercent(metrics.macroF1)}`,
    `coverage=${formatPercent(metrics.coverage)}`,
    `falseAnswered=${metrics.falseAnsweredCount}`,
    `incorrectAnswered=${metrics.incorrectAnsweredCount}`,
    `scopeUnsafeAnswered=${metrics.scopeUnsafeAnsweredCount}`,
  ].join(" ");
}

function formatWarning(warning) {
  if (warning.code === "MISSING_STATUS_CLASS") return `${warning.code} status=${warning.status}`;
  if (warning.code === "GROUP_PARTITION_LEAKAGE") return `${warning.code} groupIds=${warning.groupIds.join(",")}`;
  if (warning.code === "LOW_CASE_COUNT") return `${warning.code} count=${warning.count}`;
  return warning.code;
}

function printAnalysis(analysis, totalCount, stdout) {
  const hasLeakageNotice = analysis.notices.some((notice) => notice.code === "GROUP_PARTITION_LEAKAGE");
  const validationLabel = hasLeakageNotice ? "  validation (진단 참고용, 독립 검증 아님)" : "  validation";

  stdout("RAG 임계값 오프라인 보정 분석 결과 (참고용 상위 후보, 자동 확정 아님)");
  stdout(`입력 건수: ${totalCount}`);
  stdout(`calibration 건수: ${analysis.calibrationCount}`);
  stdout(`validation 건수: ${analysis.validationCount}`);
  stdout(`scopeSafe=false 사례 수: ${analysis.scopeUnsafeCaseCount}`);
  stdout(`calibrationEligible: ${analysis.calibrationEligible}`);

  if (analysis.notices.length > 0) {
    stdout("\n중요 안내:");
    for (const notice of analysis.notices) {
      stdout(`- ${notice.message}`);
    }
  }

  if (!analysis.calibrationEligible) {
    stdout(
      "\n(주의: calibrationEligible=false. 아래 결과는 배포 가능한 추천이나 선택 가능한 최종 후보가 아니라 진단 참고용입니다.)",
    );
  }

  stdout(`\n[baseline ${formatPair(BASELINE_THRESHOLDS)}]`);
  stdout(formatMetricsLine("  calibration", analysis.baseline.metrics));
  stdout(formatMetricsLine(validationLabel, analysis.baseline.validationMetrics));

  stdout(`\n[상위 후보 ${analysis.topCandidates.length}개] ("최적 임계값"이 아닌 참고용 순위)`);
  for (const candidate of analysis.topCandidates) {
    stdout(`\n- rank ${candidate.rank} ${formatPair(candidate.pair)}`);
    stdout(formatMetricsLine("  calibration", candidate.metrics));
    stdout(formatMetricsLine(validationLabel, candidate.validationMetrics));
  }

  if (analysis.warnings.length > 0) {
    // SCOPE_UNSAFE_CASES_PRESENT / GROUP_PARTITION_LEAKAGE are already shown once, more
    // prominently, in the "중요 안내" notices section above — never print the same code twice.
    const noticeCodes = new Set(["SCOPE_UNSAFE_CASES_PRESENT", "GROUP_PARTITION_LEAKAGE"]);
    const remainingWarnings = analysis.warnings.filter((warning) => !noticeCodes.has(warning.code));

    if (remainingWarnings.length > 0) {
      stdout("\n경고:");
      for (const warning of remainingWarnings) {
        stdout(`- ${formatWarning(warning)}`);
      }
    }
  }
}

async function main(
  argv = process.argv.slice(2),
  {
    loadDataset = loadCalibrationDataset,
    stdout = console.log,
    stderr = console.error,
  } = {},
) {
  const args = parseArgs(argv);

  if (args.help) {
    stdout(HELP_TEXT);
    return 0;
  }

  if (args.unknown.length > 0) {
    stderr(`Invalid argument: ${args.unknown.join(", ")}`);
    stderr(HELP_TEXT);
    return 2;
  }

  if (!args.input) {
    stderr("Missing required argument: --input <json-path>");
    stderr(HELP_TEXT);
    return 2;
  }

  let loadResult;
  try {
    loadResult = loadDataset(args.input);
  } catch (error) {
    stderr(`Failed to load calibration dataset: ${error?.code ?? "UNKNOWN_ERROR"}`);
    return 2;
  }

  if (!loadResult.valid) {
    stderr(`Calibration dataset failed schema validation (${loadResult.errors.length} error(s)).`);
    for (const error of loadResult.errors) {
      stderr(`- index=${error.index ?? "-"} caseId=${error.caseId ?? "-"} field=${error.field} code=${error.code}`);
    }
    return 2;
  }

  let pairs;
  try {
    pairs = generateThresholdPairs(resolveRangeConfig(args));
  } catch (error) {
    stderr(`Invalid threshold range option: ${error?.code ?? "THRESHOLD_RANGE_INVALID"}`);
    return 2;
  }

  const analysis = analyzeThresholds(loadResult.data, { pairs, top: args.top });

  printAnalysis(analysis, loadResult.data.length, stdout);

  return 0;
}

export { formatMetricsLine, formatPair, formatWarning, main, parseArgs, resolveRangeConfig };

const isDirectlyExecuted = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectlyExecuted) {
  process.exitCode = await main();
}
