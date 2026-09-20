import path from "node:path";
import { pathToFileURL } from "node:url";

import { compareEvaluationReports, loadEvaluationReport } from "./rag-eval/compare-reports.mjs";

const HELP_TEXT = `Usage: node scripts/compare-rag-reports.mjs --baseline <baseline.json> --candidate <candidate.json>

Compares two de-identified schemaVersion-1 RAG evaluation reports and reports
whether the candidate regressed or improved relative to the baseline.
No external API, database, or environment variable access is performed.

Options:
  --baseline <path>   Path to the baseline report JSON file (required)
  --candidate <path>  Path to the candidate report JSON file (required)
  --help              Show this help message

Exit codes:
  0  Valid comparison, no regression
  1  Valid comparison, regression found
  2  Invalid arguments, file read error, JSON syntax error, or report schema error
`;

function parseArgs(argv) {
  const parsed = { baseline: null, candidate: null, help: false, unknown: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--baseline" || arg === "--candidate") {
      const value = argv[i + 1];
      if (typeof value !== "string" || value.startsWith("--")) {
        parsed.unknown.push(`${arg} (missing value)`);
        continue;
      }
      if (arg === "--baseline") parsed.baseline = value;
      if (arg === "--candidate") parsed.candidate = value;
      i += 1;
      continue;
    }

    parsed.unknown.push(arg);
  }

  return parsed;
}

function pathsPointToSameFile(a, b) {
  return path.resolve(a) === path.resolve(b);
}

function loadReportOrCollectError(filePath, fileRole, errors) {
  try {
    const result = loadEvaluationReport(filePath, fileRole);
    if (!result.valid) {
      errors.push(...result.errors);
      return null;
    }
    return result.data;
  } catch (error) {
    errors.push({ fileRole, index: null, questionId: null, field: "root", code: error.code ?? "UNKNOWN_ERROR" });
    return null;
  }
}

function printErrors(errors) {
  console.log("오류 목록:");
  for (const error of errors) {
    console.log(
      `- fileRole=${error.fileRole} index=${error.index ?? "-"} questionId=${error.questionId ?? "-"} field=${error.field} code=${error.code}`,
    );
  }
}

function formatRateDelta(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(4)}`;
}

function formatCountDelta(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}`;
}

function printGroupList(label, entries) {
  if (entries.length === 0) {
    return;
  }

  console.log(`${label} questionId 목록:`);
  for (const entry of entries) {
    const parts = [`questionId=${entry.questionId}`];
    if (entry.baseline) {
      parts.push(
        `baseline(passed=${entry.baseline.passed},failed=${entry.baseline.failed},errors=${entry.baseline.errors})`,
      );
    }
    if (entry.candidate) {
      parts.push(
        `candidate(passed=${entry.candidate.passed},failed=${entry.candidate.failed},errors=${entry.candidate.errors})`,
      );
    }
    console.log(`- ${parts.join(" ")}`);
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

  if (!args.baseline) {
    console.error("필수 인자가 없습니다: --baseline <baseline.json>");
    return 2;
  }

  if (!args.candidate) {
    console.error("필수 인자가 없습니다: --candidate <candidate.json>");
    return 2;
  }

  if (pathsPointToSameFile(args.baseline, args.candidate)) {
    console.error("baseline과 candidate 경로가 같습니다.");
    return 2;
  }

  const errors = [];
  const baselineReport = loadReportOrCollectError(args.baseline, "baseline", errors);
  const candidateReport = loadReportOrCollectError(args.candidate, "candidate", errors);

  if (errors.length > 0 || !baselineReport || !candidateReport) {
    console.error(`리포트 검증 오류: ${errors.length}건`);
    printErrors(errors);
    return 2;
  }

  const comparison = compareEvaluationReports(baselineReport, candidateReport);

  console.log("리포트 비교 결과");
  console.log(`baseline 총 ${comparison.baselineSummary.total}건, candidate 총 ${comparison.candidateSummary.total}건`);
  console.log(`passRate 변화: ${formatRateDelta(comparison.deltas.passRate)}`);
  console.log(`statusAccuracy 변화: ${formatRateDelta(comparison.deltas.statusAccuracy)}`);
  console.log(`keywordPassRate 변화: ${formatRateDelta(comparison.deltas.keywordPassRate)}`);
  console.log(`forbiddenViolations 변화: ${formatCountDelta(comparison.deltas.forbiddenViolations)}`);
  console.log(`errorCount 변화: ${formatCountDelta(comparison.deltas.errorCount)}`);
  console.log(
    `questionId 그룹: 비교 ${comparison.questionGroups.compared}건, 회귀 ${comparison.questionGroups.regressed.length}건, 개선 ${comparison.questionGroups.improved.length}건, 추가 ${comparison.questionGroups.added.length}건, 제거 ${comparison.questionGroups.removed.length}건`,
  );

  printGroupList("회귀", comparison.questionGroups.regressed);
  printGroupList("개선", comparison.questionGroups.improved);
  printGroupList("추가", comparison.questionGroups.added);
  printGroupList("제거", comparison.questionGroups.removed);

  return comparison.hasRegression ? 1 : 0;
}

export { main };

const isDirectlyExecuted = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectlyExecuted) {
  process.exitCode = main();
}
