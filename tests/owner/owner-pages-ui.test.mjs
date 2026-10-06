import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, globSync, mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import ts from "typescript";

// 실제 점주 페이지 컴포넌트 전체(Sidebar·Header·본문)를 Chromium에서 렌더링해 직원 화면과 레이아웃을 비교한다.
// 인증·현재 매장·API 응답·라우팅만 mock이며 DB/외부 네트워크 호출은 차단한다.
const root = process.cwd();
const require = createRequire(import.meta.url);
const STORES = [
  { storeId: "store-a", storeName: "버거킹 노량진역점" },
  { storeId: "store-b", storeName: "버거킹 서울특별시 강남구 테헤란로 아주 긴 이름의 대표 매장" },
];
const modules = new Map();
const mocks = {
  "next/link": "const React=require('react'); exports.default=({href,children,prefetch,scroll,replace,...props})=>React.createElement('a',{...props,href:typeof href==='string'?href:String(href?.pathname??'')},children);",
  "next/image": "const React=require('react'); exports.default=({priority,fill,...props})=>React.createElement('img',props);",
  "next/navigation": "const router={push:(href)=>window.fixture.navigation.push(href),replace:(href)=>window.fixture.navigation.push(href),back:()=>{},refresh:()=>{},prefetch:()=>{}}; exports.useRouter=()=>router; exports.usePathname=()=>location.pathname; exports.useSearchParams=()=>new URLSearchParams(location.search); exports.redirect=()=>{};",
  "@/lib/owner/current-store": `
    exports.resolveOwnerCurrentStore = async () => {
      const stores = window.fixture.stores;
      const selected = sessionStorage.getItem('fixtureSelectedStore');
      const current = stores.find((store) => store.storeId === selected) || stores[0] || null;
      return { status: 'ready', stores, current, pending: [{ membershipId: 'pending-1', storeId: 'store-p', storeName: '버거킹 신규점', requestedAt: '2026-10-01T00:00:00Z' }] };
    };
    exports.persistSelectedStore = ({ storeId }) => { sessionStorage.setItem('fixtureSelectedStore', storeId); };`,
  "@/lib/supabase/client": `
    const user = { id: 'owner-user', email: 'owner@example.com', user_metadata: { name: '김점주', role: 'owner' } };
    const profile = { role: 'owner', approval_status: 'approved', full_name: '김점주', brand_id: null, avatar_url: null, avatar_updated_at: null };
    const query = { select: () => query, eq: () => query, in: () => query, order: () => query, maybeSingle: async () => ({ data: profile, error: null }), single: async () => ({ data: profile, error: null }) };
    exports.createClient = () => ({
      auth: {
        getUser: async () => ({ data: { user }, error: null }),
        getSession: async () => ({ data: { session: { user } }, error: null }),
        signOut: async () => { window.fixture.loggedOut = true; return {}; },
        refreshSession: async () => ({}),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      from: () => query,
    });`,
  "@/lib/auth/client-profile": "exports.getAuthenticatedProfile=async()=>({role:'owner',approvalStatus:'approved'});",
  "@/lib/supabase/storage-profile-avatar": "exports.uploadProfileAvatarClient=async()=>({success:false});exports.deleteProfileAvatarClient=async()=>({success:false});",
  "@/lib/notifications": "exports.formatNotificationTime=()=>'방금 전';",
  "@/lib/theme-context": "exports.useTheme=()=>({theme:'light',setTheme:()=>{},resolvedTheme:'light'});",
  "@/components/signup/StoreMap": "const React=require('react'); exports.default=()=>React.createElement('div',{className:'h-64 rounded-xl border border-[var(--color-border)] bg-white'},'map');",
  "@/components/staff/StaffShellContext": "exports.useStaffShell=()=>window.fixture.staff;",
};

function resolveAlias(dependency) {
  const base = path.join(root, dependency.slice(2));
  return [`${base}.tsx`, `${base}.ts`, `${base}.js`, path.join(base, "index.ts")].find((filename) => existsSync(filename) && statSync(filename).isFile());
}

