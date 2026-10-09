import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { useClientReady } from "../../lib/hq/use-client-ready.ts";
import { isSupabaseSessionInvalidationError } from "../../lib/auth/session-expiration.ts";
import { componentElements, createHookHarness, loadComponentModule } from "../support/component-harness.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("server-side role-protected layouts", () => {
  const cases: Array<{ file: string; role: "hq" | "owner" | "staff"; expectsWrapper?: string; expectsSibling?: string }> = [
    { file: "app/hq/layout.tsx", role: "hq", expectsWrapper: "HQShell" },
    { file: "app/boss/layout.tsx", role: "owner", expectsSibling: "EscalationNotificationPopup" },
    { file: "app/staff/layout.tsx", role: "staff", expectsWrapper: "StaffShell" },
  ];

  for (const { file, role, expectsWrapper, expectsSibling } of cases) {
    describe(file, () => {
      const source = readSource(file);

      test('is a server component (no "use client")', () => {
        assert.equal(source.includes('"use client"'), false);
        assert.equal(source.includes("'use client'"), false);
      });

      test(`calls requireServerRole("${role}")`, () => {
        assert.match(source, new RegExp(`requireServerRole\\(\\s*["']${role}["']\\s*\\)`));
      });

      test("redirects unauthenticated requests to login and forbidden roles to home", () => {
        assert.match(source, /import\s*\{\s*redirect\s*\}\s*from\s*["']next\/navigation["']/);
        if (role === "hq") {
          assert.match(source, /status === "UNAUTHENTICATED"/);
          assert.match(source, /redirect\("\/\?session=expired"\)/);
          assert.match(source, /status === "FORBIDDEN"[\s\S]*?redirect\("\/"\)/);
          return;
        }
        assert.match(source, /status\s*!==\s*["']AUTHORIZED["']/);
        assert.match(source, /redirect\(\s*["']\/["']\s*\)/);
      });

      test(
        expectsWrapper
          ? `wraps children in ${expectsWrapper}`
          : expectsSibling
            ? `renders children with only the ${expectsSibling} sibling`
            : "renders children unchanged (no UI restructuring)",
        () => {
          if (expectsWrapper) {
            const shellPath = role === "hq" ? "@/components/hq/HQShell" : "@/components/staff/StaffShell";
            assert.match(source, new RegExp(`import\\s+${expectsWrapper}\\s+from\\s+["']${shellPath}["']`));
            assert.match(source, new RegExp(`return\\s*(?:\\(\\s*)?<${expectsWrapper}>\\s*\\{children\\}\\s*</${expectsWrapper}>\\s*(?:\\))?\\s*;`));
            assert.equal((source.match(new RegExp(`<${expectsWrapper}>`, "g")) ?? []).length, 1);
            return;
          }
          if (expectsSibling) {
            // children은 그대로 두고 알림 팝업만 형제로 덧붙인다(레이아웃 구조는 바꾸지 않는다).
            assert.match(
              source,
              new RegExp(`return\\s*\\(\\s*<>\\s*\\{children\\}\\s*<${expectsSibling} />\\s*</>\\s*\\);`),
            );
            return;
          }
          assert.match(source, /return\s*<>\{children\}<\/>/);
        },
      );

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
    assert.equal((loginPage.match(/로그인 세션이 만료되었습니다\. 다시 로그인해 주세요\./g) ?? []).length, 2);
  });
});

describe("HQ hydration readiness", () => {
  test("server rendering remains empty until the client hydration snapshot", () => {
    function ReadinessProbe() {
      return useClientReady() ? createElement("span", null, "ready") : null;
    }
    assert.equal(renderToString(createElement(ReadinessProbe)), "");
  });

  test("the four HQ pages retain their existing hydration gate without synchronous readiness effects", () => {
    for (const file of ["app/hq/approvals/page.tsx", "app/hq/communication/page.tsx", "app/hq/manuals/common/page.tsx", "app/hq/manuals/stores/page.tsx"]) {
      const source = readSource(file);
      assert.match(source, /const isReady = useClientReady\(\);/);
      assert.match(source, /if \(!isReady\)\s*\{\s*return null;/);
      assert.equal(source.includes("setIsReady"), false);
    }
  });
});

describe("HQ layout and URL-based store selection", () => {
  test("preserves the authenticated shell, exact active menu and child without legacy store writes", async () => {
    const effects: Array<() => void> = [];
    const requests: string[] = [];
    const harness = createHookHarness([]);
    const headerStub = () => null;
    const sidebarStub = () => null;
    const shell = loadComponentModule<{ default: (props: { children: ReactNode }) => ReactNode }>("components/hq/HQShell.tsx", {
      react: { ...harness.react, useEffect: (effect: () => void) => { effects.push(effect); } },
      "next/navigation": { useRouter: () => ({ push: () => assert.fail("Unexpected redirect") }), usePathname: () => "/hq/manuals/stores" },
      "@/components/hq/HQHeader": { default: headerStub, __esModule: true },
      "@/components/hq/HQSidebar": { default: sidebarStub, __esModule: true },
      "@/lib/supabase/client": { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { user_metadata: { name: "HQ Tester" } } } } }) } }) },
    }, {
      console: { ...console, error: () => {} },
      fetch: async (url: string) => {
        requests.push(url);
        assert.fail("Shared shell must not perform a store write or hidden store fetch");
      },
    });
    const child = createElement("span", { "data-testid": "hq-child" }, "retained");
    const render = () => harness.render(() => shell.default({ children: child }));
    assert.equal(render(), null);
    assert.equal(effects.length, 1);
    effects[0]();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const header = () => {
      const element = componentElements(render()).find((candidate) => candidate.type === headerStub);
      assert.ok(element);
      return element;
    };
    assert.equal(header().props.userName, "HQ Tester");
    assert.equal(header().props.franchiseName, "HQ");
    const sidebar = componentElements(render()).find((element) => element.type === sidebarStub);
    assert.ok(sidebar);
    assert.equal(sidebar.props.activeMenu, "manual-store");
    assert.deepEqual(requests, []);
    assert.ok(componentElements(render()).some((element) => element.props["data-testid"] === "hq-child"));
  });

  test("actual store-manual page selects only returned stores, preserves scoped fetches and URL navigation", async () => {
    let query = new URLSearchParams();
    const effects: Array<() => void> = [];
    const requests: string[] = [];
    const navigations: string[] = [];
    const harness = createHookHarness([]);
    const page = loadComponentModule<{ default: () => ReactNode }>("app/hq/manuals/stores/page.tsx", {
      react: { ...harness.react, useEffect: (effect: () => void) => { effects.push(effect); } },
      "next/navigation": { useSearchParams: () => query, useRouter: () => ({ push: (href: string) => { navigations.push(href); query = new URL(href, "http://localhost").searchParams; } }) },
    }, {
      fetch: async (url: string) => {
        requests.push(url);
        if (url === "/api/hq/stores") return Response.json({ stores: [{ id: "store-a", name: "Store A", manualCount: 1 }, { id: "store-b", name: "Store B", manualCount: 1 }] });
        const params = new URL(url, "http://localhost").searchParams;
        assert.equal(params.get("scope"), "store");
        const storeId = params.get("storeId");
        assert.ok(storeId === "store-a" || storeId === "store-b");
        return Response.json({ manuals: [
          { id: `manual-${storeId}`, store_id: storeId, title: `Manual ${storeId}`, content: "Fixture", category: "Operations" },
          { id: "foreign-manual", store_id: "foreign-store", title: "Foreign manual", content: "Not visible" },
        ] });
      },
    });
    const render = () => { effects.length = 0; return harness.render(page.default); };
    render();
    effects[0]();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const initial = render();
    assert.deepEqual(requests, ["/api/hq/stores", "/api/manuals?storeId=store-a&scope=store", "/api/manuals?storeId=store-b&scope=store"]);
    const search = componentElements(initial).find((element) => element.type === "input" && element.props.type === "search");
    assert.ok(search);
    (search.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Store B" } });
    const choose = componentElements(render()).find((element) => element.type === "button" && renderToString(element).includes("Store B"));
    assert.ok(choose);
    (choose.props.onClick as () => void)();
    assert.deepEqual(navigations, ["/hq/manuals/stores?storeId=store-b"]);
    const selected = render();
    assert.ok(renderToString(selected).includes("Manual store-b"));
    assert.equal(renderToString(selected).includes("Manual store-a"), false);
    assert.equal(renderToString(selected).includes("Foreign manual"), false);
    query = new URLSearchParams("storeId=store-b&manualId=manual-store-b");
    assert.ok(renderToString(render()).includes("Fixture"));
    query = new URLSearchParams("storeId=store-a&manualId=manual-store-b");
    assert.equal(renderToString(render()).includes("Manual store-b"), false);
    assert.ok(renderToString(render()).includes("Manual store-a"));
    query = new URLSearchParams("storeId=foreign-store");
    assert.equal(renderToString(render()).includes("Foreign manual"), false);
    assert.equal(requests.some((url) => url.includes("set-default-store")), false);
  });

  test("grouped store manuals keep URL detail, category search and scoped refresh", async () => {
    let query = new URLSearchParams("storeId=store-a");
    const effects: Array<() => void> = [];
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    const harness = createHookHarness([]);
    const manuals = [
      { id: "parent", store_id: "store-a", title: "Opening", category: "Operations", content: "Parent", parent_manual_id: null },
      { id: "child", store_id: "store-a", title: "Check milk", category: "Operations", content: "Refrigerator", parent_manual_id: "parent" },
      { id: "training", store_id: "store-a", title: "Training", category: "Training", content: "Staff", parent_manual_id: null },
      { id: "foreign", store_id: "store-b", title: "Foreign", category: "Other", content: "Secret" },
    ];
    const page = loadComponentModule<{ default: () => ReactNode }>("app/hq/manuals/stores/page.tsx", {
      react: { ...harness.react, useEffect: (effect: () => void) => { effects.push(effect); } },
      "next/navigation": { useSearchParams: () => query, useRouter: () => ({ push: (href: string) => { query = new URL(href, "http://localhost").searchParams; } }) },
    }, {
      fetch: async (url: string, options?: RequestInit) => {
        requests.push({ url, options });
        return url === "/api/hq/stores" ? Response.json({ stores: [{ id: "store-a", name: "Store A", manualCount: 3 }] }) : Response.json({ manuals });
      },
    });
    const render = () => { effects.length = 0; return harness.render(page.default); };
    render(); effects[0]();
    await new Promise<void>((resolve) => setImmediate(resolve));
    let tree = render();
    effects[1]();
    await new Promise<void>((resolve) => setImmediate(resolve));
    tree = render();
    assert.equal(requests.at(-1)?.options?.cache, "no-store");
    assert.ok(requests.at(-1)?.options?.signal);
    assert.equal(renderToString(tree).includes("Foreign"), false);
    const category = componentElements(tree).find((element) => element.type === "button" && renderToString(element).includes("Operations"));
    assert.ok(category); (category.props.onClick as () => void)();
    assert.equal(renderToString(render()).includes(">Training</span>"), false);
    const search = componentElements(render()).find((element) => element.props["aria-label"] === "지점 매뉴얼 검색");
    assert.ok(search); (search.props.onChange as (event: unknown) => void)({ target: { value: "Refrigerator" } });
    tree = render();
    const group = componentElements(tree).find((element) => element.type === "button" && renderToString(element).includes("Opening"));
    assert.ok(group); (group.props.onClick as () => void)();
    assert.equal(query.get("manualId"), "parent");
    const detail = renderToString(render());
    assert.ok(detail.includes("Check milk"));
    assert.ok(detail.includes("Refrigerator"));
    assert.equal(detail.includes("Secret"), false);
    query = new URLSearchParams("storeId=store-a&manualId=child");
    assert.ok(renderToString(render()).includes("Refrigerator"));
  });

  test("store-list failure stays an alert with a working retry rather than an empty list", async () => {
    const effects: Array<() => void> = [];
    const harness = createHookHarness([]);
    let calls = 0;
    const page = loadComponentModule<{ default: () => ReactNode }>("app/hq/manuals/stores/page.tsx", {
      react: { ...harness.react, useEffect: (effect: () => void) => { effects.push(effect); } },
      "next/navigation": { useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: () => assert.fail("Unexpected navigation") }) },
    }, {
      console: { ...console, error: () => {} },
      fetch: async (url: string) => { assert.equal(url, "/api/hq/stores"); calls++; return calls === 1 ? Response.json({ error: "지점 fixture failure" }, { status: 500 }) : Response.json({ stores: [] }); },
    });
    const render = () => { effects.length = 0; return harness.render(page.default); };
    render(); effects[0](); await new Promise<void>((resolve) => setImmediate(resolve));
    const tree = render();
    const alert = componentElements(tree).find((element) => element.props.role === "alert");
    assert.ok(alert);
    assert.ok(renderToString(alert).includes("fixture failure"));
    const retry = componentElements(alert).find((element) => element.type === "button");
    assert.ok(retry); (retry.props.onClick as () => void)();
    render(); effects[0](); await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(calls, 2);
    assert.equal(componentElements(render()).some((element) => element.props.role === "alert"), false);
  });
});
