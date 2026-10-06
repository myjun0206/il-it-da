import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, globSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import ts from "typescript";

// 실제 OwnerHeader/OwnerSidebar/StaffHeader/StaffSidebar를 Chromium에서 렌더링한다.
// 인증·현재 매장·알림 API·라우팅만 mock이며 DB/외부 네트워크 호출은 차단한다.
const root = process.cwd();
const require = createRequire(import.meta.url);
const LONG_STORE = "서울특별시 강남구 테헤란로 아주아주 긴 이름의 대표 매장 본점";
const STORES = [
  { storeId: "store-a", storeName: "서울 중앙점" },
  { storeId: "store-b", storeName: LONG_STORE },
];
const modules = new Map();
const mocks = {
  "next/link": "const React=require('react'); exports.default=({href,children,prefetch,...props})=>React.createElement('a',{...props,href},children);",
  "next/image": "const React=require('react'); exports.default=({priority,fill,...props})=>React.createElement('img',props);",
  "next/navigation": "exports.useRouter=()=>({push:(href)=>window.fixture.navigation.push(href)}); exports.usePathname=()=>'/';",
  "@/lib/owner/current-store": `
    exports.resolveOwnerCurrentStore = async () => {
      const fixture = window.fixture;
      if (fixture.holdStores) await new Promise((resolve) => { fixture.releaseStores = resolve; });
      if (fixture.storesError) return { status: 'error' };
      const selected = sessionStorage.getItem('fixtureSelectedStore');
      const current = fixture.stores.find((store) => store.storeId === selected) || fixture.stores[0] || null;
      return { status: 'ready', stores: fixture.stores, current, pending: fixture.pending || [] };
    };
    exports.persistSelectedStore = ({ storeId }) => { sessionStorage.setItem('fixtureSelectedStore', storeId); };`,
  "@/lib/supabase/client": "exports.createClient=()=>({auth:{getUser:async()=>({data:{user:{id:'user',email:'owner@example.com'}}}),getSession:async()=>({data:{session:{user:{id:'user'}}},error:null}),signOut:async()=>{}},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null})})})})});",
  "@/lib/notifications": "exports.formatNotificationTime=()=>'방금 전';",
  "@/components/staff/StaffShellContext": "exports.useStaffShell=()=>window.fixture.staff;",
};

function resolveAlias(dependency) {
  const base = path.join(root, dependency.slice(2));
  return [`${base}.tsx`, `${base}.ts`, `${base}.js`, path.join(base, "index.ts")].find((filename) => existsSync(filename));
}

function bundleModule(filename) {
  if (modules.has(filename)) return filename;
  modules.set(filename, "");
  let source = filename in mocks ? mocks[filename] : readFileSync(filename, "utf8");
  if (filename in mocks && source.includes("exports.default")) source = `exports.__esModule=true;${source}`;
  if (/\.tsx?$/.test(filename)) source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020 } }).outputText;
  source = source.replace(/require\(["']([^"']+)["']\)/g, (_match, dependency) => {
    let resolved;
    if (dependency in mocks) resolved = dependency;
    else if (dependency.startsWith("@/")) {
      resolved = resolveAlias(dependency);
      assert.ok(resolved, `Unresolved fixture dependency: ${dependency}`);
    } else resolved = createRequire(path.isAbsolute(filename) ? filename : import.meta.url).resolve(dependency);
    return `require(${JSON.stringify(bundleModule(resolved))})`;
  });
  modules.set(filename, source);
  return filename;
}