function bundleModule(filename) {
  if (modules.has(filename)) return filename;
  modules.set(filename, "");
  let source = filename in mocks ? mocks[filename] : readFileSync(filename, "utf8");
  if (filename in mocks && source.includes("exports.default")) source = `exports.__esModule=true;${source}`;
  if (/\.(tsx?|mjs)$/.test(filename) || source.includes("import ")) {
    if (/\.tsx?$/.test(filename)) source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020 } }).outputText;
  }
  source = source.replace(/require\(["']([^"']+)["']\)/g, (_match, dependency) => {
    let resolved;
    if (dependency in mocks) resolved = dependency;
    else if (dependency.startsWith("@/")) {
      resolved = resolveAlias(dependency);
      assert.ok(resolved, `Unresolved fixture dependency: ${dependency}`);
    } else if (dependency.startsWith(".") && /\.tsx?$/.test(filename)) {
      const base = path.resolve(path.dirname(filename), dependency);
      resolved = [`${base}.tsx`, `${base}.ts`, `${base}.js`, base, path.join(base, "index.ts")].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
      assert.ok(resolved, `Unresolved relative dependency: ${dependency} from ${filename}`);
    } else resolved = createRequire(path.isAbsolute(filename) ? filename : import.meta.url).resolve(dependency);
    return `require(${JSON.stringify(bundleModule(resolved))})`;
  });
  modules.set(filename, source);
  return filename;
}

const PAGES = {
  home: { file: "app/boss/page.tsx", heading: /안녕하세요/ },
  employees: { file: "app/boss/employees/page.tsx", heading: "직원 관리" },
  manuals: { file: "app/boss/manuals/page.tsx", heading: "공통 매뉴얼 관리" },
  "store-manuals": { file: "app/boss/store-manuals/page.tsx", heading: "지점 매뉴얼 관리" },
  questions: { file: "app/boss/questions/BossQuestionsView.tsx", heading: "확인이 필요한 직원 질문", props: { requestedStoreId: null, highlightQuestionId: null } },
  repeated: { file: "app/boss/questions/repeated/RepeatedQuestionView.tsx", heading: "반복 질문", props: { storeId: "store-a", alertId: "alert-1" }, hasBackLink: true },
  "question-detail": { file: "app/boss/questions/[id]/BossQuestionDetailView.tsx", heading: /개봉한 우유/, props: { questionId: "q-1", requestedStoreId: "store-a" }, hasBackLink: true },
  stores: { file: "app/boss/stores/page.tsx", heading: "운영 매장" },
  "stores-add": { file: "app/boss/stores/add/page.tsx", heading: /매장/, hasBackLink: true },
  notices: { file: "app/boss/notices/page.tsx", heading: "공지사항" },
  "notices-new": { file: "app/boss/notices/new/page.tsx", heading: "직원 공지 작성", hasBackLink: true },
  notifications: { file: "app/boss/notifications/page.tsx", heading: "알림" },
  settings: { file: "app/boss/settings/page.tsx", heading: "환경설정" },
};

const pageEntries = Object.fromEntries(Object.entries(PAGES).map(([name, page]) => [name, bundleModule(path.join(root, page.file))]));
const staffNotices = bundleModule(path.join(root, "app/staff/notices/page.tsx"));
const staffHeader = bundleModule(path.join(root, "components/staff/StaffHeader.tsx"));
const staffSidebar = bundleModule(path.join(root, "components/staff/StaffSidebar.tsx"));
const react = bundleModule(require.resolve("react"));
const reactDom = bundleModule(require.resolve("react-dom/client"));
const app = `
  const React = require(${JSON.stringify(react)});
  const h = React.createElement;
  const pages = { ${Object.entries(pageEntries).map(([name, file]) => `${JSON.stringify(name)}: () => require(${JSON.stringify(file)}).default`).join(",")} };
  const props = ${JSON.stringify(Object.fromEntries(Object.entries(PAGES).map(([name, page]) => [name, page.props ?? {}])))};
  const name = window.fixture.page;
  let element;
  if (name === 'staff-notices') {
    // 직원 기준 화면: StaffShell과 같은 구조(Sidebar + Header + main)
    element = h('div', { className: 'h-screen overflow-hidden bg-[var(--color-bg-default)]' },
      h(require(${JSON.stringify(staffSidebar)}).default, { activeMenu: 'notice', onLogout: () => {} }),
      h('div', { className: 'lg:ml-[240px] h-screen flex flex-col overflow-hidden' },
        h(require(${JSON.stringify(staffHeader)}).default),
        h('main', { className: 'flex-1 min-h-0 overflow-y-auto' }, h(require(${JSON.stringify(staffNotices)}).default))));
  } else {
    element = h(pages[name](), props[name]);
  }
  require(${JSON.stringify(reactDom)}).createRoot(document.getElementById('root')).render(element);`;
