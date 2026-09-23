import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCAN_DIRS = ["app", "components"];
const EXCLUDED_DIRS = new Set(["node_modules", ".next", ".git"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

// These modules pull in "server-only" (directly or transitively) and must
// never be reachable from a "use client" bundle.
const FORBIDDEN_SERVER_ONLY_IMPORTS = [
  "@/lib/auth/require-server-role",
  "@/lib/auth/server-role-guard-core",
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function isClientComponent(source) {
  const firstStatement = source
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstStatement === '"use client";' || firstStatement === "'use client';"
    || firstStatement === '"use client"' || firstStatement === "'use client'";
}

function importsSpecifier(source, specifier) {
  return source.includes(`"${specifier}"`) || source.includes(`'${specifier}'`);
}

describe("client components never import the server-only role guard", () => {
  const files = SCAN_DIRS.flatMap((dir) => walk(path.join(repoRoot, dir)));
  const clientFiles = files.filter((file) => isClientComponent(readFileSync(file, "utf8")));

  test("scans at least one \"use client\" file (sanity check for the scanner)", () => {
    assert.ok(clientFiles.length > 0, "expected to find at least one \"use client\" file under app/ or components/");
  });

  for (const file of clientFiles) {
    const relativePath = path.relative(repoRoot, file).split(path.sep).join("/");
    test(`${relativePath} does not import a server-only role guard module`, () => {
      const source = readFileSync(file, "utf8");
      for (const specifier of FORBIDDEN_SERVER_ONLY_IMPORTS) {
        assert.equal(importsSpecifier(source, specifier), false, `${relativePath} must not import ${specifier}`);
      }
    });
  }
});
