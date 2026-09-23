import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function exists(relativePath) {
  return existsSync(path.join(repoRoot, relativePath));
}

describe("main route entry files exist", () => {
  const requiredEntryFiles = [
    { route: "/", file: "app/page.tsx" },
    // /signup itself has no page.tsx; /signup/start is the documented entry point.
    { route: "/signup", file: "app/(auth)/signup/start/page.tsx" },
    { route: "/hq", file: "app/hq/page.tsx" },
    { route: "/boss", file: "app/boss/page.tsx" },
    { route: "/staff", file: "app/staff/page.tsx" },
  ];

  for (const { route, file } of requiredEntryFiles) {
    test(`${route} has an entry file at ${file}`, () => {
      assert.equal(exists(file), true, `expected ${file} to exist for route ${route}`);
    });
  }

  const requiredRoleLayouts = [
    "app/hq/layout.tsx",
    "app/boss/layout.tsx",
    "app/staff/layout.tsx",
  ];

  for (const file of requiredRoleLayouts) {
    test(`${file} exists as the server-side role guard layout for its route tree`, () => {
      assert.equal(exists(file), true);
    });
  }
});