const bundle = `const process={env:{NODE_ENV:'development'}};const modules={${[...modules].map(([name, source]) => `${JSON.stringify(name)}:(module,exports,require)=>{${source}\n}`).join(",")}};const cache={};function require(name){if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;modules[name](module,module.exports,require);return module.exports;}${app}`;

let browser;
let server;
let url;
const screenshots = mkdtempSync(path.join(tmpdir(), "ilitda-owner-pages-ui-"));
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

function installFixture({ page, stores }) {
  const now = "2026-10-05T09:00:00Z";
  const question = { id: "q-1", question: "개봉한 우유는 언제까지 사용할 수 있나요?", status: "insufficient", createdAt: now, originReason: "frequent_question", repeatCount: 4, resolutionStatus: "open", resolutionRevision: 1, resolutionUpdatedAt: null, resolvedAt: null };
  const manual = (id, extra = {}) => ({ id, title: "오픈 체크리스트", category: "매장운영", content: "매장 오픈 전 확인 사항입니다.", store_id: "store-a", parent_manual_id: null, status: "approved", created_at: now, updated_at: now, ...extra });
  const manuals = [manual("m-1"), manual("m-1a", { parent_manual_id: "m-1", title: "1. 전원 확인", content: "전원을 켭니다." }), manual("m-2", { title: "고객 응대 특이사항", category: "고객응대" })];
  const notice = (id, extra = {}) => ({ id, isMine: false, isRead: false, viewCount: 1, title: "버거 본사 공지사항입니다.", content: "이번 주 운영 안내입니다.", category: "운영 안내", isImportant: false, createdAt: now, updatedAt: now, franchiseName: "버거킹", ...extra });
  const staffStores = stores.map((store) => ({ id: store.storeId, name: store.storeName }));
  window.fixture = {
    page, stores, navigation: [], unexpected: [],
    staff: { userName: "노량맨", roleLabel: "직원", isStoresLoading: false, storesError: "", stores: staffStores, selectedStore: staffStores[0], defaultStoreId: staffStores[0].id, reloadStores: () => {}, saveStorePreferences: async () => true },
  };
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  window.fetch = async (input, init = {}) => {
    const endpoint = String(input);
    const method = init.method || "GET";
    window.fixture.calls = [...(window.fixture.calls || []), { endpoint, method, body: init.body }];
    if (!endpoint.startsWith("/api/")) throw Error(`External fetch forbidden: ${endpoint}`);
    if (endpoint === "/api/store-manuals/search-readiness/reindex" && method === "POST") {
      return window.fixture.reindexFails ? json({ error: "검색 준비를 다시 하지 못했어요." }, 500) : json({ reindexed: true });
    }
    if (/^\/api\/store-manuals\/[^/?]+$/.test(endpoint) && method === "PATCH") return json({ searchStatus: "failed" });
    if (endpoint.startsWith("/api/notifications")) return json({ success: true, data: { unreadCount: 1, notifications: [
      { id: "n-1", recipientUserId: "owner-user", type: "staff_join_request", title: "새 직원 가입 요청", message: "노량맨님이 버거킹 노량진역점 가입을 요청했습니다.", isRead: false, createdAt: now },
      { id: "n-2", recipientUserId: "owner-user", type: "hq_notice", title: "본사 공지", message: "이번 주 운영 안내입니다.", isRead: true, createdAt: now },
    ] } });
    if (endpoint.startsWith("/api/boss/employees")) return json({ success: true, data: {
      pending: [{ membershipId: "p-1", name: "노량맨", email: "staff@example.com", requestedAt: now }],
      approved: [{ membershipId: "a-1", name: "김직원", email: "kim@example.com", requestedAt: now, approvedAt: now, needsBrandProfileRecovery: false }],
      summary: { total: 2, pending: 1, approved: 1 },
    } });
    if (endpoint.startsWith("/api/store-manuals/search-readiness")) return json({ report: { summary: { readyCount: 2, needsReindexCount: 0, notSearchableCount: 0, totalDetailManualCount: 2 }, groups: [] } });
    if (endpoint.startsWith("/api/store-manuals")) return json({ manuals });
    if (endpoint.startsWith("/api/manuals")) return json({ manuals });
    if (endpoint.startsWith("/api/boss/notices")) return json({ success: true, data: { notices: [notice("nt-1"), notice("nt-2", { isMine: true, isRead: true, title: "주말 근무 안내", category: "기타" })], summary: { total: 2, important: 0 } } });
    if (endpoint.startsWith("/api/franchises")) return json({ franchises: [] });
    if (endpoint.startsWith("/api/signup/store-membership")) return json({ success: true, data: [{ storeId: "store-a", storeName: stores[0].storeName, status: "approved", role: "owner" }] });
    if (endpoint.includes("/context?")) return json({ context: { answer: "매뉴얼 근거가 부족합니다.", sourceState: "none", source: null } });
    if (endpoint.startsWith("/api/boss/question-logs")) return json({ success: true, data: { questions: [question, { ...question, id: "q-2", question: "포장 용기는 어디에 있나요?", originReason: "insufficient_evidence", resolutionStatus: "in_progress" }], resolutionFeatureAvailable: true } });
    if (endpoint.startsWith("/api/boss/repeated-questions")) return json({ success: true, data: { alert: { storeId: "store-a", alertedAt: now, analysisLimited: false, representativeQuestion: question.question, repeatCount: 4, windowDays: 7, windowStart: now, windowEnd: now, categoryLabel: "위생·안전", statusCounts: { answered: 1, cautious: 1, insufficient: 2 } } } });
    if (endpoint.startsWith("/api/staff/notices")) return json({ notices: [{ id: "s-1", isRead: false, viewCount: 1, sourceLabel: "본사 공지", targetType: "franchise", title: "버거 본사 공지사항입니다.", content: "운영 안내", authorName: "본사", createdAt: now }] });
    window.fixture.unexpected.push(endpoint);
    return json({ success: true, data: [], stores: [] });
  };
}

