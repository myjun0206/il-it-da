import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  "coverage",
  "dist",
  "build",
  "output",
  "outputs",
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const REQUIRED_MIGRATION_PREFIXES = [1, 2, 3, 4, 5, 6];
const OPTIONAL_TEAM_MIGRATION_PREFIXES = new Set([7, 8, 9]);
const REQUIRED_PACKAGE_SCRIPTS = [
  "lint",
  "build",
  "test:rag",
  "test:rag-eval",
  "check:integration",
  "test:integration",
];
const REQUIRED_FILES = [
  "app/api/rag/query/route.ts",
  "app/api/rag/upload/route.ts",
  "app/api/webhooks/index-manual/route.ts",
  "lib/supabase/admin.ts",
  "lib/rag/index-approved-manual.ts",
  "lib/rag/search-manual-chunks.ts",
  "lib/rag/save-question-log.ts",
  "supabase/migrations/001_initial_rag_schema.sql",
  "supabase/migrations/006_auth_store_memberships.sql",
];

function result(level, code, message, file) {
  return file ? { level, code, message, file } : { level, code, message };
}

function toRepositoryPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isEnvironmentFile(filePath) {
  const name = path.posix.basename(toRepositoryPath(filePath));
  return name === ".env" || name.startsWith(".env.");
}

function isAllowedEnvironmentExample(filePath) {
  const name = path.posix.basename(toRepositoryPath(filePath));
  return name === ".env.example" || name === ".env.local.example" || name === ".env.test.example";
}

function hasConflictBlock(content) {
  let state = "outside";

  for (const line of content.split(/\r?\n/)) {
    if (/^<{7}(?: .*)?$/.test(line)) {
      state = "ours";
    } else if (state === "ours" && /^={7}$/.test(line)) {
      state = "theirs";
    } else if (state === "theirs" && /^>{7}(?: .*)?$/.test(line)) {
      return true;
    }
  }

  return false;
}

function checkConflictMarkers(files) {
  return files
    .filter(({ content }) => hasConflictBlock(content))
    .map(({ file }) => result(
      "error",
      "MERGE_CONFLICT_MARKER_FOUND",
      "A complete Git merge conflict marker block was found.",
      file,
    ));
}

function parseMigrationPrefix(fileName) {
  const match = /^(\d+)_/.exec(fileName);
  return match ? Number.parseInt(match[1], 10) : null;
}

function analyzeMigrationNames(fileNames) {
  const results = [];
  const sqlNames = fileNames.filter((name) => name.toLowerCase().endsWith(".sql"));
  const byPrefix = new Map();
  const prefixedMigrations = [];

  for (const fileName of sqlNames) {
    const prefix = parseMigrationPrefix(fileName);
    if (prefix === null) {
      results.push(result(
        "warning",
        "MIGRATION_PREFIX_MISSING",
        "A SQL migration file does not have a numeric prefix.",
        `supabase/migrations/${fileName}`,
      ));
      continue;
    }

    const names = byPrefix.get(prefix) ?? [];
    names.push(fileName);
    byPrefix.set(prefix, names);
    prefixedMigrations.push({ fileName, prefix });
  }

  const lexicalPrefixes = prefixedMigrations
    .toSorted((left, right) => left.fileName.localeCompare(right.fileName, "en"));
  for (let index = 1; index < lexicalPrefixes.length; index += 1) {
    if (lexicalPrefixes[index].prefix < lexicalPrefixes[index - 1].prefix) {
      results.push(result(
        "warning",
        "MIGRATION_PREFIX_ORDER_MISMATCH",
        "Migration filename ordering does not match numeric prefix ordering.",
        `supabase/migrations/${lexicalPrefixes[index].fileName}`,
      ));
      break;
    }
  }

  for (const [prefix, names] of byPrefix) {
    if (names.length > 1) {
      for (const fileName of names) {
        results.push(result(
          "error",
          "MIGRATION_PREFIX_DUPLICATED",
          `Migration prefix ${String(prefix).padStart(3, "0")} is used more than once.`,
          `supabase/migrations/${fileName}`,
        ));
      }
    }
  }

  for (const prefix of REQUIRED_MIGRATION_PREFIXES) {
    if (!byPrefix.has(prefix)) {
      results.push(result(
        "error",
        "REQUIRED_MIGRATION_MISSING",
        `Required migration prefix ${String(prefix).padStart(3, "0")} is missing.`,
        "supabase/migrations",
      ));
    }
  }

  const prefixes = [...byPrefix.keys()].sort((left, right) => left - right);
  if (prefixes.length > 1) {
    for (let prefix = prefixes[0]; prefix < prefixes.at(-1); prefix += 1) {
      if (!byPrefix.has(prefix) && !OPTIONAL_TEAM_MIGRATION_PREFIXES.has(prefix)) {
        results.push(result(
          "info",
          "MIGRATION_PREFIX_GAP",
          `Migration prefix ${String(prefix).padStart(3, "0")} is not present.`,
          "supabase/migrations",
        ));
      }
    }
  }

  return results;
}

