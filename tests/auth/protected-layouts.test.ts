import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { isSupabaseSessionInvalidationError } from "../../lib/auth/session-expiration.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("server-side role-protected layouts", () => {
  const cases: Array<{ file: string; role: "hq" | "owner" | "staff"; expectsWrapper?: string }> = [
    { file: "app/hq/layout.tsx", role: "hq" },
    { file: "app/boss/layout.tsx", role: "owner" },
    { file: "app/staff/layout.tsx", role: "staff", expectsWrapper: "StaffShell" },
  ];

  for (const { file, role, expectsWrapper } of cases) {
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

      test(expectsWrapper ? `wraps children in ${expectsWrapper}` : "renders children unchanged (no UI restructuring)", () => {
        if (expectsWrapper) {
          assert.match(source, new RegExp(`return\\s*<${expectsWrapper}>\\{children\\}</${expectsWrapper}>`));
        } else {
          assert.match(source, /return\s*<>\{children\}<\/>/);
        }
      });

      test('opts out of static prerendering via export const dynamic = "force-dynamic"', () => {
        assert.match(source, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']\s*;/);
      });
    });
  }
});

describe("Supabase single-session expiration handling", () => {
  const middleware = readSource("lib/supabase/middleware.ts");
  const monitor = readSource("components/auth/SessionExpiryMonitor.tsx");
  const loginPage = readSource("app/page.tsx");
  const rootLayout = readSource("app/layout.tsx");

  test("recognizes revoked/expired Supabase session refresh codes only", () => {
    for (const code of ["refresh_token_not_found", "session_expired", "session_not_found"]) {
      assert.equal(isSupabaseSessionInvalidationError({ code }), true);
    }
    for (const code of ["refresh_token_already_used", "invalid_credentials", "over_request_rate_limit"]) {
      assert.equal(isSupabaseSessionInvalidationError({ code }), false);
    }
    assert.equal(isSupabaseSessionInvalidationError(null), false);
  });

  test("Proxy clears only the local invalid session, returns API 401, and redirects page requests to the login notice", () => {
    assert.match(middleware, /isSupabaseSessionInvalidationError\(error\)/);
    assert.match(middleware, /supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
    assert.match(middleware, /code: "SESSION_EXPIRED"/);
    assert.match(middleware, /SESSION_EXPIRED_QUERY_PARAM/);
    assert.match(middleware, /request\.nextUrl\.pathname !== "\/api\/auth\/login"/);
  });

  test("browser session monitor handles SIGNED_OUT but avoids redirecting after an explicit route transition", () => {
    assert.match(monitor, /onAuthStateChange/);
    assert.match(monitor, /event !== "SIGNED_OUT" \|\| !hadSession/);
    assert.match(monitor, /window\.location\.pathname !== originalPath/);
    assert.match(monitor, /SESSION_EXPIRED_QUERY_PARAM/);
    assert.match(rootLayout, /<SessionExpiryMonitor \/>/);
  });

  test("login page displays the session-replaced message for the expiry query", () => {
    assert.match(loginPage, /searchParams\.get\("session"\) === "expired"/);
    assert.equal((loginPage.match(/다른 기기에서 로그인하여 세션이 만료되었습니다/g) ?? []).length, 2);
  });
});
