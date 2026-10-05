import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, globSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const store = { storeId: "store", storeName: "서울 중앙점" };
const question = { id: "question", question: "개봉한 우유는 언제까지 사용할 수 있나요?", status: "insufficient", createdAt: "2026-10-04T01:30:00Z", originReason: "frequent_question", repeatCount: 4, resolutionStatus: "open", resolutionRevision: 1 };
const manual = { id: "manual", title: "개봉한 우유 보관과 폐기 기준", category: "위생", content: "개봉 시각을 기록하고 보관 기준을 확인합니다.", store_id: "store", parent_manual_id: null };
const context = { answer: "매뉴얼 근거가 부족해 점주 확인이 필요합니다.", sourceState: "available", source: { ...manual, editable: true, status: "approved" } };
const modules = new Map();
const mocks = {
  "next/link": "const React=require('react'); exports.default=({href,children,...props})=>React.createElement('a',{...props,href},children);",
  "next/image": "const React=require('react'); exports.default=({priority,fill,...props})=>React.createElement('img',props);",
  "next/navigation": "exports.useRouter=()=>({push:(href)=>window.fixture.navigation.push(href)});",
  "@/lib/owner/current-store": `exports.resolveOwnerCurrentStore=async()=>({status:'ready',stores:[${JSON.stringify(store)}],current:${JSON.stringify(store)},pending:[]}); exports.persistSelectedStore=()=>{};`,
  "@/lib/supabase/client": "exports.createClient=()=>({auth:{getSession:async()=>({data:{session:{user:{user_metadata:{name:'점주'}}}}}),signOut:async()=>{}}});",
  "@/lib/manuals/store-manual-auth": "exports.requireStoreOwner=()=>{throw Error('DB access forbidden in UI fixture');};",
  "@/components/owner/OwnerHeader": "const React=require('react'); exports.default=({storeName})=>React.createElement('header',{className:'sticky top-0 z-50 h-16 shrink-0 border-b border-[var(--color-border)] bg-white flex items-center pl-16 lg:pl-6'},storeName);",
};

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
      const base = path.join(root, dependency.slice(2));
      resolved = [base, `${base}.tsx`, `${base}.ts`, `${base}.js`].find((filename) => existsSync(filename));
      assert.ok(resolved, `Unresolved fixture dependency: ${dependency}`);
    }
    else resolved = createRequire(path.isAbsolute(filename) ? filename : import.meta.url).resolve(dependency);
    return `require(${JSON.stringify(bundleModule(resolved))})`;
  });
  modules.set(filename, source);
  return filename;
}

const entry = bundleModule(path.join(root, "app/boss/questions/[id]/BossQuestionDetailView.tsx"));
const hqSidebar = bundleModule(path.join(root, "components/hq/HQSidebar.tsx"));
const staffSidebar = bundleModule(path.join(root, "components/staff/StaffSidebar.tsx"));
const react = bundleModule(require.resolve("react"));
const reactDom = bundleModule(require.resolve("react-dom/client"));
const bundle = `const process={env:{NODE_ENV:'development'}};const modules={${[...modules].map(([name, source]) => `${JSON.stringify(name)}:(module,exports,require)=>{${source}\n}`).join(",")}};const cache={};function require(name){if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;modules[name](module,module.exports,require);return module.exports;}const React=require(${JSON.stringify(react)});const role=window.fixture?.role;const element=role?React.createElement(React.Fragment,null,React.createElement(require(role==='hq'?${JSON.stringify(hqSidebar)}:${JSON.stringify(staffSidebar)}).default,{userName:'검증 계정',franchiseName:'검증 브랜드',onLogout:()=>{},activeMenu:role==='hq'?'manual-common':'ai-chat'}),React.createElement('main',{className:'ml-0 lg:ml-[240px] p-5 sm:p-8 min-w-0'},React.createElement('h1',null,role==='hq'?'매뉴얼 관리':'AI 챗봇'))):React.createElement(require(${JSON.stringify(entry)}).default,{questionId:'question',requestedStoreId:'store'});require(${JSON.stringify(reactDom)}).createRoot(document.getElementById('root')).render(element);`;
let browser;
let server;
let url;
const screenshots = mkdtempSync(path.join(tmpdir(), "ilitda-followup-ui-"));

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