function checkPackageScripts(packageJson) {
  const scripts = packageJson && typeof packageJson === "object" && packageJson.scripts
    && typeof packageJson.scripts === "object"
    ? packageJson.scripts
    : {};

  return REQUIRED_PACKAGE_SCRIPTS
    .filter((scriptName) => typeof scripts[scriptName] !== "string" || !scripts[scriptName].trim())
    .map((scriptName) => result(
      "error",
      "REQUIRED_PACKAGE_SCRIPT_MISSING",
      `Required package script ${scriptName} is missing.`,
      "package.json",
    ));
}

function checkRequiredFiles(existingFiles) {
  const fileSet = existingFiles instanceof Set ? existingFiles : new Set(existingFiles);
  return REQUIRED_FILES
    .filter((file) => !fileSet.has(file))
    .map((file) => result("error", "REQUIRED_FILE_MISSING", "A required PoC file is missing.", file));
}

function isClientComponent(content) {
  return /^\s*["']use client["'];/m.test(content);
}

function checkServiceRoleExposure(files) {
  const results = [];

  for (const { file, content } of files) {
    if (file.startsWith("tests/") || !SOURCE_EXTENSIONS.has(path.posix.extname(file))) {
      continue;
    }

    if (/NEXT_PUBLIC_[A-Z0-9_]*SERVICE_ROLE[A-Z0-9_]*/i.test(content)) {
      results.push(result(
        "error",
        "PUBLIC_SERVICE_ROLE_ENV_FOUND",
        "A public environment variable name appears to reference a service role.",
        file,
      ));
    }

    if (!isClientComponent(content)) {
      continue;
    }

    if (/SUPABASE_SERVICE_ROLE_KEY/.test(content)) {
      results.push(result(
        "error",
        "CLIENT_SERVICE_ROLE_REFERENCE_FOUND",
        "A client component references the service role environment variable.",
        file,
      ));
    }

    if (/\bcreateAdminClient\b/.test(content) || /(?:from\s*|import\s*\()["'][^"']*lib\/supabase\/admin["']/.test(content)) {
      results.push(result(
        "error",
        "CLIENT_ADMIN_IMPORT_FOUND",
        "A client component references the server-only Supabase admin client.",
        file,
      ));
    }

    if (/service_role/i.test(content)) {
      results.push(result(
        "warning",
        "CLIENT_SERVICE_ROLE_STRING_FOUND",
        "A client component contains a service role string.",
        file,
      ));
    }
  }

  return results;
}

function checkTrackedEnvironmentFiles(trackedFiles) {
  return trackedFiles
    .map(toRepositoryPath)
    .filter((file) => isEnvironmentFile(file) && !isAllowedEnvironmentExample(file))
    .map((file) => result(
      "error",
      "TRACKED_ENV_FILE_FOUND",
      "A non-example environment file is tracked by Git.",
      file,
    ));
}

function checkRagThresholds(content, file = "app/api/rag/query/route.ts") {
  const expected = new Map([
    ["ANSWERED_THRESHOLD", 0.6],
    ["CAUTIOUS_THRESHOLD", 0.4],
  ]);
  const results = [];

  for (const [name, expectedValue] of expected) {
    const match = new RegExp(`\\bconst\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`).exec(content);
    if (!match) {
      results.push(result("error", "RAG_THRESHOLD_NOT_FOUND", "A required RAG threshold was not found.", file));
    } else if (Number(match[1]) !== expectedValue) {
      results.push(result("error", "RAG_THRESHOLD_MISMATCH", "A protected RAG threshold has changed.", file));
    }
  }

  return results;
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function stripQuotedStrings(content) {
  return content.replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/g, "");
}

function checkSensitiveLogging(files) {
  const results = [];
  const targetPrefixes = ["app/api/rag/", "app/api/webhooks/", "lib/rag/"];

  for (const { file, content } of files) {
    if (!targetPrefixes.some((prefix) => file.startsWith(prefix)) || !SOURCE_EXTENSIONS.has(path.posix.extname(file))) {
      continue;
    }

    const source = stripComments(content);
    let sensitiveArgumentFound = false;
    let rawErrorFound = false;
    const callPattern = /console\.(log|info|warn|error)\s*\(([\s\S]*?)\)/g;

    for (const match of source.matchAll(callPattern)) {
      const method = match[1];
      const args = match[2].trim();
      const codeArguments = stripQuotedStrings(args);
      const contentWithoutLengthMetrics = codeArguments.replace(/\b(?:question|answer)\s*\.\s*length\b/g, "");
      const logsRawContent = /\b(?:question|answer|body|requestBody)\b/.test(contentWithoutLengthMetrics);
      const logsSensitiveName = /\b(?:Authorization|Cookie|token|apiKey|api_key)\b/i.test(codeArguments);

      if (logsRawContent || logsSensitiveName) {
        sensitiveArgumentFound = true;
      }
      if (method === "error" && /(?:^|[,{}])\s*error\s*(?:[,}]|$)/.test(codeArguments)) {
        rawErrorFound = true;
      }
    }

    if (sensitiveArgumentFound) {
      results.push(result(
        "warning",
        "SENSITIVE_LOG_ARGUMENT_FOUND",
        "A console call may expose a sensitive raw argument.",
        file,
      ));
    }
    if (rawErrorFound) {
      results.push(result(
        "warning",
        "RAW_ERROR_OBJECT_LOGGED",
        "A console error call may output a raw error object.",
        file,
      ));
    }
  }

  return results;
}

function summarizeResults(results, checksRun = 8) {
  const summary = { checks: checksRun, errors: 0, warnings: 0, info: 0 };
  for (const item of results) {
    if (item.level === "error") summary.errors += 1;
    if (item.level === "warning") summary.warnings += 1;
    if (item.level === "info") summary.info += 1;
  }
  return summary;
}

function determineExitCode(results) {
  return results.some(({ level }) => level === "error") ? 1 : 0;
}

async function collectRepositoryFiles(rootDir) {
  const files = [];

  async function visit(relativeDirectory) {
    const absoluteDirectory = path.join(rootDir, relativeDirectory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = toRepositoryPath(path.join(relativeDirectory, entry.name));
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
          await visit(relativePath);
        }
        continue;
      }

      if (!entry.isFile() || isEnvironmentFile(relativePath) || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      const buffer = await readFile(path.join(rootDir, relativePath));
      if (buffer.includes(0)) {
        continue;
      }
      files.push({ file: relativePath, content: buffer.toString("utf8") });
    }
  }

  await visit("");
  return files;
}