async function openPage(name, viewport, { dark = false, stores = STORES } = {}) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await page.addInitScript(installFixture, { page: name, stores });
  await page.goto(url);
  const heading = name === "staff-notices" ? "공지사항" : PAGES[name].heading;
  try {
    await page.getByRole("heading", { level: 1, name: heading }).waitFor();
  } catch (error) {
    await page.close();
    throw new Error(`${name} ${viewport.width}: ${errors.join("\n") || error.message}`);
  }
  await page.waitForFunction(() => !/불러오는 중|확인하는 중/.test(document.querySelector("main")?.textContent ?? ""), null, { timeout: 8000 }).catch(() => {});
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  return { page, errors };
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const h1 = document.querySelector("main h1");
    const header = document.querySelector("header");
    const aside = document.querySelector("aside");
    const desc = h1?.parentElement?.querySelector("p");
    const box = (element) => element ? element.getBoundingClientRect() : null;
    return {
      h1: box(h1), h1Font: h1 ? getComputedStyle(h1).fontSize : null, h1Weight: h1 ? getComputedStyle(h1).fontWeight : null,
      descFont: desc ? getComputedStyle(desc).fontSize : null,
      header: box(header), aside: box(aside),
      overflow: document.documentElement.scrollWidth > innerWidth,
      offenders: [...document.querySelectorAll("body *")]
        .filter((element) => element.getBoundingClientRect().right > innerWidth + 1 && !element.closest("aside"))
        .slice(0, 5)
        .map((element) => `${element.tagName}.${String(element.className).slice(0, 80)}`),
    };
  });
}