test("Tailwind variable spelling preserves generated CSS and HQ/staff shell smoke stays responsive", async () => {
  const design = await require("@tailwindcss/node").__unstable__loadDesignSystem(readFileSync("app/globals.css", "utf8"), { base: root });
  const pairs = new Map([["border-[var(--color-border)]", "border-(--color-border)"], ["text-[var(--color-text-secondary)]", "text-(--color-text-secondary)"], ["break-words", "wrap-break-word"], ["supports-[backdrop-filter]:bg-white/85", "supports-backdrop-filter:bg-white/85"]]);
  for (const filename of globSync(["app/**/*.tsx", "components/**/*.tsx"])) {
    const source = readFileSync(filename, "utf8");
    for (const match of source.matchAll(/((?:[\w-]+:)*(?:bg|text|border(?:-[trblxy])?|outline|ring|placeholder)-)(?:\[var\((--[\w-]+)\)\]|\((--[\w-]+)\))(\/\d+)?/g)) {
      const variable = match[2] || match[3];
      const modifier = match[4] || "";
      pairs.set(`${match[1]}[var(${variable})]${modifier}`, `${match[1]}(${variable})${modifier}`);
    }
  }
  for (const [before, after] of pairs) {
    const styles = [before, after].map((candidate) => {
      const css = design.candidatesToCss([candidate])[0];
      assert.ok(css, `Missing generated CSS: ${candidate}`);
      const parsed = require("postcss").parse(css);
      parsed.walkRules((node) => {
        if (node.selector.startsWith(".")) node.selector = node.selector.replace(/^(?:\\.|[^\s:])+/, ".utility");
      });
      return parsed.toString();
    });
    assert.equal(styles[0], styles[1], `${before} must preserve all declarations and variants`);
  }
  for (const role of ["hq", "staff"]) for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.route("**/*", (route) => route.request().url().startsWith(url) ? route.continue() : route.abort());
      await page.addInitScript((role) => { window.fixture = { role, navigation: [] }; window.fetch = async () => { throw Error("NETWORK_FORBIDDEN"); }; }, role);
      await page.goto(url);
      await page.getByRole("heading", { level: 1 }).waitFor();
      if (width < 1024) {
        await page.locator("button").first().focus();
        await page.keyboard.press("Space");
        await page.locator("aside.translate-x-0").waitFor();
        await page.locator("aside").evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
      }
      const sidebar = await page.locator("aside").boundingBox();
      assert.ok(sidebar && sidebar.x >= 0 && sidebar.width >= 200 && sidebar.width <= 270);
      const link = page.locator("aside a").first();
      await link.focus();
      assert.equal(await link.evaluate((element) => element === document.activeElement), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(screenshots, `shell-${role}-${width}.png`) });
    } finally { await page.close(); }
  }
});

async function openFixture(options = {}, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await page.addInitScript(({ question, manual, context, options }) => {
    window.fixture = { calls: [], navigation: [], copied: "", question, manual, context, ...options };
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text) => { if (window.fixture.copyFailure) throw Error("Clipboard denied"); window.fixture.copied = text; } } });
    window.fetch = async (input, init = {}) => {
      const fixture = window.fixture;
      const endpoint = String(input);
      fixture.calls.push({ endpoint, method: init.method || "GET", body: init.body });
      if (!endpoint.startsWith("/api/")) throw Error("External fetch forbidden");
      let status = 200;
      let body;
      if (endpoint.includes("/context?")) {
        if (fixture.contextFailure) { status = 500; body = {}; }
        else body = { context: fixture.context };
      } else if (endpoint.startsWith("/api/store-manuals?")) {
        if (fixture.holdManuals) await new Promise((resolve) => { fixture.releaseManuals = resolve; });
        if (fixture.manualsFailure) { status = 500; body = {}; }
        else body = { manuals: fixture.empty ? [] : fixture.manualRows || [fixture.manual, { ...fixture.manual, id: "other-store", store_id: "other" }] };
      } else if (endpoint.startsWith("/api/boss/question-logs")) {
        if (init.method === "PATCH") {
          if (fixture.holdPatch) await new Promise((resolve) => { fixture.releasePatch = resolve; });
          if (fixture.patchFailure) { status = 409; body = { success: false, error: "처리 상태가 변경되었습니다. 최신 내용을 확인해 주세요." }; }
          else { const update = JSON.parse(init.body); body = { success: true, data: { resolutionStatus: update.nextStatus, resolutionRevision: 2 } }; }
        } else body = { success: true, data: { questions: [fixture.question], resolutionFeatureAvailable: fixture.resolutionFeatureAvailable !== false } };
      } else throw Error(`Unexpected API: ${endpoint}`);
      return { ok: status < 400, status, json: async () => body };
    };
  }, { question, manual, context, options });
  await page.goto(url);
  try { await page.getByRole("heading", { level: 1, name: question.question }).waitFor(); }
  catch (error) { await page.close(); throw new Error(errors.join("\n") || error.message); }
  return { page, errors };
}

