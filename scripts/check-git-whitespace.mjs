import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

// Fixed Git constants (not attacker-controlled): the well-known empty-tree
// object hash, and the all-zero SHA GitHub uses for "no previous commit".
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const ZERO_SHA = "0".repeat(40);
const SHA_PATTERN = /^[0-9a-f]{40}$/;

function isValidSha(value) {
  return typeof value === "string" && SHA_PATTERN.test(value);
}

function isMissingOrZeroSha(value) {
  return value === undefined || value === null || value === "" || value === ZERO_SHA;
}

/**
 * Pure decision function: given environment-like input, decides which
 * `git diff --check` invocation(s) are appropriate. Never touches the
 * filesystem or spawns a process, so it can be unit tested without git.
 *
 * - Outside GitHub Actions: check the local worktree and the staged index,
 *   mirroring what a developer would run by hand before committing.
 * - `pull_request`: check exactly what the PR introduces (base...head).
 * - `push`: check what this push introduced (before..after), falling back
 *   to a diff against the empty tree when there is no previous commit
 *   (first push of a new branch).
 * - Anything else in CI (missing/malformed SHAs, unrecognized event) fails
 *   closed instead of silently skipping the check.
 */
function determineWhitespaceCheckPlan(env = {}) {
  if (env.GITHUB_ACTIONS !== "true") {
    return {
      status: "ok",
      mode: "local",
      commands: [
        ["diff", "--check"],
        ["diff", "--cached", "--check"],
      ],
    };
  }

  if (env.GITHUB_EVENT_NAME === "pull_request") {
    if (!isValidSha(env.PR_BASE_SHA) || !isValidSha(env.PR_HEAD_SHA)) {
      return { status: "error", reason: "PR_BASE_SHA or PR_HEAD_SHA is missing or is not a valid Git SHA." };
    }

    return {
      status: "ok",
      mode: "pull_request",
      commands: [["diff", "--check", `${env.PR_BASE_SHA}...${env.PR_HEAD_SHA}`]],
    };
  }

  if (env.GITHUB_EVENT_NAME === "push") {
    if (!isValidSha(env.PUSH_AFTER_SHA)) {
      return { status: "error", reason: "PUSH_AFTER_SHA is missing or is not a valid Git SHA." };
    }

    if (isMissingOrZeroSha(env.PUSH_BEFORE_SHA)) {
      return {
        status: "ok",
        mode: "push-initial",
        commands: [["diff", "--check", `${EMPTY_TREE_SHA}..${env.PUSH_AFTER_SHA}`]],
      };
    }

    if (!isValidSha(env.PUSH_BEFORE_SHA)) {
      return { status: "error", reason: "PUSH_BEFORE_SHA is not a valid Git SHA." };
    }

    return {
      status: "ok",
      mode: "push",
      commands: [["diff", "--check", `${env.PUSH_BEFORE_SHA}..${env.PUSH_AFTER_SHA}`]],
    };
  }

  return { status: "error", reason: "Unsupported CI event for the whitespace check." };
}

// shell:false + an argv array (never a joined command string) means a SHA/ref
// value is passed straight to the OS process and can never be re-parsed by a
// shell, so it cannot inject extra shell commands even if it were untrusted.
function defaultRunGitDiffCheck(args, { cwd = process.cwd() } = {}) {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, stdio: "inherit", shell: false });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(typeof code === "number" ? code : 1));
  });
}

async function main({
  env = process.env,
  cwd = process.cwd(),
  runGitDiffCheck = defaultRunGitDiffCheck,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const plan = determineWhitespaceCheckPlan(env);

  if (plan.status === "error") {
    stderr(`[check-git-whitespace] ${plan.reason}`);
    return 1;
  }

  for (const args of plan.commands) {
    const exitCode = await runGitDiffCheck(args, { cwd });
    if (exitCode !== 0) {
      stderr(`[check-git-whitespace] whitespace/conflict-marker check failed (mode: ${plan.mode})`);
      return exitCode;
    }
  }

  stdout(`[check-git-whitespace] OK (mode: ${plan.mode})`);
  return 0;
}

export {
  EMPTY_TREE_SHA,
  ZERO_SHA,
  SHA_PATTERN,
  isValidSha,
  determineWhitespaceCheckPlan,
  defaultRunGitDiffCheck,
  main,
};

const isDirectlyExecuted = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectlyExecuted) {
  process.exitCode = await main();
}