const ownerHeader = bundleModule(path.join(root, "components/owner/OwnerHeader.tsx"));
const ownerSidebar = bundleModule(path.join(root, "components/owner/OwnerSidebar.tsx"));
const staffHeader = bundleModule(path.join(root, "components/staff/StaffHeader.tsx"));
const staffSidebar = bundleModule(path.join(root, "components/staff/StaffSidebar.tsx"));
const react = bundleModule(require.resolve("react"));
const reactDom = bundleModule(require.resolve("react-dom/client"));
const app = `
  const React = require(${JSON.stringify(react)});
  const h = React.createElement;
  const role = window.fixture.role;
  const Sidebar = require(role === 'owner' ? ${JSON.stringify(ownerSidebar)} : ${JSON.stringify(staffSidebar)}).default;
  const Header = require(role === 'owner' ? ${JSON.stringify(ownerHeader)} : ${JSON.stringify(staffHeader)}).default;
  const element = h('div', { className: 'min-h-screen bg-[var(--color-bg-default)] flex' },
    h(Sidebar, { activeMenu: role === 'owner' ? 'home' : 'ai-chat', onLogout: () => { window.fixture.loggedOut = true; } }),
    h('div', { className: 'flex-1 min-w-0 ml-0 lg:ml-[240px] flex flex-col' },
      h(Header, { userName: window.fixture.userName, storeName: '', onLogout: () => {} }),
      h('main', { className: 'flex-1' }, h('div', { className: 'p-6 lg:p-8 max-w-7xl mx-auto' },
        h('h1', { className: 'text-2xl font-bold text-[var(--color-text-primary)] mb-2' }, role === 'owner' ? '홈' : 'AI 챗봇')))));
  require(${JSON.stringify(reactDom)}).createRoot(document.getElementById('root')).render(element);`;
const bundle = `const process={env:{NODE_ENV:'development'}};const modules={${[...modules].map(([name, source]) => `${JSON.stringify(name)}:(module,exports,require)=>{${source}\n}`).join(",")}};const cache={};function require(name){if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;modules[name](module,module.exports,require);return module.exports;}${app}`;

let browser;
let server;
let url;
const screenshots = mkdtempSync(path.join(tmpdir(), "ilitda-owner-header-ui-"));
const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }];

before(async () => {
  const cssFiles = globSync(".next/static/**/*.css");
  assert.ok(cssFiles.length > 0, "Run npm run build or check:frontend before mock browser tests");
  const css = cssFiles.map((filename) => readFileSync(filename, "utf8")).join("\n");
  server = createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript; charset=utf-8"); response.end(bundle); }
    else if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css; charset=utf-8"); response.end(css); }
    else if (request.url === "/logo/ilitda-wordmark.png") { response.setHeader("Content-Type", "image/png"); response.end(readFileSync("public/logo/ilitda-wordmark.png")); }
    else { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end('<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server ? server.close(resolve) : resolve());
  console.log(`Mock screenshots: ${screenshots}`);
});

async function openShell(role, viewport, options = {}) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await page.addInitScript(({ role, stores, options }) => {
    const staffStores = stores.map((store) => ({ id: store.storeId, name: store.storeName }));
    window.fixture = {
      role,
      navigation: [],
      stores,
      userName: options.userName || "김점주",
      staff: { userName: options.userName || "김직원", roleLabel: "직원", isStoresLoading: false, stores: staffStores, defaultStoreId: staffStores[0]?.id ?? null, saveStorePreferences: async () => true },
      ...options,
    };
    window.fetch = async (input) => {
      if (String(input).startsWith("/api/notifications")) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { unreadCount: 2, notifications: [] } }) };
      }
      throw Error(`Unexpected fetch: ${input}`);
    };
  }, { role, stores: STORES, options });
  await page.goto(url);
  await page.getByRole("heading", { level: 1 }).waitFor();
  if (options.dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  return { page, errors };
}

const noHorizontalOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("owner store switcher sits right of notifications and left of profile, matching staff header geometry", async () => {
  for (const viewport of VIEWPORTS) {
    const geometry = {};
    for (const role of ["staff", "owner"]) {
      const { page, errors } = await openShell(role, viewport);
      try {
        const header = page.locator("header").first();
        const bell = header.getByRole("button").first();
        const profile = header.locator('button[aria-controls="profile-menu"]');
        const store = role === "owner"
          ? header.getByRole("button", { name: /현재 운영 매장/ })
          : header.locator('button[aria-controls="store-selector-menu"]');
        await store.waitFor();
        await page.waitForFunction(() => !document.body.textContent.includes("불러오는 중"));
        const [headerBox, bellBox, storeBox, profileBox] = await Promise.all([header, bell, store, profile].map((locator) => locator.boundingBox()));
        assert.ok(headerBox && bellBox && storeBox && profileBox);
        // 순서: 알림 → 매장 → 프로필, 겹침 없음, 모두 헤더 안에 있다.
        assert.ok(bellBox.x + bellBox.width <= storeBox.x + 1, `${role} ${viewport.width}: store must be right of notifications`);
        assert.ok(storeBox.x + storeBox.width <= profileBox.x + 1, `${role} ${viewport.width}: store must be left of profile`);
        assert.ok(profileBox.x + profileBox.width <= viewport.width, `${role} ${viewport.width}: profile must stay in view`);
        for (const box of [bellBox, storeBox, profileBox]) {
          assert.ok(box.y >= headerBox.y && box.y + box.height <= headerBox.y + headerBox.height + 1);
        }
        assert.equal(await noHorizontalOverflow(page), true, `${role} ${viewport.width}: horizontal overflow`);
        geometry[role] = { header: headerBox, profile: profileBox };
        assert.deepEqual(errors, []);
        await page.screenshot({ path: path.join(screenshots, `${role}-header-${viewport.width}.png`) });
      } finally { await page.close(); }
    }
    assert.equal(geometry.owner.header.height, geometry.staff.header.height, "header height matches staff");
    assert.equal(geometry.owner.header.x, geometry.staff.header.x, "header start matches staff");
    assert.ok(Math.abs(geometry.owner.profile.x + geometry.owner.profile.width - (geometry.staff.profile.x + geometry.staff.profile.width)) <= 1, "profile right edge matches staff");
  }
});

