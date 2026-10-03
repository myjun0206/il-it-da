import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { isInternalNotificationUrl } from "../../lib/notifications/notification-href.ts";
import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { componentElements, createHookHarness, loadComponentModule } from "../support/component-harness.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const center = readFileSync(path.join(root, "components/common/NotificationCenter.tsx"), "utf8");
const middleware = readFileSync(path.join(root, "lib/supabase/middleware.ts"), "utf8");
const cookiePolicy = readFileSync(path.join(root, "lib/supabase/session-cookies.ts"), "utf8");

function notificationScenario(targetUrl: string) {
  const notification = { id: "notification-a", title: "Notice A", message: "Notification content", targetUrl, createdAt: "2026-09-21T12:00:00.000Z", isRead: false };
  const harness = createHookHarness([[notification], 1, "all", false, "", 1, false, false, null]);
  const navigations: string[] = [];
  const requests: string[] = [];
  let requestSucceeded = true;
  const componentModule = loadComponentModule<{ default: () => ReactNode }>("app/staff/notifications/page.tsx", {
    react: harness.react,
    "next/navigation": { useRouter: () => ({ push: (href: string) => navigations.push(href) }) },
    "@/lib/notifications": { formatNotificationTime: () => "Today" },
  }, {
    fetch: async (url: string, options: { method: string; credentials: string }) => {
      assert.equal(options.credentials, "include");
      requests.push(`${options.method} ${url}`);
      return { ok: requestSucceeded };
    },
  });
  const render = () => harness.render(componentModule.default);
  const entry = () => {
    const entry = componentElements(render()).find((element) => element.type === "button" && renderToStaticMarkup(element).includes(notification.title));
    assert.ok(entry);
    return entry;
  };
  const detail = () => componentElements(render()).find((element) => (element.props.notification as { id?: string } | undefined)?.id === notification.id);
  return { navigations, requests, render, entry, detail, setRequestSucceeded: (value: boolean) => { requestSucceeded = value; } };
}

