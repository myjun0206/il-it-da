import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";

const origin = process.env.LOGIN_UI_TEST_URL ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const screenshots = await mkdtemp(path.join(tmpdir(), "ilitda-login-social-ui-"));

for (const width of [320, 390, 1280]) {
  for (const theme of ["light", "dark"]) {
    test(`login/signup ${width}px ${theme}: hidden providers, aligned retained buttons and unchanged starts`, async () => {
      const browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : undefined });
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(({ origin, theme }) => {
        if (window.location.origin === origin) localStorage.setItem("ilitda-theme", theme);
      }, { origin, theme });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const requestedProviders = [];
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.name));
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === "/api/auth/oauth") {
          const body = route.request().postDataJSON();
          requestedProviders.push(body.provider);
          assert.equal(body.rememberMe, false);
          return route.fulfill({ status: 503, json: { code: "OAUTH_START_FAILED" } });
        }
        if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 401, json: { error: "Synthetic unauthenticated response" } });
        return route.continue();
      });

      try {
        const response = await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
        assert.equal(response.status(), 200);
        await page.waitForFunction((value) => document.documentElement.classList.contains(value), theme);
        const google = page.getByRole("link", { name: "Google로 로그인", exact: true });
        const apple = page.getByRole("link", { name: "Apple로 로그인", exact: true });
        await google.waitFor();
        await apple.waitFor();
        assert.equal(await page.locator('[aria-label="네이버로 로그인"], [aria-label="카카오로 로그인"]').count(), 0);
        assert.equal(await page.locator("a.oauth-button:visible").count(), 2);
        assert.ok(await google.locator("svg path").count() > 0);
        assert.equal(await apple.locator("svg path").count(), 1);
        assert.equal(await page.getByRole("button", { name: "로그인", exact: true }).isVisible(), true);
        assert.equal(await page.locator('input[type="email"]:visible').count(), 1);
        assert.equal(await page.locator('input[type="password"]:visible').count(), 1);
        const googleBox = await google.boundingBox();
        const appleBox = await apple.boundingBox();
        assert.ok(googleBox && appleBox);
        assert.ok(Math.abs(googleBox.y - appleBox.y) < 1);
        assert.ok(Math.abs(googleBox.width - appleBox.width) < 1);
        assert.ok(googleBox.width >= 44 && googleBox.height >= 44);
        const gap = appleBox.x - googleBox.x - googleBox.width;
        const row = await google.locator("..").evaluate((element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x, width: box.width, gap: parseFloat(getComputedStyle(element).columnGap) };
        });
        assert.ok(Math.abs(gap - row.gap) < 1);
        assert.ok(Math.abs((googleBox.x + appleBox.x + appleBox.width) / 2 - (row.x + row.width / 2)) < 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        const screenshot = path.join(screenshots, `${width}-${theme}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        console.log(`SCREENSHOT ${screenshot}`);
        await google.click();
        await page.locator("p:visible").filter({ hasText: "OAUTH_START_FAILED" }).first().waitFor();
        const appleResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/oauth");
        await apple.click();
        await appleResponse;
        assert.deepEqual(requestedProviders, ["google", "apple"]);
        const signup = page.getByRole("link", { name: "회원가입", exact: true });
        assert.equal(await signup.getAttribute("href"), "/signup/start");
        await signup.click();
        await page.waitForURL(`${origin}/signup/role`);
        assert.equal(await page.locator('[aria-label="네이버로 로그인"], [aria-label="카카오로 로그인"]').count(), 0);
        assert.deepEqual(pageErrors, []);
      } finally {
        await browser.close();
      }
    });
  }
}