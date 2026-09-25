import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";

import {
  analyzeMigrationNames,
  checkPackageScripts,
  checkRepository,
  checkTrackedEnvironmentFiles,
  determineExitCode,
  summarizeResults,
} from "../../scripts/integration-check/check-repository.mjs";

const tempDirectories = [];
const REQUIRED_SCRIPTS = {
  lint: "eslint",
  build: "next build",
  "test:rag": "node --test",
  "test:rag-eval": "node --test",
  "check:integration": "node scripts/check-integration.mjs",
  "test:integration": "node --test",
};

function writeFixtureFile(rootDir, relativePath, content = "") {
  const absolutePath = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function createFixture() {
  const rootDir = mkdtempSync(path.join(tmpdir(), "integration-check-"));
  tempDirectories.push(rootDir);
  writeFixtureFile(rootDir, "package.json", JSON.stringify({ scripts: REQUIRED_SCRIPTS }));
  writeFixtureFile(
    rootDir,
    "app/api/rag/query/route.ts",
    "const ANSWERED_THRESHOLD = 0.60;\nconst CAUTIOUS_THRESHOLD = 0.40;\n",
  );
  writeFixtureFile(rootDir, "app/api/rag/upload/route.ts");
  writeFixtureFile(rootDir, "app/api/webhooks/index-manual/route.ts");
  writeFixtureFile(rootDir, "lib/supabase/admin.ts", "export function createAdminClient() {}\n");
  writeFixtureFile(rootDir, "lib/rag/index-approved-manual.ts");
  writeFixtureFile(
    rootDir,
    "lib/rag/search-manual-chunks.ts",
    'supabase.rpc("match_manual_chunks_hybrid_scoped", {\n'
    + "  query_embedding: embedding,\n"
    + "  query_text: normalizedQuestion,\n"
    + "  query_keywords: queryKeywords,\n"
    + "  target_store_id: storeId,\n"
    + "  target_franchise_id: franchiseId,\n"
    + "  match_count: validatedMatchCount,\n"
    + "});\n",
  );
  writeFixtureFile(rootDir, "lib/rag/save-question-log.ts");
  for (let prefix = 1; prefix <= 6; prefix += 1) {
    const fileName = prefix === 1
      ? "001_initial_rag_schema.sql"
      : prefix === 6
        ? "006_auth_store_memberships.sql"
        : `${String(prefix).padStart(3, "0")}_migration.sql`;
    writeFixtureFile(rootDir, `supabase/migrations/${fileName}`);
  }
  writeFixtureFile(
    rootDir,
    "supabase/migrations/018_scoped_hybrid_manual_search.sql",
    "create or replace function public.match_manual_chunks_hybrid_scoped(\n"
    + "  query_embedding extensions.vector(1536),\n"
    + "  query_text text,\n"
    + "  query_keywords text[],\n"
    + "  target_store_id uuid,\n"
    + "  target_franchise_id uuid,\n"
    + "  match_count integer default 5\n"
    + ")\n"
    + "returns table (chunk_id uuid)\n"
    + "language sql\n"
    + "as $$ select 1 $$;\n",
  );
  return rootDir;
}

async function runFixture(rootDir, trackedFiles = []) {
  return checkRepository({ rootDir, gitRunner: async () => trackedFiles });
}

function hasCode(report, code) {
  return report.results.some((item) => item.code === code);
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    rmSync(tempDirectories.pop(), { recursive: true, force: true });
  }
});

