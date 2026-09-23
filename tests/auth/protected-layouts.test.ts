import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("server-side role-protected layouts", () => {
  const cases: Array<{ file: string; role: "hq" | "owner" | "staff" }> = [
    { file: "app/hq/layout.tsx", role: "hq" },
    { file: "app/boss/layout.tsx", role: "owner" },
    { file: "app/staff/layout.tsx", role: "staff" },
  ];

  for (const { file, role } of cases) {
    describe(file, () => {
      const source = readSource(file);

      test('is a server component (no "use client")', () => {
        assert.equal(source.includes('"use client"'), false);
        assert.equal(source.includes("'use client'"), false);
      });

      test(`calls requireServerRole("${role}")`, () => {
        assert.match(source, new RegExp(`requireServerRole\\(\\s*["']${role}["']\\s*\\)`));
      });

      test("redirects to \"/\" on any non-AUTHORIZED result via next/navigation redirect()", () => {
        assert.match(source, /import\s*\{\s*redirect\s*\}\s*from\s*["']next\/navigation["']/);
        assert.match(source, /status\s*!==\s*["']AUTHORIZED["']/);
        assert.match(source, /redirect\(\s*["']\/["']\s*\)/);
      });

      test("renders children unchanged (no UI restructuring)", () => {
        assert.match(source, /return\s*<>\{children\}<\/>/);
      });

      test('opts out of static prerendering via export const dynamic = "force-dynamic"', () => {
        assert.match(source, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']\s*;/);
      });
    });
  }
});