test("every owner page renders inside the owner shell with the staff title, spacing and no horizontal overflow", async () => {
  for (const viewport of VIEWPORTS) {
    const reference = await openPage("staff-notices", viewport);
    const staff = await layoutMetrics(reference.page);
    await reference.page.screenshot({ path: path.join(screenshots, `staff-notices-${viewport.width}.png`), fullPage: true });
    await reference.page.close();

    for (const name of Object.keys(PAGES)) {
      const { page, errors } = await openPage(name, viewport);
      try {
        const owner = await layoutMetrics(page);
        assert.ok(owner.header && owner.aside, `${name} ${viewport.width}: owner Header and Sidebar must render`);
        assert.equal(owner.header.height, staff.header.height, `${name}: header height`);
        assert.equal(owner.overflow, false, `${name} ${viewport.width}: horizontal overflow ${owner.offenders.join(" | ")}`);
        assert.ok(Math.abs(owner.h1.x - staff.h1.x) <= 1, `${name} ${viewport.width}: content start x ${owner.h1.x} vs staff ${staff.h1.x}`);
        if (!PAGES[name].hasBackLink) {
          assert.ok(Math.abs(owner.h1.y - staff.h1.y) <= 1, `${name} ${viewport.width}: title top ${owner.h1.y} vs staff ${staff.h1.y}`);
        }
        if (name !== "question-detail") {
          assert.equal(owner.h1Font, staff.h1Font, `${name}: title size`);
          assert.equal(owner.h1Weight, staff.h1Weight, `${name}: title weight`);
        }
        if (name !== "question-detail" && name !== "stores-add") assert.equal(owner.descFont, staff.descFont, `${name}: description size`);
        assert.deepEqual(errors, [], `${name}: page errors`);
        await page.screenshot({ path: path.join(screenshots, `owner-${name}-${viewport.width}.png`), fullPage: true });
      } finally { await page.close(); }
    }
  }
});

test("owner list controls use staff search, chip and card styles", async () => {
  const styleOf = (locator) => locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { radius: style.borderTopLeftRadius, borderWidth: style.borderTopWidth, height: element.getBoundingClientRect().height, shadow: style.boxShadow };
  });
  const reference = await openPage("staff-notices", { width: 1280, height: 900 });
  const staffSearch = await styleOf(reference.page.getByRole("searchbox"));
  const staffChip = await styleOf(reference.page.getByRole("button", { name: "본사 공지", exact: true }));
  const staffCard = await styleOf(reference.page.locator("main ul button").first());
  await reference.page.close();

  for (const [name, searchLabel] of [["employees", "직원 검색"], ["manuals", "카테고리 검색"], ["store-manuals", "카테고리 검색"], ["notices", "공지사항 검색"]]) {
    const { page } = await openPage(name, { width: 1280, height: 900 });
    try {
      const search = await styleOf(page.getByRole("searchbox", { name: searchLabel }));
      assert.deepEqual({ radius: search.radius, borderWidth: search.borderWidth }, { radius: staffSearch.radius, borderWidth: staffSearch.borderWidth }, `${name}: search style`);
      assert.ok(Math.abs(search.height - staffSearch.height) <= 1, `${name}: search height`);
    } finally { await page.close(); }
  }

  for (const [name, chipName] of [["notices", "본사 공지"], ["questions", "처리 완료"]]) {
    const { page } = await openPage(name, { width: 1280, height: 900 });
    try {
      const chip = page.getByRole("button", { name: chipName, exact: true }).first();
      assert.ok(await chip.getAttribute("aria-pressed"), `${name}: chip exposes pressed state`);
      const style = await styleOf(chip);
      assert.equal(style.radius, staffChip.radius, `${name}: chip radius`);
      assert.ok(Math.abs(style.height - staffChip.height) <= 1, `${name}: chip height`);
    } finally { await page.close(); }
  }

  for (const [name, text] of [["manuals", "세부 매뉴얼"], ["store-manuals", "세부 매뉴얼"], ["notices", "조회"]]) {
    const { page } = await openPage(name, { width: 1280, height: 900 });
    try {
      const card = await styleOf(page.locator("main section button").filter({ hasText: text }).first());
      assert.deepEqual({ radius: card.radius, borderWidth: card.borderWidth, shadow: card.shadow }, { radius: staffCard.radius, borderWidth: staffCard.borderWidth, shadow: staffCard.shadow }, `${name}: card style`);
    } finally { await page.close(); }
  }
});