function defaultGitRunner(rootDir) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return output.split("\0").filter(Boolean);
}

async function checkRepository({ rootDir = process.cwd(), gitRunner = defaultGitRunner } = {}) {
  const files = await collectRepositoryFiles(rootDir);
  const fileSet = new Set(files.map(({ file }) => file));
  const packageFile = files.find(({ file }) => file === "package.json");
  if (!packageFile) {
    throw new Error("PACKAGE_JSON_READ_FAILED");
  }

  let packageJson;
  try {
    packageJson = JSON.parse(packageFile.content);
  } catch {
    throw new Error("PACKAGE_JSON_PARSE_FAILED");
  }

  const migrationDirectory = path.join(rootDir, "supabase", "migrations");
  let migrationNames = [];
  try {
    migrationNames = (await readdir(migrationDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    migrationNames = [];
  }

  const results = [
    ...checkConflictMarkers(files),
    ...analyzeMigrationNames(migrationNames),
    ...checkPackageScripts(packageJson),
    ...checkRequiredFiles(fileSet),
    ...checkServiceRoleExposure(files),
    ...checkRagThresholds(files.find(({ file }) => file === "app/api/rag/query/route.ts")?.content ?? ""),
    ...checkSensitiveLogging(files),
  ];

  try {
    results.push(...checkTrackedEnvironmentFiles(await gitRunner(rootDir)));
  } catch {
    results.push(result(
      "warning",
      "GIT_TRACKED_FILES_UNAVAILABLE",
      "Tracked environment files could not be checked because Git was unavailable.",
    ));
  }

  return {
    results,
    summary: summarizeResults(results),
    exitCode: determineExitCode(results),
  };
}

export {
  analyzeMigrationNames,
  checkConflictMarkers,
  checkPackageScripts,
  checkRagThresholds,
  checkRepository,
  checkRequiredFiles,
  checkSensitiveLogging,
  checkServiceRoleExposure,
  checkTrackedEnvironmentFiles,
  determineExitCode,
  summarizeResults,
};