describe("알림 요청 인증 세션 처리", () => {
  test("직원 알림 클릭은 내부 링크만 이동하고 외부 링크에서는 상세 모달을 유지한다 (핸들러 실행)", async () => {
    for (const target of ["/staff/notices", "https://example.com", "//example.com", "/\\example.com", "javascript:alert(1)"]) {
      const scenario = notificationScenario(target);
      await (scenario.entry().props.onClick as () => Promise<void>)();
      assert.deepEqual(scenario.navigations, target === "/staff/notices" ? [target] : []);
      assert.ok(scenario.detail());
      assert.deepEqual(scenario.requests, ["PUT /api/notifications/notification-a/mark-read"]);
    }
  });

  test("직원 알림 관리 핸들러는 성공 후 상세 UI를 닫고 읽음·읽지 않음·삭제를 반영한다 (핸들러 실행)", async () => {
    const scenario = notificationScenario("https://example.com");
    scenario.setRequestSucceeded(false);
    await (scenario.entry().props.onClick as () => Promise<void>)();
    assert.equal(scenario.detail()?.props.isRead, false);
    scenario.setRequestSucceeded(true);
    await (scenario.detail()?.props.onMarkAsRead as () => Promise<void>)();
    assert.equal(scenario.detail(), undefined);
    await (scenario.entry().props.onClick as () => Promise<void>)();
    assert.equal(scenario.detail()?.props.isRead, true);
    await (scenario.detail()?.props.onMarkAsUnread as () => Promise<void>)();
    assert.equal(scenario.detail(), undefined);
    await (scenario.entry().props.onClick as () => Promise<void>)();
    await (scenario.detail()?.props.onDelete as () => Promise<void>)();
    assert.equal(scenario.detail(), undefined);
    assert.equal(componentElements(scenario.render()).some((element) => element.type === "button" && renderToStaticMarkup(element).includes("Notice A")), false);
    assert.ok(scenario.requests.includes("PUT /api/notifications/notification-a/mark-unread"));
    assert.ok(scenario.requests.includes("DELETE /api/notifications/notification-a/delete"));
  });

  test("알림 상세 메뉴는 읽음 상태에 맞는 액션을 실행하고 성공 후 닫힌다 (컴포넌트 실행)", async () => {
    for (const isRead of [false, true]) {
      const harness = createHookHarness([false, false]);
      const actions: string[] = [];
      const componentModule = loadComponentModule<{ NotificationDetailModal: (props: Record<string, unknown>) => ReactNode }>("components/notifications/NotificationDetailModal.tsx", { react: harness.react });
      const props = {
        notification: { id: "a", title: "Notice A", message: "Content", createdAt: "2026-09-21" },
        isRead, onClose: () => actions.push("close"),
        onMarkAsRead: async () => { actions.push("read"); },
        onMarkAsUnread: async () => { actions.push("unread"); },
        onDelete: async () => { actions.push("delete"); },
      };
      const render = () => harness.render(() => componentModule.NotificationDetailModal(props));
      const toggleMenu = () => {
        const button = componentElements(render()).find((element) => element.props["aria-label"] === "알림 관리" && element.type === "button");
        assert.ok(button);
        (button.props.onClick as () => void)();
      };
      toggleMenu();
      const markButton = componentElements(render()).find((element) => element.props.role === "menuitem" && renderToStaticMarkup(element).includes(isRead ? "읽지 않음으로 표시" : "읽음으로 표시"));
      assert.ok(markButton);
      (markButton.props.onClick as () => void)();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(actions, [isRead ? "unread" : "read"]);
      assert.equal(componentElements(render()).some((element) => element.props.role === "menu"), false);
      toggleMenu();
      const deleteButton = componentElements(render()).find((element) => element.props.role === "menuitem" && element.props.children === "삭제");
      assert.ok(deleteButton);
      (deleteButton.props.onClick as () => void)();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(actions.at(-1), "delete");
      assert.equal(componentElements(render()).some((element) => element.props.role === "menu"), false);
      toggleMenu();
      const dialog = componentElements(render()).find((element) => element.props.role === "dialog");
      assert.ok(dialog);
      let propagationStopped = false;
      (dialog.props.onClick as (event: unknown) => void)({
        stopPropagation: () => { propagationStopped = true; },
        target: { closest: () => null },
      });
      assert.equal(propagationStopped, true);
      assert.equal(componentElements(render()).some((element) => element.props.role === "menu"), false);
    }
  });

  test("알림 이동은 내부 경로만 허용하고 외부·스크립트·역슬래시 우회를 차단한다 (함수 실행)", () => {
    for (const url of ["/staff/notices", "/staff/stores?tab=requests", "/staff/notices#notice-a"]) {
      assert.equal(isInternalNotificationUrl(url), true, url);
    }
    for (const url of [undefined, "", "https://example.com", "http://example.com", "//example.com", "/\\example.com", "javascript:alert(1)"]) {
      assert.equal(isInternalNotificationUrl(url), false, String(url));
    }
  });
  test("알림 요청은 세션이 있을 때만 수행하고 쿠키 credentials를 명시한다", () => {
    assert.match(center, /auth\.getSession\(\)/);
    assert.match(center, /!session/);
    assert.match(center, /fetch\("\/api\/notifications\?limit=15",\s*\{\s*credentials:\s*"include"/);
    assert.match(center, /fetch\("\/api\/notifications\?limit=1",\s*\{\s*credentials:\s*"include"/);
    assert.match(center, /response\.status === 401/);
  });

  test("세션 쿠키가 없는 요청은 Auth getUser 호출 없이 익명 응답을 통과시킨다", () => {
    assert.match(middleware, /if \(!hasSessionCookie\) \{[\s\S]*?expireLegacySupabaseCookies\(request, response\);[\s\S]*?return response;/);
  });

  test("proxy는 Next.js가 지원하는 request.headers 전달 문법으로 헤더와 갱신 쿠키를 전달한다", () => {
    assert.match(middleware, /NextResponse\.next\(\{\s*request: \{ headers: requestHeaders \}/);
    assert.match(middleware, /const writes = applySessionCookiePolicy\(request\.cookies\.getAll\(\), cookiesToSet, policy\?\.rememberMe \?\? false\)/);
    assert.match(middleware, /writes\.forEach\(\(\{ name, value \}\) => value \? request\.cookies\.set\(name, value\) : request\.cookies\.delete\(name\)\)/);
    assert.match(middleware, /writes\.forEach\(\(\{ name, value, options \}\) => \{\s*response\.cookies\.set\(name, value, options\)/);
    assert.match(middleware, /Object\.entries\(headers\)\.forEach\(\(\[name, value\]\) => response\.headers\.set\(name, value\)\)/);
  });

  test("브라우저·서버·proxy가 같은 커스텀 세션 쿠키 이름과 루트 경로 정책을 공유한다", () => {
    assert.match(cookiePolicy, /name: "il-it-da-auth-session"/);
    assert.match(cookiePolicy, /path: "\/"/);
    for (const relativePath of ["lib/supabase/client.ts", "lib/supabase/server.ts", "lib/supabase/middleware.ts"]) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      assert.match(source, /cookieOptions: SUPABASE_SESSION_COOKIE_OPTIONS/);
    }
  });

  test("점주·본사·직원 알림 목록 요청도 브라우저 쿠키를 동봉한다", () => {
    for (const relativePath of [
      "app/boss/notifications/page.tsx",
      "app/hq/notifications/page.tsx",
      "app/staff/notifications/page.tsx",
    ]) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      assert.match(source, /fetch\([\s\S]*?\/api\/notifications\?limit=\$\{pageSize \* page\}[\s\S]*?credentials: "include"/);
    }
  });
});