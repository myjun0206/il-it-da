import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const HELP_TEXT = `Usage: node scripts/verify-poc.mjs [--help]

Runs the full PoC integration verification sequence, one step at a time:
  1. check:integration
  2. test:integration
  3. test:rag
  4. test:rag-eval
  5. lint
  6. typecheck (tsc --noEmit)
  7. build

Stops at the first failing step. No environment variable values, file
contents, question/answer text, UUIDs, API keys, or tokens are printed by
this runner. Child process output is inherited as-is.

Exit codes:
  0  All steps passed
  2  Invalid arguments
  *  The exit code of the first failing step is preserved
`;

const STEPS = [
  { name: "check:integration", command: "npm", args: ["run", "check:integration"] },
  { name: "test:integration", command: "npm", args: ["run", "test:integration"] },
  { name: "test:rag", command: "npm", args: ["run", "test:rag"] },
  { name: "test:rag-eval", command: "npm", args: ["run", "test:rag-eval"] },
  { name: "lint", command: "npm", args: ["run", "lint"] },
  { name: "typecheck", command: "npx", args: ["tsc", "--noEmit"] },
  { name: "build", command: "npm", args: ["run", "build"] },
];

// npm/npx are shell shims on Windows (.cmd) and cannot be spawned directly
// without a shell. Every step's command/args are fixed literals defined in
// STEPS above (never user input), so joining them into a single string for
// shell:true is safe and also avoids Node's DEP0190 array-escaping warning.
function defaultRunCommand(step, { cwd = process.cwd() } = {}) {
  return new Promise((resolve) => {
    const commandLine = [step.command, ...step.args].join(" ");
    const child = spawn(commandLine, {
      cwd,
      stdio: "inherit",
      shell: true,
    });
    child.on("error", () => resolve(1));
    child.on("close", (code) => {
      resolve(typeof code === "number" ? code : 1);
    });
  });
}

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
    stderr("Invalid verify-poc argument. Use --help for usage.");
    return 2;
  }

  let passed = 0;
  for (const step of steps) {
    const exitCode = await runCommand(step, { cwd });

    if (exitCode !== 0) {
      stderr(`FAIL step ${passed + 1}/${steps.length}: ${step.name} (exit code ${exitCode})`);
      return exitCode;
    }

    passed += 1;
  }

  stdout(`Passed steps: ${passed}/${steps.length}`);
  stdout("PASS");
  return 0;
}

export { HELP_TEXT, STEPS, defaultRunCommand, main, parseArgs };

const isDirectlyExecuted = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectlyExecuted) {
  process.exitCode = await main();
}
