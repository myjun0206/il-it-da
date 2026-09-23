import { pathToFileURL } from "node:url";

import { defaultRunCommand, main as runSteps } from "./verify-poc.mjs";

const HELP_TEXT = `Usage: node scripts/check-frontend.mjs [--help]

Runs the frontend quality gate, one step at a time:
  1. lint
  2. typecheck (npm run typecheck: next typegen then tsc --noEmit)
  3. build
  4. git diff --check (scripts/check-git-whitespace.mjs: local worktree/staged
     diff locally, PR base...head range on pull_request, before..after range
     on push, with a safe empty-tree fallback for a branch's first push)
  5. test:frontend (route/layout structure regression tests)

Stops at the first failing step. No environment variable values, file
contents, question/answer text, UUIDs, API keys, or tokens are printed by
this runner. Child process output is inherited as-is.

Exit codes:
  0  All steps passed
  2  Invalid arguments
  *  The exit code of the first failing step is preserved
`;

// Reuses verify-poc.mjs's step-runner contract (fail-fast, exit-code
// preservation, "Passed steps: N/N" + "PASS" output) instead of duplicating it.
const STEPS = [
  { name: "lint", command: "npm", args: ["run", "lint"] },
  { name: "typecheck", command: "npm", args: ["run", "typecheck"] },
  { name: "build", command: "npm", args: ["run", "build"] },
  { name: "git diff --check", command: "node", args: ["scripts/check-git-whitespace.mjs"] },
  { name: "test:frontend", command: "npm", args: ["run", "test:frontend"] },
];

function parseArgs(argv) {
  const help = argv.includes("--help") || argv.includes("-h");
  const unknown = argv.filter((arg) => arg !== "--help" && arg !== "-h");
  return { help, unknown };
}

async function main(
  argv = process.argv.slice(2),
  {
    steps = STEPS,
    runCommand = defaultRunCommand,
    cwd = process.cwd(),
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
    stderr("Invalid check-frontend argument. Use --help for usage.");
    return 2;
  }

  return runSteps([], { steps, runCommand, cwd, stdout, stderr });
}

export { HELP_TEXT, STEPS, main, parseArgs };

const isDirectlyExecuted = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectlyExecuted) {
  process.exitCode = await main();
}
