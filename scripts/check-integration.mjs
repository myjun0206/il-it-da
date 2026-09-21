import path from "node:path";
import { pathToFileURL } from "node:url";

import { checkRepository } from "./integration-check/check-repository.mjs";

const HELP_TEXT = `Usage: node scripts/check-integration.mjs [--help]

Runs local, read-only repository integration readiness checks.
No database, external API, or environment variable value is accessed.

Exit codes:
  0  All required checks passed; warnings may be present
  1  One or more integration-blocking errors were found
  2  Invalid arguments or the checker could not run
`;

function parseArgs(argv) {
  const help = argv.includes("--help") || argv.includes("-h");
  const unknown = argv.filter((arg) => arg !== "--help" && arg !== "-h");
  return { help, unknown };
}

function formatResult(item) {
  const location = item.file ? ` ${item.file}` : "";
  return `[${item.level}] ${item.code}${location} - ${item.message}`;
}

async function main(
  argv = process.argv.slice(2),
  {
    rootDir = process.cwd(),
    runChecks = checkRepository,
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
    stderr("Invalid integration-check argument. Use --help for usage.");
    return 2;
  }

  let report;
  try {
    report = await runChecks({ rootDir: path.resolve(rootDir) });
  } catch {
    stderr("Integration check could not be completed.");
    return 2;
  }

  stdout(`Checks: ${report.summary.checks}`);
  stdout(`Errors: ${report.summary.errors}`);
  stdout(`Warnings: ${report.summary.warnings}`);
  stdout(`Info: ${report.summary.info}`);

  for (const item of report.results) {
    stdout(formatResult(item));
  }

  stdout(report.exitCode === 0 ? "PASS" : "FAIL");
  return report.exitCode;
}

export { HELP_TEXT, formatResult, main, parseArgs };

const isDirectlyExecuted = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectlyExecuted) {
  process.exitCode = await main();
}