test("desktop and mobile: question first, keyboard selection, candidate selection and explicit edit URL", async () => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const { page, errors } = await openFixture({}, viewport);
    try {
      const selector = page.getByLabel("수정할 매장 매뉴얼을 선택하세요");
      await page.getByText("아직 선택한 매뉴얼이 없습니다.").waitFor();
      assert.equal(await selector.inputValue(), "");
      assert.equal(await page.getByRole("link", { name: "매뉴얼 편집", exact: true }).count(), 0);
      await selector.focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      const edit = page.getByRole("link", { name: "매뉴얼 편집", exact: true });
      await edit.waitFor();
      const target = new URL(await edit.getAttribute("href"), url);
      assert.equal(target.searchParams.get("storeId"), "store");
      assert.equal(target.searchParams.get("questionId"), "question");
      assert.equal(target.searchParams.get("manualId"), "manual");
      await edit.focus();
      const editBox = await edit.boundingBox();
      const mainBox = await page.locator("main").boundingBox();
      const footerBox = await page.getByRole("contentinfo", { name: "질문 처리 상태 변경" }).boundingBox();
      assert.ok(editBox && mainBox && footerBox && editBox.y >= mainBox.y
        && editBox.y + editBox.height <= mainBox.y + mainBox.height
        && mainBox.y + mainBox.height <= footerBox.y, "Editor action must not be covered by header or completion area");
      assert.equal(await selector.locator("option").count(), 2);
      const disclosure = page.getByRole("button", { name: "기존 챗봇 답변과 근거 후보" });
      await disclosure.focus();
      await page.keyboard.press("Enter");
      assert.equal(await disclosure.getAttribute("aria-expanded"), "true");
      await page.getByText("당시 전체 검색 근거는 저장되지 않았습니다.", { exact: false }).waitFor();
      await selector.selectOption("");
      await page.getByRole("button", { name: "이 근거 매뉴얼 선택" }).click();
      assert.equal(await selector.inputValue(), "manual");
      assert.equal(await selector.evaluate((element) => element === document.activeElement), true);
      await disclosure.click();
      assert.equal(await disclosure.getAttribute("aria-expanded"), "false");
      await page.getByRole("button", { name: "직원 재질문 안내" }).click();
      await page.getByText("이 버튼은 재질문을 실행하지 않습니다.", { exact: false }).waitFor();
      await page.getByRole("button", { name: "질문 원문 복사" }).click();
      assert.equal(await page.evaluate(() => window.fixture.copied), question.question);
      await page.getByRole("button", { name: "직원 재질문 안내" }).click();
      await page.locator("main").evaluate((element) => { element.scrollTop = 0; });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(screenshots, `ready-${viewport.width}.png`) });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const complete = await page.getByRole("button", { name: "처리 완료", exact: true }).boundingBox();
      assert.ok(complete && complete.y >= 0 && complete.y + complete.height <= viewport.height, "Completion action must remain in view");
      const calls = await page.evaluate(() => window.fixture.calls);
      assert.ok(calls.every((call) => call.method === "GET" && !call.endpoint.includes("/rag/")));
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});

