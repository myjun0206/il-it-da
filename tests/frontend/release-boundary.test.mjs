import assert from "node:assert/strict";
import { test } from "node:test";
import { Script } from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";

test("application roots and published test scripts do not require private execution harnesses", () => {
  const roots = ["app/api/rag/query/route.ts", "app/api/staff/chat/route.ts", "app/api/store-manuals/[id]/route.ts",
    "lib/rag/openai-embeddings.ts", "lib/rag/search-manual-chunks.ts", "tests/rag/resolve-rag-answer.test.ts", "tests/frontend/staff-evidence-relevance.test.mjs"];
  const privateImport = /e2e-execution-budget|retest-budget|guarded-staff-chat/;
  for (const file of roots) assert.equal(privateImport.test(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")), false, file);
  const scripts = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).scripts;
  assert.equal(scripts["posttest:rag"], "npm run test:release-boundary");
  for (const value of Object.values(scripts)) assert.equal(/retest-budget|guarded-staff-chat|reproduce-dairy-once/.test(value), false);
});

test("production tracing excludes private records without changing the existing build directory policy", () => {
  const source = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded = { exports: {} };
  const environment = {};
  new Script(code).runInNewContext({ module: loaded, exports: loaded.exports, process: { env: environment } });
  const config = loaded.exports.default("phase-production-build");
  assert.deepEqual(JSON.parse(JSON.stringify(config.outputFileTracingExcludes)), { "/*": ["./local-data/**/*", "./.next/dev/**/*"] });
  assert.equal(config.distDir, ".next");
  environment.POC_ISOLATED_BUILD = "1";
  assert.equal(loaded.exports.default("phase-production-build").distDir, ".next/poc-production");
  assert.equal(loaded.exports.default("phase-development-server").distDir, ".next");
});