test("owner profile shows name and role without duplicated store text; store name stays in the profile menu", async () => {
  const { page } = await openShell("owner", { width: 1280, height: 900 });
  try {
    const header = page.locator("header").first();
    await header.getByRole("button", { name: /현재 운영 매장 서울 중앙점/ }).waitFor();
    const profile = header.locator('button[aria-controls="profile-menu"]');
    const profileText = await profile.innerText();
    assert.match(profileText, /김점주/);
    assert.match(profileText, /점주/);
    assert.doesNotMatch(profileText, /서울 중앙점/, "store name is shown once, in the store selector");
    await profile.click();
    const menu = page.getByRole("menu", { name: "계정 메뉴" });
    await menu.getByText("현재 운영 매장").waitFor();
    await menu.getByText("서울 중앙점").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await menu.count(), 0);
  } finally { await page.close(); }
});

test("selecting another approved store by keyboard persists it, reloads and reflects the active store", async () => {
  for (const viewport of VIEWPORTS) {
    const { page, errors } = await openShell("owner", viewport);
    try {
      const trigger = page.getByRole("button", { name: /현재 운영 매장/ });
      await page.getByRole("button", { name: /현재 운영 매장 서울 중앙점/ }).waitFor();
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      const listbox = page.getByRole("listbox");
      await listbox.waitFor();
      const panel = listbox.locator("xpath=..");
      const panelBox = await panel.boundingBox();
      assert.ok(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= viewport.width, `${viewport.width}: dropdown must stay in view`);
      const profileBox = await page.locator('button[aria-controls="profile-menu"]').boundingBox();
      assert.ok(panelBox.y >= profileBox.y + profileBox.height - 1, "dropdown opens below the header controls");
      assert.equal(await page.getByRole("option", { name: /서울 중앙점/ }).getAttribute("aria-selected"), "true");
      assert.equal(await noHorizontalOverflow(page), true);
      await page.screenshot({ path: path.join(screenshots, `owner-store-open-${viewport.width}.png`) });
      await page.keyboard.press("ArrowDown");
      await Promise.all([page.waitForEvent("load"), page.keyboard.press("Enter")]);
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page.getByRole("status").filter({ hasText: `${LONG_STORE}으로 전환했습니다.` }).waitFor();
      const value = page.getByRole("button", { name: new RegExp(`현재 운영 매장 ${LONG_STORE}`) });
      await value.waitFor();
      const valueText = value.locator('span[id$="-value"]');
      assert.equal(await valueText.evaluate((element) => element.scrollWidth > element.clientWidth), true, "long store name is truncated");
      assert.equal(await noHorizontalOverflow(page), true, `${viewport.width}: long store name must truncate`);
      await page.screenshot({ path: path.join(screenshots, `owner-store-long-${viewport.width}.png`) });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});

test("store menu closes with Escape and outside click; manage and pending entries navigate to /boss/stores", async () => {
  const { page } = await openShell("owner", { width: 1280, height: 900 }, { pending: [{ storeId: "p", storeName: "대기점" }] });
  try {
    const trigger = page.getByRole("button", { name: /현재 운영 매장 서울 중앙점/ });
    await trigger.waitFor();
    await trigger.click();
    await page.getByRole("listbox").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("listbox").count(), 0);
    assert.equal(await trigger.evaluate((element) => element === document.activeElement), true, "focus returns to trigger");
    await trigger.click();
    await page.getByRole("heading", { level: 1 }).click();
    assert.equal(await page.getByRole("listbox").count(), 0);
    await trigger.click();
    await page.getByRole("button", { name: "승인 대기 1건" }).click();
    await trigger.click();
    await page.getByRole("button", { name: "운영 매장 관리" }).click();
    assert.deepEqual(await page.evaluate(() => window.fixture.navigation), ["/boss/stores", "/boss/stores"]);
    // 매장 메뉴와 알림 패널은 동시에 열리지 않는다.
    await trigger.click();
    await page.locator("header").getByRole("button").first().click();
    assert.equal(await page.getByRole("listbox").count(), 0);
  } finally { await page.close(); }
});

test("loading blocks selection, single-store owners still reach store management", async () => {
  const loading = await openShell("owner", { width: 390, height: 844 }, { holdStores: true });
  try {
    const trigger = loading.page.getByRole("button", { name: /현재 운영 매장 매장을 불러오는 중/ });
    await trigger.waitFor();
    assert.equal(await trigger.isDisabled(), true);
    await loading.page.evaluate(() => window.fixture.releaseStores());
    await loading.page.getByRole("button", { name: /현재 운영 매장 서울 중앙점/ }).waitFor();
  } finally { await loading.page.close(); }

  const single = await openShell("owner", { width: 390, height: 844 }, { stores: [STORES[0]] });
  try {
    const trigger = single.page.getByRole("button", { name: /현재 운영 매장 서울 중앙점/ });
    await trigger.click();
    assert.equal(await single.page.getByRole("option").count(), 1);
    await single.page.getByRole("button", { name: "운영 매장 관리" }).waitFor();
  } finally { await single.page.close(); }

  const empty = await openShell("owner", { width: 390, height: 844 }, { stores: [] });
  try {
    await empty.page.getByRole("button", { name: /현재 운영 매장 승인된 매장이 없습니다/ }).waitFor();
    assert.equal(await noHorizontalOverflow(empty.page), true);
  } finally { await empty.page.close(); }
});

test("owner sidebar keeps menu, active state, settings/logout and mobile navigation", async () => {
  for (const viewport of VIEWPORTS) {
    const { page } = await openShell("owner", viewport, { dark: viewport.width === 390 });
    try {
      if (viewport.width < 1024) {
        const toggle = page.getByRole("button", { name: "메뉴 열기" });
        const toggleBox = await toggle.boundingBox();
        const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"), { x: toggleBox.x + toggleBox.width / 2, y: toggleBox.y + toggleBox.height / 2 });
        assert.equal(hit, "메뉴 열기", "mobile menu button must not be covered by the header");
        await toggle.focus();
        await page.keyboard.press("Enter");
        await page.locator("aside.translate-x-0").waitFor();
        await page.locator("aside").evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
        assert.equal(await page.getByRole("button", { name: "메뉴 닫기" }).getAttribute("aria-expanded"), "true");
      }
      const aside = page.locator("aside");
      if (viewport.width === 390) {
        for (const surface of [aside, page.locator("header").first()]) {
          assert.notEqual(await surface.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)", "dark theme surface");
        }
      }
      const asideBox = await aside.boundingBox();
      assert.ok(asideBox && asideBox.x >= 0 && asideBox.width >= 200 && asideBox.width <= 270);
      const labels = await aside.locator("nav a").allInnerTexts();
      assert.deepEqual(labels.map((label) => label.trim()), ["홈", "공통 매뉴얼 관리", "지점 매뉴얼 관리", "직원 관리", "보류 질문", "운영 매장", "공지사항"]);
      assert.equal(await aside.getByRole("link", { name: "홈", exact: true }).getAttribute("aria-current"), "page");
      await aside.getByRole("link", { name: "설정", exact: true }).waitFor();
      const logout = aside.getByRole("button", { name: "로그아웃" });
      await logout.click();
      assert.equal(await page.evaluate(() => window.fixture.loggedOut), true);
      await page.screenshot({ path: path.join(screenshots, `owner-sidebar-${viewport.width}${viewport.width === 390 ? "-dark" : ""}.png`) });
    } finally { await page.close(); }
  }
});
