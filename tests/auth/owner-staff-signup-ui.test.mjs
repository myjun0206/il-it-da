import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";

const origin = process.env.SIGNUP_UI_TEST_URL ?? "http://localhost:3100";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));

for (const role of ["owner", "staff"]) {
  test(`${role}: mocked signup validation, errors, resume, email change and verified navigation`, async () => {
    const browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : undefined });
    const context = await browser.newContext({ viewport: { width: role === "owner" ? 1280 : 390, height: 900 } });
    await context.addInitScript(({ role }) => {
      sessionStorage.setItem("signupRole", role);
      sessionStorage.setItem("signupTerms", JSON.stringify({ service: true, privacy: true, store_connection: true, store_work: true }));
      if (!sessionStorage.getItem("uiTestInitialized")) {
        sessionStorage.setItem("signupPassword", "obsolete");
        sessionStorage.setItem("uiTestInitialized", "true");
      }
    }, { role });
    const calls = [];
    let verified = false;
    let invalidCode = true;
    let sendFailure = true;
    let profileName = "김가입";
    let profilePhone = "01012345678";
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith("/api/")) {
        if (url.pathname.endsWith("/status")) return route.fulfill({ status: verified ? 200 : 401, json: verified
          ? { ok: true, role, email: "person@example.org", name: profileName, phone: profilePhone } : { ok: false } });
        if (url.pathname.includes("/owner-staff/")) {
          const body = route.request().postDataJSON();
          calls.push({ action: url.pathname.split("/").at(-1), body });
          if (url.pathname.endsWith("/start") && sendFailure) {
            sendFailure = false;
            return route.fulfill({ status: 503, json: { ok: false, code: "EMAIL_SEND_FAILED", error: "인증 메일을 보내지 못했습니다." } });
          }
          if (url.pathname.endsWith("/verify")) {
            if (invalidCode) { invalidCode = false; return route.fulfill({ status: 400, json: { ok: false, error: "인증번호가 올바르지 않거나 만료되었습니다." } }); }
            verified = true;
          }
          return route.fulfill({ json: { ok: true, cooldownSeconds: 60 } });
        }
        return route.fulfill({ json: { success: true, data: [], brands: [], stores: [] } });
      }
      return route.continue();
    });
    try {
      await page.goto(`${origin}/signup/profile`, { waitUntil: "domcontentloaded" });
      await page.getByPlaceholder("example@email.com").waitFor();
      await page.getByRole("button", { name: "가입하고 인증번호 받기" }).click();
      assert.equal(calls.length, 0);
      assert.ok(await page.getByText("이름은 2글자 이상이어야 합니다.", { exact: true }).isVisible());
      assert.equal(await page.evaluate(() => sessionStorage.getItem("signupPassword")), null);
      await page.getByPlaceholder("example@email.com").fill(`${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`);
      await page.getByRole("button", { name: "이전에 시작한 가입 이어가기" }).click();
      await page.getByText("올바른 이메일 주소를 입력해주세요.", { exact: true }).waitFor();
      assert.equal(calls.length, 0);
      await page.getByPlaceholder("example@email.com").fill("person@example.org");
      await page.getByPlaceholder("예: 홍길동").fill("김가입");
      await page.getByPlaceholder("010-0000-0000").fill("01012345678");
      await page.getByPlaceholder("8글자 이상 입력해주세요").fill(" 123456 ");
      await page.getByPlaceholder("비밀번호를 다시 입력해주세요").fill(" 123456 ");
      await page.getByRole("button", { name: "가입하고 인증번호 받기" }).click();
      await page.getByText("인증 메일을 보내지 못했습니다.", { exact: true }).waitFor();
      assert.equal(await page.getByPlaceholder("예: 홍길동").inputValue(), "김가입");
      await page.getByRole("button", { name: "가입하고 인증번호 받기" }).click();
      await page.getByPlaceholder("인증번호 6자리 입력").waitFor();
      assert.equal(calls.filter((call) => call.action === "start").length, 2);
      assert.ok(calls.filter((call) => call.action === "start").every((call) => call.body.password === " 123456 " && call.body.passwordConfirm === " 123456 " && call.body.terms.service));
      assert.equal(await page.getByPlaceholder("8글자 이상 입력해주세요").count(), 0);
      assert.ok(await page.getByRole("button", { name: /초 후 재발송/ }).isDisabled());
      assert.equal(await page.evaluate(() => JSON.stringify([...Object.entries(sessionStorage)]).includes(" 123456 ")), false);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByPlaceholder("인증번호 6자리 입력").waitFor();
      assert.equal(await page.getByRole("button", { name: "다음", exact: true }).isDisabled(), true);
      await page.getByPlaceholder("example@email.com").fill("changed@example.org");
      assert.equal(await page.getByPlaceholder("인증번호 6자리 입력").count(), 0);
      assert.equal(await page.evaluate(() => sessionStorage.getItem("signupOtpDraft")), null);
      await page.getByPlaceholder("example@email.com").fill("person@example.org");
      await page.getByRole("button", { name: "이전에 시작한 가입 이어가기" }).click();
      await page.getByPlaceholder("인증번호 6자리 입력").waitFor();
      assert.equal(calls.at(-1).action, "resend");
      assert.equal("password" in calls.at(-1).body, false);
      await page.getByPlaceholder("인증번호 6자리 입력").fill("01234");
      assert.ok(await page.getByRole("button", { name: "인증 확인" }).isDisabled());
      await page.getByPlaceholder("인증번호 6자리 입력").fill("012345");
      await page.getByRole("button", { name: "인증 확인" }).click();
      await page.getByText("인증번호가 올바르지 않거나 만료되었습니다.", { exact: true }).waitFor();
      assert.equal(await page.getByPlaceholder("인증번호 6자리 입력").inputValue(), "012345");
      await page.getByRole("button", { name: "인증 확인" }).click();
      await page.getByText("이메일 인증이 완료되었습니다.", { exact: true }).waitFor();
      assert.ok(calls.filter((call) => call.action === "verify").every((call) => call.body.token === "012345"));
      await page.getByPlaceholder("example@email.com").fill("changed-after-verification@example.org");
      assert.ok(await page.getByRole("button", { name: "다음", exact: true }).isDisabled());
      assert.equal(await page.getByPlaceholder("인증번호 6자리 입력").count(), 0);
      assert.equal(await page.evaluate(() => sessionStorage.getItem("signupOtpDraft")), null);
      profileName = " ";
      profilePhone = "123456789";
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText("이메일 인증이 완료되었습니다.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page.getByText("이름은 2글자 이상이어야 합니다.", { exact: true }).waitFor();
      await page.getByText("올바른 연락처 형식이 아닙니다.", { exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/signup/profile");
      assert.equal(calls.filter((call) => call.action === "verify").length, 2);
      profileName = "김가입";
      profilePhone = "01012345678";
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText("이메일 인증이 완료되었습니다.", { exact: true }).waitFor();
      assert.equal(await page.getByPlaceholder("example@email.com").inputValue(), "person@example.org");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      await page.screenshot({ path: `.next/signup-otp-${role}.png`, fullPage: true });
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page.waitForURL("**/signup/stores");
      assert.equal(await page.evaluate(() => sessionStorage.getItem("signupPassword")), null);
    } finally {
      await browser.close();
    }
  });
}