describe("repository integration checks", () => {
  test("a normal fixture exits 0", async () => {
    const report = await runFixture(createFixture());
    assert.equal(report.exitCode, 0);
    assert.equal(report.summary.errors, 0);
  });

  test("detects a complete merge conflict marker block", async () => {
    const rootDir = createFixture();
    const marker = (character) => character.repeat(7);
    writeFixtureFile(rootDir, "lib/conflict.ts", `${marker("<")} HEAD\nleft\n${marker("=")}\nright\n${marker(">")} branch\n`);
    assert.equal(hasCode(await runFixture(rootDir), "MERGE_CONFLICT_MARKER_FOUND"), true);
  });

  test("does not flag a document divider", async () => {
    const rootDir = createFixture();
    writeFixtureFile(rootDir, "docs/divider.md", `${"=".repeat(7)}\n`);
    assert.equal(hasCode(await runFixture(rootDir), "MERGE_CONFLICT_MARKER_FOUND"), false);
  });

  test("detects duplicate migration prefixes", () => {
    const results = analyzeMigrationNames([
      "001_first.sql", "001_second.sql", "002_two.sql", "003_three.sql",
      "004_four.sql", "005_five.sql", "006_six.sql",
    ]);
    assert.equal(results.some((item) => item.code === "MIGRATION_PREFIX_DUPLICATED"), true);
  });

  test("does not require migrations 007 and 008", () => {
    const results = analyzeMigrationNames([
      "001_one.sql", "002_two.sql", "003_three.sql", "004_four.sql", "005_five.sql", "006_six.sql",
    ]);
    assert.equal(results.some((item) => item.level === "error"), false);
  });

  test("detects a missing required migration", async () => {
    const rootDir = createFixture();
    unlinkSync(path.join(rootDir, "supabase/migrations/003_migration.sql"));
    assert.equal(hasCode(await runFixture(rootDir), "REQUIRED_MIGRATION_MISSING"), true);
  });

  test("warns for a SQL migration without a numeric prefix", () => {
    const results = analyzeMigrationNames(["manual_change.sql"]);
    assert.equal(results.some((item) => item.code === "MIGRATION_PREFIX_MISSING" && item.level === "warning"), true);
  });

  test("warns when filename ordering differs from numeric prefix ordering", () => {
    const results = analyzeMigrationNames(["1_first.sql", "02_second.sql"]);
    assert.equal(results.some((item) => item.code === "MIGRATION_PREFIX_ORDER_MISMATCH"), true);
  });

  test("detects a missing required package script", () => {
    const scripts = { ...REQUIRED_SCRIPTS };
    delete scripts.lint;
    assert.equal(checkPackageScripts({ scripts })[0].code, "REQUIRED_PACKAGE_SCRIPT_MISSING");
  });

  test("detects a missing required file", async () => {
    const rootDir = createFixture();
    unlinkSync(path.join(rootDir, "lib/rag/search-manual-chunks.ts"));
    assert.equal(hasCode(await runFixture(rootDir), "REQUIRED_FILE_MISSING"), true);
  });

  test("detects a public service role environment variable name", async () => {
    const rootDir = createFixture();
    writeFixtureFile(rootDir, "lib/public-key.ts", `const name = "${"NEXT_PUBLIC_" + "SUPABASE_SERVICE_ROLE"}";`);
    assert.equal(hasCode(await runFixture(rootDir), "PUBLIC_SERVICE_ROLE_ENV_FOUND"), true);
  });

  test("detects an admin import in a client component", async () => {
    const rootDir = createFixture();
    writeFixtureFile(rootDir, "app/client.tsx", `"use client";\nimport { createAdminClient } from "@/lib/supabase/${"admin"}";\n`);
    assert.equal(hasCode(await runFixture(rootDir), "CLIENT_ADMIN_IMPORT_FOUND"), true);
  });

  test("allows an admin import in a server file", async () => {
    const rootDir = createFixture();
    writeFixtureFile(rootDir, "lib/server-operation.ts", `import { createAdminClient } from "@/lib/supabase/${"admin"}";\n`);
    assert.equal(hasCode(await runFixture(rootDir), "CLIENT_ADMIN_IMPORT_FOUND"), false);
  });

  test("detects a tracked .env.local without reading it", () => {
    const results = checkTrackedEnvironmentFiles([".env.local"]);
    assert.equal(results[0].code, "TRACKED_ENV_FILE_FOUND");
  });

  test("allows tracked environment example files", () => {
    const results = checkTrackedEnvironmentFiles([".env.example", ".env.local.example", ".env.test.example"]);
    assert.deepEqual(results, []);
  });

  test("accepts RAG thresholds written as 0.60 and 0.40", async () => {
    const report = await runFixture(createFixture());
    assert.equal(hasCode(report, "RAG_THRESHOLD_MISMATCH"), false);
    assert.equal(hasCode(report, "RAG_THRESHOLD_NOT_FOUND"), false);
  });

  test("detects a changed RAG threshold", async () => {
    const rootDir = createFixture();
    writeFixtureFile(rootDir, "app/api/rag/query/route.ts", "const ANSWERED_THRESHOLD = 0.61;\nconst CAUTIOUS_THRESHOLD = 0.40;\n");
    assert.equal(hasCode(await runFixture(rootDir), "RAG_THRESHOLD_MISMATCH"), true);
  });

  test("accepts a scoped RPC migration whose signature matches the TypeScript call site", async () => {
    const report = await runFixture(createFixture());
    assert.equal(hasCode(report, "SCOPED_RPC_MIGRATION_MISSING"), false);
    assert.equal(hasCode(report, "SCOPED_RPC_FUNCTION_NOT_DEFINED"), false);
    assert.equal(hasCode(report, "SCOPED_RPC_PARAM_MISSING_IN_MIGRATION"), false);
    assert.equal(hasCode(report, "SCOPED_RPC_NOT_CALLED"), false);
    assert.equal(hasCode(report, "SCOPED_RPC_PARAM_MISSING_IN_CALL_SITE"), false);
  });

  test("detects a missing scoped RPC migration file", async () => {
    const rootDir = createFixture();
    unlinkSync(path.join(rootDir, "supabase/migrations/018_scoped_hybrid_manual_search.sql"));
    assert.equal(hasCode(await runFixture(rootDir), "SCOPED_RPC_MIGRATION_MISSING"), true);
  });

  test("detects when the migration drops a parameter the call site still sends", async () => {
    const rootDir = createFixture();
    writeFixtureFile(
      rootDir,
      "supabase/migrations/018_scoped_hybrid_manual_search.sql",
      "create or replace function public.match_manual_chunks_hybrid_scoped(\n"
      + "  query_embedding extensions.vector(1536),\n"
      + "  query_text text,\n"
      + "  query_keywords text[],\n"
      + "  target_store_id uuid,\n"
      + "  match_count integer default 5\n"
      + ")\n"
      + "returns table (chunk_id uuid)\n"
      + "language sql\n"
      + "as $$ select 1 $$;\n",
    );
    assert.equal(hasCode(await runFixture(rootDir), "SCOPED_RPC_PARAM_MISSING_IN_MIGRATION"), true);
  });

  test("detects when the call site stops calling the scoped RPC", async () => {
    const rootDir = createFixture();
    writeFixtureFile(rootDir, "lib/rag/search-manual-chunks.ts", 'supabase.rpc("match_manual_chunks_hybrid_by_store", {});\n');
    assert.equal(hasCode(await runFixture(rootDir), "SCOPED_RPC_NOT_CALLED"), true);
  });

  test("detects when the call site drops a parameter the migration requires", async () => {
    const rootDir = createFixture();
    writeFixtureFile(
      rootDir,
      "lib/rag/search-manual-chunks.ts",
      'supabase.rpc("match_manual_chunks_hybrid_scoped", {\n'
      + "  query_embedding: embedding,\n"
      + "  query_text: normalizedQuestion,\n"
      + "  query_keywords: queryKeywords,\n"
      + "  target_store_id: storeId,\n"
      + "});\n",
    );
    assert.equal(hasCode(await runFixture(rootDir), "SCOPED_RPC_PARAM_MISSING_IN_CALL_SITE"), true);
  });

  test("allows a questionLength metrics log", async () => {
    const rootDir = createFixture();
    writeFixtureFile(rootDir, "lib/rag/metrics.ts", "console.info('metric', { questionLength: question.length });\n");
    assert.equal(hasCode(await runFixture(rootDir), "SENSITIVE_LOG_ARGUMENT_FOUND"), false);
  });

  test("warns when a raw question variable is logged", async () => {
    const rootDir = createFixture();
    writeFixtureFile(rootDir, "lib/rag/unsafe.ts", "console.info('query', question);\n");
    assert.equal(hasCode(await runFixture(rootDir), "SENSITIVE_LOG_ARGUMENT_FOUND"), true);
  });

  test("warns when a raw question is logged through object shorthand", async () => {
    const rootDir = createFixture();
    writeFixtureFile(rootDir, "lib/rag/unsafe-object.ts", "console.info('query', { question });\n");
    assert.equal(hasCode(await runFixture(rootDir), "SENSITIVE_LOG_ARGUMENT_FOUND"), true);
  });

  test("warns when a raw error object is logged", async () => {
    const rootDir = createFixture();
    writeFixtureFile(rootDir, "app/api/rag/unsafe.ts", "console.error('failure', error);\n");
    assert.equal(hasCode(await runFixture(rootDir), "RAW_ERROR_OBJECT_LOGGED"), true);
  });

  test("allows an error passed through a safe details helper", async () => {
    const rootDir = createFixture();
    writeFixtureFile(
      rootDir,
      "app/api/rag/safe-error.ts",
      "console.error('failure', getSafeErrorDetails(error));\n",
    );
    const report = await runFixture(rootDir);
    assert.equal(hasCode(report, "RAW_ERROR_OBJECT_LOGGED"), false);
    assert.equal(hasCode(report, "SENSITIVE_LOG_ARGUMENT_FOUND"), false);
  });

  test("summarizes result levels accurately", () => {
    const input = [
      { level: "error", code: "E", message: "error" },
      { level: "warning", code: "W", message: "warning" },
      { level: "info", code: "I", message: "info" },
      { level: "warning", code: "W2", message: "warning" },
    ];
    assert.deepEqual(summarizeResults(input, 8), { checks: 8, errors: 1, warnings: 2, info: 1 });
  });

  test("returns exit 1 when an error exists", () => {
    assert.equal(determineExitCode([{ level: "error", code: "E", message: "error" }]), 1);
  });

  test("returns exit 0 when only warnings exist", () => {
    assert.equal(determineExitCode([{ level: "warning", code: "W", message: "warning" }]), 0);
  });

  test("does not mutate migration name input", () => {
    const names = ["002_two.sql", "001_one.sql"];
    const snapshot = structuredClone(names);
    analyzeMigrationNames(names);
    assert.deepEqual(names, snapshot);
  });

  test("uses injected Git data without network, database, or environment access", async () => {
    const rootDir = createFixture();
    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = async () => {
      networkCalls += 1;
      throw new Error("Network access is forbidden.");
    };
    try {
      const report = await checkRepository({ rootDir, gitRunner: async () => [] });
      assert.equal(report.exitCode, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(networkCalls, 0);
  });
});