test("grouped child choices preserve source headings, matching summaries, editor IDs and secondary link paths", async () => {
  const parent = { ...manual, id: "parent", title: "청소 및 마감 운영", category: "운영", content: "2 items" };
  const first = { ...parent, id: "child-first", parent_manual_id: parent.id, content: "7-3. 튀김기 관리\n전원을 끄고 청소합니다." };
  const second = { ...first, id: "child-second", content: "7-4. 튀김기 관리\n온도를 확인합니다." };
  const plain = { ...manual, id: "plain", title: "번호 없는 매장 안내", content: "번호 없는 자료의 본문입니다." };
  const duplicate = { ...plain, id: "duplicate" };
  const foreign = { ...first, id: "foreign", store_id: "other" };
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const { page, errors } = await openFixture({ manualRows: [parent, first, second, plain, duplicate, foreign] }, viewport);
    try {
      const selector = page.getByLabel("수정할 매장 매뉴얼을 선택하세요");
      await page.getByText("아직 선택한 매뉴얼이 없습니다.").waitFor();
      assert.equal(await selector.locator('optgroup[label="운영 · 청소 및 마감 운영"]').count(), 1);
      assert.equal(await selector.locator('option[value="parent"], option[value="foreign"]').count(), 0);
      assert.equal(await selector.locator('option[value="child-first"]').textContent(), "7-3. 튀김기 관리 · 청소 및 마감 운영");
      assert.equal(await selector.locator('option[value="child-second"]').textContent(), "7-4. 튀김기 관리 · 청소 및 마감 운영");
      await selector.focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      assert.equal(await selector.inputValue(), first.id);
      for (const [item, heading] of [[first, "7-3. 튀김기 관리"], [second, "7-4. 튀김기 관리"], [plain, "번호 없는 매장 안내 · ID plain"], [duplicate, "번호 없는 매장 안내 · ID duplicate"]]) {
        await selector.selectOption(item.id);
        await page.locator("p").filter({ hasText: heading }).waitFor();
        const editor = new URL(await page.getByRole("link", { name: "매뉴얼 편집", exact: true }).getAttribute("href"), url);
        assert.equal(editor.searchParams.get("manualId"), item.id);
        assert.equal(editor.searchParams.get("storeId"), "store");
        assert.equal(editor.searchParams.get("questionId"), "question");
      }
      await page.getByRole("button", { name: "답변과 매뉴얼 다시 불러오기" }).click();
      await page.locator("p").filter({ hasText: "번호 없는 매장 안내 · ID duplicate" }).waitFor();
      assert.equal(await selector.inputValue(), "duplicate");
      const storeLink = page.getByRole("link", { name: "전체 매장 매뉴얼", exact: true });
      const hqLink = page.getByRole("link", { name: "본사 매뉴얼 확인", exact: true });
      const storeTarget = new URL(await storeLink.getAttribute("href"), url);
      assert.equal(storeTarget.pathname, "/boss/store-manuals");
      assert.equal(storeTarget.searchParams.get("storeId"), "store");
      assert.equal(storeTarget.searchParams.get("questionId"), "question");
      assert.equal(storeTarget.searchParams.has("manualId"), false);
      assert.equal(await hqLink.getAttribute("href"), "/boss/manuals");
      for (const link of [storeLink, hqLink]) {
        await link.focus();
        assert.equal(await link.evaluate((element) => element === document.activeElement), true);
        assert.equal(await link.evaluate((element) => getComputedStyle(element).borderTopStyle), "solid");
        assert.ok((await link.boundingBox()).height >= 44);
      }
      await selector.selectOption(first.id);
      await page.locator("main").evaluate((element) => { element.scrollTop = 0; });
      await page.screenshot({ path: path.join(screenshots, `grouped-${viewport.width}.png`) });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      assert.ok((await page.evaluate(() => window.fixture.calls)).every((call) => call.method === "GET"));
    } finally { await page.close(); }
  }
});