test("owner functions keep working: store switch, approval actions, question chips, manual drill-down, notifications", async () => {
  const { page } = await openPage("employees", { width: 390, height: 844 });
  try {
    await page.getByRole("button", { name: "승인", exact: true }).waitFor();
    await page.getByRole("button", { name: "거절", exact: true }).waitFor();
    await page.getByRole("button", { name: "소속 해제" }).waitFor();
    await page.getByRole("searchbox", { name: "직원 검색" }).fill("없는 이름");
    await page.getByText("검색 결과가 없습니다.").waitFor();
    const trigger = page.getByRole("button", { name: /현재 운영 매장/ });
    await trigger.click();
    await Promise.all([page.waitForEvent("load"), page.getByRole("option").nth(1).click()]);
    await page.getByRole("heading", { level: 1, name: "직원 관리" }).waitFor();
    await page.getByText(STORES[1].storeName, { exact: false }).first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "long store name must not overflow");
  } finally { await page.close(); }

  const questions = await openPage("questions", { width: 1280, height: 900 });
  try {
    const chip = questions.page.getByRole("button", { name: "처리 완료", exact: true }).first();
    await chip.click();
    assert.equal(await chip.getAttribute("aria-pressed"), "true");
  } finally { await questions.page.close(); }

  const manuals = await openPage("manuals", { width: 390, height: 844 });
  try {
    await manuals.page.locator("main section button").filter({ hasText: "매장운영" }).first().click();
    await manuals.page.getByRole("button", { name: "카테고리 목록" }).waitFor();
    await manuals.page.locator("main section button").filter({ hasText: "오픈 체크리스트" }).click();
    await manuals.page.getByText("전원을 켭니다.").waitFor();
    await manuals.page.getByRole("button", { name: "타이틀 목록" }).click();
    await manuals.page.getByRole("button", { name: "카테고리 목록" }).click();
    await manuals.page.getByRole("searchbox", { name: "카테고리 검색" }).waitFor();
  } finally { await manuals.page.close(); }

  const notifications = await openPage("notifications", { width: 320, height: 740 });
  try {
    await notifications.page.getByRole("button", { name: /새 직원 가입 요청/ }).waitFor();
    const unread = notifications.page.getByRole("group", { name: "알림 필터" }).getByRole("button", { name: /읽지 않음/ });
    await unread.click();
    assert.equal(await unread.getAttribute("aria-pressed"), "true");
    assert.equal(await notifications.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally { await notifications.page.close(); }
});

test("store manual management drops the readiness panel, store card and HQ bar while keeping actions and search retry", async () => {
  for (const viewport of VIEWPORTS) {
    const { page, errors } = await openPage("store-manuals", viewport);
    try {
      const main = page.locator("main");
      assert.equal(await page.getByRole("region", { name: "검색 준비 상태" }).count(), 0, "readiness panel removed");
      assert.equal(await page.getByText("자세히 보기").count(), 0);
      assert.equal(await main.getByText("승인 완료", { exact: true }).count(), 0, "store card removed");
      assert.equal(await page.getByText("본사 공통 매뉴얼 확인").count(), 0, "HQ bottom bar removed");
      assert.equal(await page.locator('a[href="/boss/manuals"]').filter({ hasNotText: "공통 매뉴얼 관리" }).count(), 0);
      assert.equal(await page.locator(".fixed.bottom-0").count(), 0, "no fixed bottom area");
      await page.getByRole("button", { name: /현재 운영 매장/ }).waitFor();
      await page.getByRole("link", { name: "공통 매뉴얼 관리" }).first().waitFor({ state: "attached" });

      // 제목·설명 바로 아래 검색창과 관리 버튼, 그 다음 개수·카드가 이어진다.
      const description = await main.locator("h1 + p").boundingBox();
      const search = await page.getByRole("searchbox", { name: "카테고리 검색" }).boundingBox();
      const register = await page.getByRole("button", { name: /매뉴얼 등록/ }).boundingBox();
      const count = await main.getByText(/카테고리 \d+개/).boundingBox();
      const firstCard = await main.locator("section button").filter({ hasText: "세부 매뉴얼" }).first().boundingBox();
      assert.ok(search.y - (description.y + description.height) <= 40, `${viewport.width}: no gap left by removed blocks (${search.y - (description.y + description.height)}px)`);
      assert.ok(register.y >= search.y - 1 && count.y > search.y && firstCard.y > count.y, `${viewport.width}: search → actions → count → cards order`);
      await page.getByRole("button", { name: /카테고리 추가/ }).waitFor();

      const mainBottom = await main.evaluate((element) => element.getBoundingClientRect().bottom);
      const lastCard = await main.locator("section button").filter({ hasText: "세부 매뉴얼" }).last();
      await lastCard.scrollIntoViewIfNeeded();
      const lastBox = await lastCard.boundingBox();
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "", { x: lastBox.x + lastBox.width / 2, y: lastBox.y + lastBox.height - 4 });
      assert.ok(hit.includes("세부 매뉴얼"), `${viewport.width}: last card must not be covered`);
      assert.ok(mainBottom > 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${viewport.width}: horizontal overflow`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(screenshots, `owner-store-manuals-cleanup-${viewport.width}.png`), fullPage: true });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }

  const { page } = await openPage("store-manuals", { width: 390, height: 844 });
  try {
    await page.locator("main section button").filter({ hasText: "매장운영" }).first().click();
    await page.locator("main section button").filter({ hasText: "오픈 체크리스트" }).first().click();
    await page.getByRole("button", { name: "수정", exact: true }).first().click();
    await page.getByLabel("매뉴얼 본문").fill("전원을 켜고 온도를 확인합니다.");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page.getByText("검색 반영에 실패했습니다.", { exact: false }).waitFor();
    await page.evaluate(() => { window.fixture.reindexFails = true; });
    const retry = page.getByRole("button", { name: "검색 반영 다시 처리" });
    await retry.click();
    await page.getByText("1건을 다시 처리하지 못했습니다", { exact: false }).waitFor();
    await page.evaluate(() => { window.fixture.reindexFails = false; });
    await retry.click();
    await page.getByText("검색 반영을 다시 처리했습니다.", { exact: false }).waitFor();
    assert.equal(await retry.count(), 0, "retry disappears after success");
    const reindexCalls = await page.evaluate(() => window.fixture.calls.filter((call) => call.endpoint.endsWith("/reindex")).map((call) => JSON.parse(call.body)));
    assert.deepEqual(reindexCalls, [{ storeId: "store-a", manualId: "m-1a" }, { storeId: "store-a", manualId: "m-1a" }]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally { await page.close(); }
});

test("dark theme keeps owner surfaces off pure white", async () => {
  for (const name of ["employees", "notifications", "notices", "manuals"]) {
    const { page } = await openPage(name, { width: 390, height: 844 }, { dark: true });
    try {
      const background = await page.locator("main .rounded-xl, main input[type=search]").first().evaluate((element) => getComputedStyle(element).backgroundColor);
      assert.notEqual(background, "rgb(255, 255, 255)", `${name}: dark surface`);
      await page.screenshot({ path: path.join(screenshots, `owner-${name}-390-dark.png`), fullPage: true });
    } finally { await page.close(); }
  }
});
