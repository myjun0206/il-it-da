import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";

const origin = process.env.SIGNUP_TERMS_UI_TEST_URL ?? "http://localhost:3102";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));

for (const role of ["owner", "staff"]) {
  for (const theme of ["light", "dark"]) {
  test(`${role}/${theme}: required/optional consent, no draft banner, full-document keyboard modal and mobile-safe flow`, async () => {
    const browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : undefined });
    const context = await browser.newContext({ viewport: { width: role === "owner" ? 1280 : 320, height: 844 } });
    await context.addInitScript(({ role, theme }) => {
      sessionStorage.setItem("signupRole", role);
      localStorage.setItem("ilitda-theme", theme);
    }, { role, theme });
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 401, json: { ok: false } });
      return route.continue();
    });

    try {
      await page.goto(`${origin}/signup/terms`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction((expectedTheme) => document.documentElement.classList.contains(expectedTheme), theme);
      const serviceConsent = page.getByRole("button", { name: "필수 서비스 이용약관 동의" });
      const privacyConsent = page.getByRole("button", { name: "필수 개인정보 수집·이용 동의 동의" });
      const roleConsent = page.getByRole("button", { name: role === "owner" ? "필수 매장 소속 신청·운영 연동 동의 동의" : "필수 근무 매장 신청·업무정보 이용 동의 동의" });
      const next = page.getByRole("button", { name: "다음", exact: true });
      const optional = page.getByRole("button", { name: "선택 서비스 개선을 위한 선택 설문·인터뷰 참여 안내 수신 동의 동의", exact: true });
      const notice = page.locator('p[role="status"]').filter({ hasText: "운영 검토 초안" });
      assert.equal(await notice.count(), 0);
      assert.equal(await optional.getAttribute("aria-pressed"), "false");

      assert.equal(await serviceConsent.getAttribute("aria-pressed"), "false");
      assert.equal(await privacyConsent.getAttribute("aria-pressed"), "false");
      assert.equal(await roleConsent.getAttribute("aria-pressed"), "false");
      assert.equal(await next.isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "선택 서비스 및 혜택 정보 수신 동의 동의" }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "필수 개인정보 처리방침 동의" }).count(), 0);

      await serviceConsent.click();
      assert.equal(await serviceConsent.getAttribute("aria-pressed"), "true");
      const checkbox = serviceConsent.locator("span").first();
      const checkboxBackground = await checkbox.evaluate((element) => getComputedStyle(element).backgroundColor);
      assert.equal(checkboxBackground, theme === "dark" ? "rgb(45, 184, 143)" : "rgb(28, 107, 82)");
      const checkColor = await serviceConsent.locator("svg").evaluate((element) => getComputedStyle(element).color);
      assert.equal(checkColor, theme === "dark" ? "rgb(13, 17, 23)" : "rgb(255, 255, 255)");
      const badge = serviceConsent.getByText("필수", { exact: true });
      assert.equal(await badge.evaluate((element) => getComputedStyle(element).color), theme === "dark" ? "rgb(13, 17, 23)" : "rgb(255, 255, 255)");
      assert.equal(await next.isDisabled(), true);

      const privacyNoticeButton = page.getByRole("button", { name: "개인정보 처리방침 전문 보기" });
      await privacyNoticeButton.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("heading", { name: "개인정보 처리방침" }).waitFor();
      await dialog.getByText("OpenAI Chat Completions API", { exact: false }).waitFor();
      const close = dialog.getByRole("button", { name: "전문 닫기" });
      await close.focus();
      await page.keyboard.press("Shift+Tab");
      assert.equal(await dialog.getByRole("button").last().evaluate((element) => element === document.activeElement), true);
      await page.keyboard.press("Tab");
      assert.equal(await close.evaluate((element) => element === document.activeElement), true);
      const dialogSurface = await dialog.evaluate((element) => getComputedStyle(element.firstElementChild).backgroundColor);
      assert.equal(dialogSurface, theme === "dark" ? "rgb(26, 35, 48)" : "rgb(255, 255, 255)");
      const scrollable = dialog.locator(".overflow-y-auto");
      assert.equal(await scrollable.evaluate((element) => element.scrollHeight > element.clientHeight), true);
      await page.keyboard.press("Escape");
      assert.equal(await dialog.count(), 0);
      assert.equal(await privacyNoticeButton.evaluate((element) => element === document.activeElement), true);

      const all = page.getByRole("button", { name: "전체 선택", exact: true });
      const requiredOnly = page.getByRole("button", { name: "필수만 선택", exact: true });
      await all.focus();
      await page.keyboard.press("Space");
      for (const consent of [serviceConsent, privacyConsent, roleConsent, optional]) {
        assert.equal(await consent.getAttribute("aria-pressed"), "true");
      }
      assert.equal(await next.isDisabled(), false);
      await all.click();
      assert.equal(await all.getAttribute("aria-pressed"), "true");
      await requiredOnly.focus();
      await page.keyboard.press("Enter");
      assert.equal(await optional.getAttribute("aria-pressed"), "false");
      assert.equal(await requiredOnly.getAttribute("aria-pressed"), "true");
      assert.equal(await next.isDisabled(), false);
      await serviceConsent.click();
      assert.equal(await next.isDisabled(), true);
      await serviceConsent.click();
      assert.equal(await next.isDisabled(), false);
      assert.equal(await optional.getAttribute("aria-pressed"), "false");
      const optionalDocument = page.getByRole("button", { name: "서비스 개선을 위한 선택 설문·인터뷰 참여 안내 수신 동의 전문 보기" });
      await optionalDocument.click();
      await page.getByRole("dialog").getByText("설문·인터뷰 안내 발송은 아직 구현되지 않았으며", { exact: false }).waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `.next/signup-terms-${role}-${theme}.png`, fullPage: true });

      await next.click();
      await page.waitForURL("**/signup/profile");
      const savedTerms = await page.evaluate(() => JSON.parse(sessionStorage.getItem("signupTerms")));
      assert.equal(savedTerms.service, true);
      assert.equal(savedTerms.privacy, true);
      assert.equal(savedTerms[role === "owner" ? "store_connection" : "store_work"], true);
      assert.equal(Object.hasOwn(savedTerms, "marketing"), false);
      assert.equal(Object.hasOwn(savedTerms, "privacy_policy"), false);
      assert.equal(Object.hasOwn(savedTerms, "research"), false);
      assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem("signupResearchConsent"))), { accepted: false });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    } finally {
      await browser.close();
    }
  });
  }
}

test("HQ terms still require only service and collection consent", async () => {
  const browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : undefined });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => sessionStorage.setItem("signupRole", "hq"));
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/signup/terms`, { waitUntil: "domcontentloaded" });
    assert.equal(await page.getByRole("button", { name: "필수 매장 소속 신청·운영 연동 동의 동의" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "필수 근무 매장 신청·업무정보 이용 동의 동의" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "다음", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "필수만 선택", exact: true }).click();
    await page.getByRole("button", { name: "다음", exact: true }).click();
    await page.waitForURL("**/signup/profile");
    const terms = await page.evaluate(() => JSON.parse(sessionStorage.getItem("signupTerms")));
    assert.deepEqual(terms, { service: true, privacy: true, store_connection: false, store_work: false });
  } finally {
    await browser.close();
  }
});