test("loading, empty and failed manual requests are distinct; retry refreshes the list", async () => {
  const { page, errors } = await openFixture({ holdManuals: true });
  try {
    const selector = page.getByLabel("수정할 매장 매뉴얼을 선택하세요");
    assert.equal(await selector.isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "답변과 매뉴얼 다시 불러오기" }).isDisabled(), true);
    await page.getByText("답변과 매장 매뉴얼을 불러오는 중...").waitFor();
    await page.evaluate(() => { window.fixture.holdManuals = false; window.fixture.empty = true; window.fixture.releaseManuals(); });
    await page.getByText("수정할 매장 매뉴얼이 없습니다.", { exact: false }).waitFor();
    assert.equal(await selector.isDisabled(), true);
    await page.evaluate(() => { window.fixture.empty = false; window.fixture.manualsFailure = true; });
    await page.getByRole("button", { name: "답변과 매뉴얼 다시 불러오기" }).click();
    await page.getByRole("alert").filter({ hasText: "매장 매뉴얼 목록을 확인하지 못했습니다" }).waitFor();
    await page.evaluate(() => { window.fixture.manualsFailure = false; });
    await page.getByRole("button", { name: "답변과 매뉴얼 다시 불러오기" }).click();
    await page.getByText("아직 선택한 매뉴얼이 없습니다.").waitFor();
    assert.equal(await selector.isEnabled(), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("context failure stays visible outside disclosures and does not prevent manual editing", async () => {
  const { page } = await openFixture({ contextFailure: true });
  try {
    await page.getByRole("alert").filter({ hasText: "기존 답변과 근거를 확인하지 못했습니다" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "기존 챗봇 답변과 근거 후보" }).getAttribute("aria-expanded"), "false");
    await page.getByLabel("수정할 매장 매뉴얼을 선택하세요").selectOption("manual");
    await page.getByRole("link", { name: "매뉴얼 편집", exact: true }).waitFor();
  } finally { await page.close(); }
});

test("HQ evidence remains read-only without a candidate edit action", async () => {
  const { page } = await openFixture({ context: { ...context, source: { ...context.source, editable: false } } });
  try {
    await page.getByRole("button", { name: "기존 챗봇 답변과 근거 후보" }).click();
    await page.getByText("본사 공통 · 읽기 전용").waitFor();
    await page.getByText("본사 매뉴얼은 점주가 수정할 수 없습니다.", { exact: false }).waitFor();
    assert.equal(await page.getByRole("button", { name: "이 근거 매뉴얼 선택" }).count(), 0);
  } finally { await page.close(); }
});

test("completion stays manual, requires confirmation, and conflict errors remain visible", async () => {
  const { page } = await openFixture({ patchFailure: true }, { width: 390, height: 844 });
  try {
    await page.getByText("아직 선택한 매뉴얼이 없습니다.").waitFor();
    const complete = page.getByRole("button", { name: "처리 완료", exact: true });
    page.once("dialog", (dialog) => dialog.dismiss());
    await complete.click();
    assert.equal(await page.evaluate(() => window.fixture.calls.filter((call) => call.method === "PATCH").length), 0);
    page.once("dialog", (dialog) => dialog.accept());
    await complete.click();
    await page.getByRole("alert").waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(screenshots, "conflict-mobile.png") });
    await page.evaluate(() => { window.fixture.patchFailure = false; });
    page.once("dialog", (dialog) => dialog.accept());
    await complete.click();
    await page.getByText("처리를 완료했습니다.").waitFor();
    await page.getByRole("button", { name: "다시 처리하기" }).waitFor();
    const calls = await page.evaluate(() => window.fixture.calls.filter((call) => call.method === "PATCH"));
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[0].body).currentRevision, 1);
    assert.equal(JSON.parse(calls[0].body).nextStatus, "resolved");
  } finally { await page.close(); }
});

test("status update disables both actions and ignores duplicate clicks while pending", async () => {
  const { page } = await openFixture({ holdPatch: true });
  try {
    const complete = page.getByRole("button", { name: "처리 완료", exact: true });
    page.once("dialog", (dialog) => dialog.accept());
    await complete.click();
    const pending = page.getByRole("button", { name: "처리 중...", exact: true });
    await pending.waitFor();
    assert.equal(await pending.isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "처리 시작" }).isDisabled(), true);
    await pending.dispatchEvent("click");
    assert.equal(await page.evaluate(() => window.fixture.calls.filter((call) => call.method === "PATCH").length), 1);
    await page.evaluate(() => window.fixture.releasePatch());
    await page.getByText("처리를 완료했습니다.").waitFor();
  } finally { await page.close(); }
});

test("copy failure remains visible and help never claims saved or verified progress", async () => {
  const { page } = await openFixture({ copyFailure: true });
  try {
    await page.getByRole("button", { name: "질문 원문 복사" }).click();
    await page.getByText("복사하지 못했습니다. 질문 원문을 직접 선택해 주세요.").waitFor();
    const help = page.getByRole("button", { name: "처리 도움말", exact: true });
    await help.focus();
    await page.keyboard.press("Space");
    assert.equal(await help.getAttribute("aria-expanded"), "true");
    await page.getByText("본문 저장과 검색 반영은 별개입니다.", { exact: false }).waitFor();
    await page.getByText("매뉴얼 수정 없이 직원 안내나 개별 대응으로 처리할 수 있습니다.", { exact: false }).waitFor();
    await page.keyboard.press("Space");
    assert.equal(await help.getAttribute("aria-expanded"), "false");
    assert.equal(await page.getByRole("progressbar").count(), 0);
    assert.ok((await page.evaluate(() => window.fixture.calls)).every((call) => call.method === "GET"));
  } finally { await page.close(); }
});