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
    let resendAttempt = 0;
    let completeFailure = true;
    let profileName = "";
    let profilePhone = "";
    let complete = false;
    const page = await context.newPage();
    await page.clock.install();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith("/api/")) {
        if (url.pathname.endsWith("/status")) return route.fulfill({ status: verified ? 200 : 401, json: verified
          ? { ok: true, role, email: "person@example.org", name: profileName, phone: profilePhone, profileComplete: complete } : { ok: false } });
        if (url.pathname.includes("/owner-staff/")) {
          const body = route.request().postDataJSON();
          calls.push({ action: url.pathname.split("/").at(-1), body });
          if (url.pathname.endsWith("/resend")) {
            resendAttempt++;
            if (resendAttempt === 1) return route.fulfill({ status: 429, json: { ok: false, code: "RATE_LIMITED", error: "인증번호 요청이 제한되었습니다.", retryAfterSeconds: 37 } });
            if (resendAttempt === 2) return route.fulfill({ status: 503, json: { ok: false, code: "EMAIL_SEND_FAILED", error: "인증 메일을 다시 보내지 못했습니다." } });
          }
          if (url.pathname.endsWith("/start") && sendFailure) {
            sendFailure = false;
            return route.fulfill({ status: 409, json: { ok: false, code: "EMAIL_EXISTS", error: "이미 가입된 이메일입니다. 로그인해주세요." } });
          }
          if (url.pathname.endsWith("/verify")) {
            if (invalidCode) { invalidCode = false; return route.fulfill({ status: 400, json: { ok: false, code: "CODE_INVALID", error: "인증번호가 올바르지 않습니다. 다시 확인해주세요." } }); }
            verified = true;
          }
          if (url.pathname.endsWith("/complete")) {
            if (completeFailure) {
              completeFailure = false;
              return route.fulfill({ status: 503, json: { ok: false, code: "SIGNUP_FAILED", error: "가입 정보를 저장하지 못했습니다." } });
            }
            profileName = body.name;
            profilePhone = body.phone;
            complete = true;
          }
          const now = await page.evaluate(() => Date.now());
          return route.fulfill({ json: { ok: true, cooldownSeconds: 60, expiresAt: now + 180000, profileComplete: complete } });
        }
        return route.fulfill({ json: { success: true, data: [], brands: [], stores: [] } });
      }
      return route.continue();
    });
    try {
      await page.goto(`${origin}/signup/profile`, { waitUntil: "domcontentloaded" });
      await page.getByPlaceholder("example@email.com").waitFor();
      await page.getByRole("button", { name: "인증번호 받기", exact: true }).click();
      assert.equal(calls.length, 0);
      assert.ok(await page.getByText("올바른 이메일 주소를 입력해주세요.", { exact: true }).isVisible());
      assert.equal(await page.evaluate(() => sessionStorage.getItem("signupPassword")), null);
      await page.getByPlaceholder("example@email.com").fill(`${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`);
      await page.getByRole("button", { name: "인증번호 받기", exact: true }).click();
      await page.getByText("올바른 이메일 주소를 입력해주세요.", { exact: true }).waitFor();
      assert.equal(calls.length, 0);
      await page.getByPlaceholder("example@email.com").fill("person@example.org");
      assert.ok(await page.getByPlaceholder("예: 홍길동").isDisabled());
      assert.ok(await page.getByPlaceholder("8글자 이상 입력해주세요").isDisabled());
      assert.equal(await page.getByRole("button", { name: "이전에 시작한 가입 이어가기" }).count(), 0);
      await page.getByRole("button", { name: "인증번호 받기", exact: true }).click();
      await page.getByText("이미 가입된 이메일입니다. 로그인해주세요.", { exact: true }).waitFor();
      assert.equal(await page.getByPlaceholder("example@email.com").inputValue(), "person@example.org");
      await page.getByRole("button", { name: "인증번호 받기", exact: true }).click();
      await page.getByPlaceholder("인증번호 6자리 입력").waitFor();
      assert.equal(await page.getByText("이미 가입된 이메일입니다. 로그인해주세요.", { exact: true }).count(), 0);
      assert.equal(calls.filter((call) => call.action === "start").length, 2);
      assert.ok(calls.filter((call) => call.action === "start").every((call) => Object.keys(call.body).sort().join(",") === "email,role"));
      await page.getByRole("timer").filter({ hasText: "03:00" }).waitFor();
      assert.ok(await page.getByRole("button", { name: /초 후 재발송/ }).isDisabled());
      assert.equal(await page.evaluate(() => JSON.stringify([...Object.entries(sessionStorage)]).includes(" 123456 ")), false);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByPlaceholder("인증번호 6자리 입력").waitFor();
      assert.equal(await page.getByRole("button", { name: "다음", exact: true }).isDisabled(), true);
      const savedExpiry = await page.evaluate(() => JSON.parse(sessionStorage.getItem("signupOtpDraft")).expiresAt);
      await page.clock.fastForward(181000);
      await page.getByText("인증 시간이 만료되었습니다. 새 인증번호를 받아주세요.").waitFor();
      assert.ok(await page.getByRole("button", { name: "인증 확인" }).isDisabled());
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("timer").filter({ hasText: "00:00" }).waitFor();
      assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("signupOtpDraft")).expiresAt), savedExpiry);
      await page.getByText("인증 시간이 만료되었습니다. 새 인증번호를 받아주세요.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "인증번호 다시 받기", exact: true }).click();
      await page.getByText("인증번호 요청이 제한되었습니다.", { exact: true }).waitFor();
      assert.ok(await page.getByRole("button", { name: "37초 후 재발송", exact: true }).isDisabled());
      await page.getByRole("timer").filter({ hasText: "00:00" }).waitFor();
      await page.clock.fastForward(37000);
      await page.getByRole("button", { name: "인증번호 다시 받기", exact: true }).click();
      await page.getByText("인증 메일을 다시 보내지 못했습니다.", { exact: true }).waitFor();
      await page.getByRole("timer").filter({ hasText: "00:00" }).waitFor();
      assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("signupOtpDraft")).expiresAt), savedExpiry);
      assert.equal(await page.getByText("인증번호를 다시 보냈습니다. 가장 최근에 받은 인증번호를 입력해주세요.", { exact: true }).count(), 0);
      await page.getByRole("button", { name: "인증번호 다시 받기", exact: true }).click();
      await page.getByRole("timer").filter({ hasText: "03:00" }).waitFor();
      assert.equal(calls.at(-1).action, "resend");
      assert.equal(await page.getByPlaceholder("인증번호 6자리 입력").inputValue(), "");
      assert.equal(await page.getByText("인증번호를 다시 보냈습니다. 가장 최근에 받은 인증번호를 입력해주세요.", { exact: true }).count(), 1);
      await page.getByPlaceholder("example@email.com").fill("changed@example.org");
      assert.equal(await page.getByPlaceholder("인증번호 6자리 입력").count(), 0);
      assert.equal(await page.evaluate(() => sessionStorage.getItem("signupOtpDraft")), null);
      await page.getByPlaceholder("example@email.com").fill("person@example.org");
      await page.getByRole("button", { name: "인증번호 받기", exact: true }).click();
      await page.getByPlaceholder("인증번호 6자리 입력").waitFor();
      assert.equal(calls.at(-1).action, "start");
      assert.equal("password" in calls.at(-1).body, false);
      await page.getByPlaceholder("인증번호 6자리 입력").fill("01234");
      assert.ok(await page.getByRole("button", { name: "인증 확인" }).isDisabled());
      await page.getByPlaceholder("인증번호 6자리 입력").fill("012345");
      await page.getByRole("button", { name: "인증 확인" }).click();
      await page.getByText("인증번호가 올바르지 않습니다. 다시 확인해주세요.", { exact: true }).waitFor();
      assert.equal(await page.getByPlaceholder("인증번호 6자리 입력").inputValue(), "012345");
      await page.getByRole("button", { name: "인증 확인" }).click();
      await page.getByText("이메일 인증이 완료되었습니다.", { exact: true }).waitFor();
      assert.ok(calls.filter((call) => call.action === "verify").every((call) => call.body.token === "012345"));
      await page.getByPlaceholder("example@email.com").fill("changed-after-verification@example.org");
      assert.ok(await page.getByRole("button", { name: "다음", exact: true }).isDisabled());
      assert.equal(await page.getByPlaceholder("인증번호 6자리 입력").count(), 0);
      assert.equal(await page.evaluate(() => sessionStorage.getItem("signupOtpDraft")), null);
      verified = false;
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByPlaceholder("example@email.com").fill("person@example.org");
      await page.getByRole("button", { name: "인증번호 받기", exact: true }).click();
      await page.getByPlaceholder("인증번호 6자리 입력").fill("012345");
      await page.getByRole("button", { name: "인증 확인" }).click();
      await page.getByText("이메일 인증이 완료되었습니다.", { exact: true }).waitFor();
      await page.clock.fastForward(181000);
      assert.equal(await page.getByRole("button", { name: "다음", exact: true }).isDisabled(), false);
      assert.equal(await page.getByRole("timer").count(), 0);
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page.getByText("올바른 이름을 입력해 주세요.", { exact: true }).waitFor();
      await page.getByText("올바른 연락처 형식이 아닙니다.", { exact: true }).waitFor();
      assert.equal(calls.filter((call) => call.action === "complete").length, 0);
      const nameInput = page.getByPlaceholder("예: 홍길동");
      await nameInput.fill("ㄱㄴ");
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page.getByText("올바른 이름을 입력해 주세요.", { exact: true }).waitFor();
      await nameInput.fill("  Jose\u0301 Cruz  ");
      await nameInput.blur();
      assert.equal(await nameInput.inputValue(), "José Cruz");
      await nameInput.fill("Kim Min-su");
      await page.getByRole("button", { name: "다음", exact: true }).click();
      assert.equal(await page.getByText("올바른 이름을 입력해 주세요.", { exact: true }).count(), 0);
      await page.getByPlaceholder("010-0000-0000").fill("01012345678");
      await page.getByPlaceholder("8글자 이상 입력해주세요").fill("password-fixture");
      await page.getByPlaceholder("비밀번호를 다시 입력해주세요").fill("wrong-fixture");
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page.getByText("비밀번호가 일치하지 않습니다.", { exact: true }).waitFor();
      assert.equal(calls.filter((call) => call.action === "complete").length, 0);
      await page.getByPlaceholder("비밀번호를 다시 입력해주세요").fill("password-fixture");
      assert.equal(await page.getByPlaceholder("example@email.com").inputValue(), "person@example.org");
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page.getByText("가입 정보를 저장하지 못했습니다.", { exact: true }).waitFor();
      assert.equal(await page.getByPlaceholder("예: 홍길동").inputValue(), "Kim Min-su");
      assert.equal(await page.getByPlaceholder("010-0000-0000").inputValue(), "01012345678");
      assert.equal(await page.getByPlaceholder("8글자 이상 입력해주세요").inputValue(), "password-fixture");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      await page.screenshot({ path: `.next/signup-otp-${role}.png`, fullPage: true });
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page.waitForURL("**/signup/stores");
      assert.equal(await page.evaluate(() => sessionStorage.getItem("signupPassword")), null);
      const completion = calls.find((call) => call.action === "complete");
      assert.equal(completion.body.password, "password-fixture");
      assert.equal(completion.body.passwordConfirm, "password-fixture");
      assert.equal(completion.body.terms.service, true);
      const saved = await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)));
      assert.equal(saved.includes("password-fixture"), false);
      assert.equal(saved.includes('"012345"'), false);
      for (const field of ["token", "verificationCode", "password", "passwordConfirm"]) {
        for (const [, value] of JSON.parse(saved)) {
          let draft;
          try { draft = JSON.parse(value); } catch { continue; }
          if (draft && typeof draft === "object") assert.equal(Object.hasOwn(draft, field), false);
        }
      }
    } finally {
      await browser.close();
    }
  });
}