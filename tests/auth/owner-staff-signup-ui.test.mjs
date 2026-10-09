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
            if (invalidCode) { invalidCode = false; return route.fulfill({ status: 400, json: { ok: false, code: "CODE_INVALID", error: "인증번호가 틀립니다. 다시 확인해 주세요." } }); }
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
      assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("signupOtpDraft")).sent), false);
      assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("signupOtpDraft")).expiresAt), 0);
      await page.getByPlaceholder("example@email.com").fill("person@example.org");
      await page.getByRole("button", { name: "인증번호 받기", exact: true }).click();
      await page.getByPlaceholder("인증번호 6자리 입력").waitFor();
      assert.equal(calls.at(-1).action, "start");
      assert.equal("password" in calls.at(-1).body, false);
      await page.getByPlaceholder("인증번호 6자리 입력").fill("01234");
      assert.ok(await page.getByRole("button", { name: "인증 확인" }).isDisabled());
      await page.getByPlaceholder("인증번호 6자리 입력").fill("012345");
      await page.getByRole("button", { name: "인증 확인" }).click();
      await page.getByText("인증번호가 틀립니다. 다시 확인해 주세요.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("timer").count(), 1);
      assert.equal(await page.getByPlaceholder("예: 홍길동").isDisabled(), true);
      assert.equal(await page.getByPlaceholder("인증번호 6자리 입력").inputValue(), "012345");
      await page.getByRole("button", { name: "인증 확인" }).click();
      await page.getByText("이메일 인증이 완료되었습니다.", { exact: true }).waitFor();
      assert.ok(calls.filter((call) => call.action === "verify").every((call) => call.body.token === "012345"));
      await page.getByPlaceholder("example@email.com").fill("changed-after-verification@example.org");
      assert.ok(await page.getByRole("button", { name: "다음", exact: true }).isDisabled());
      assert.equal(await page.getByPlaceholder("인증번호 6자리 입력").count(), 0);
      assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("signupOtpDraft")).sent), false);
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
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByPlaceholder("예: 홍길동").waitFor();
      assert.equal(await page.getByPlaceholder("예: 홍길동").inputValue(), "Kim Min-su");
      assert.equal(await page.getByPlaceholder("010-0000-0000").inputValue(), "01012345678");
      assert.equal(await page.getByPlaceholder("8글자 이상 입력해주세요").inputValue(), "");
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
      assert.equal(completion.body.researchConsent, false);
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

for (const role of ["owner", "staff"]) {
  test(`${role}: new windows reauthenticate abandoned signup and completed signup offers login continuation`, async () => {
    const browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : undefined });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript((role) => {
      sessionStorage.setItem("signupRole", role);
      sessionStorage.setItem("signupTerms", JSON.stringify({ service: true, privacy: true, store_connection: true, store_work: true }));
    }, role);
    let verified = false;
    let completed = false;
    let requests = 0;
    let releaseFirstStart;
    const calls = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (url.pathname.endsWith("/status")) return route.fulfill({ status: verified ? 200 : 401, json: verified
        ? { ok: true, role, email: "resume@example.org", name: completed ? "Kim Min-su" : "", phone: completed ? "01012345678" : "", profileComplete: completed,
          ...(completed ? { terms: { service: true, privacy: true, store_connection: true, store_work: true } } : {}) }
        : { ok: false } });
      if (url.pathname.endsWith("/start")) {
        requests++;
        if (requests === 1) await new Promise((resolve) => { releaseFirstStart = resolve; });
        if (completed) return route.fulfill({ status: 409, json: { ok: false, code: "SIGNUP_INCOMPLETE", error: "로그인 후 매장 신청을 이어가 주세요.", nextStep: "login" } });
        verified = false;
        calls.push("start");
        return route.fulfill({ json: { ok: true, resumed: requests > 1, expiresAt: Date.now() + 180000, cooldownSeconds: 60 } });
      }
      if (url.pathname.endsWith("/verify")) { verified = true; calls.push("verify"); return route.fulfill({ json: { ok: true, role } }); }
      return route.fulfill({ json: { success: true, data: [], brands: [], stores: [] } });
    });
    const open = async () => { const page = await context.newPage(); await page.goto(`${origin}/signup/profile`); await page.getByPlaceholder("example@email.com").waitFor(); return page; };
    try {
      let page = await open();
      await page.getByPlaceholder("example@email.com").fill("resume@example.org");
      const pendingStart = page.waitForRequest("**/api/auth/signup/owner-staff/start");
      await page.getByRole("button", { name: "인증번호 받기", exact: true }).click();
      await pendingStart;
      await page.getByRole("button", { name: "발송 중...", exact: true }).dispatchEvent("click");
      assert.equal(requests, 1);
      releaseFirstStart();
      await page.getByPlaceholder("인증번호 6자리 입력").waitFor();
      await page.close();
      page = await open();
      await page.getByPlaceholder("example@email.com").fill("resume@example.org");
      await page.getByRole("button", { name: "인증번호 받기", exact: true }).click();
      await page.getByPlaceholder("인증번호 6자리 입력").fill("012345");
      await page.getByRole("button", { name: "인증 확인", exact: true }).click();
      await page.getByText("이메일 인증이 완료되었습니다.", { exact: true }).waitFor();
      await page.close();
      page = await open();
      assert.equal(await page.getByPlaceholder("예: 홍길동").isDisabled(), true);
      await page.getByPlaceholder("example@email.com").fill("resume@example.org");
      await page.getByRole("button", { name: "인증번호 받기", exact: true }).click();
      await page.getByPlaceholder("인증번호 6자리 입력").fill("012345");
      await page.getByRole("button", { name: "인증 확인", exact: true }).click();
      await page.getByPlaceholder("예: 홍길동").fill("Kim Min-su");
      await page.getByPlaceholder("010-0000-0000").fill("01012345678");
      await page.getByPlaceholder("8글자 이상 입력해주세요").fill("synthetic-password");
      await page.reload();
      await page.getByPlaceholder("예: 홍길동").waitFor();
      assert.equal(await page.getByPlaceholder("예: 홍길동").inputValue(), "Kim Min-su");
      assert.equal(await page.getByPlaceholder("8글자 이상 입력해주세요").inputValue(), "");
      assert.equal(await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)).includes("synthetic-password")), false);
      completed = true;
      await page.close();
      page = await open();
      await page.getByPlaceholder("예: 홍길동").waitFor();
      assert.equal(await page.getByPlaceholder("예: 홍길동").isDisabled(), true);
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await page.waitForURL("**/signup/stores");
      verified = false;
      await page.close();
      page = await open();
      await page.getByPlaceholder("example@email.com").fill("resume@example.org");
      await page.getByRole("button", { name: "인증번호 받기", exact: true }).click();
      await page.getByRole("button", { name: "로그인하여 매장 신청 이어가기" }).click();
      await page.waitForURL(origin + "/");
      assert.deepEqual(calls, ["start", "start", "verify", "start", "verify"]);
    } finally { await browser.close(); }
  });
}

for (const role of ["owner", "staff"]) {
  test(`${role}: OTP error placement and resend failures preserve code/deadline until valid success`, async () => {
    const browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : undefined });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript((role) => {
      sessionStorage.setItem("signupRole", role);
      sessionStorage.setItem("signupTerms", JSON.stringify({ service: true, privacy: true, store_connection: true, store_work: true }));
      sessionStorage.setItem("signupOtpDraft", JSON.stringify({ role, email: "otp-check@example.org", name: "Kim Min-su", phone: "01012345678", sent: false }));
    }, role);
    const page = await context.newPage();
    await page.clock.install();
    let verifyMode = "invalid";
    let resendCalls = 0;
    let releaseResend;
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (url.pathname.endsWith("/status")) return route.fulfill({ status: 401, json: { ok: false } });
      if (url.pathname.endsWith("/verify")) {
        if (verifyMode === "non-json") return route.fulfill({ status: 502, body: "Unavailable", contentType: "text/plain" });
        return route.fulfill({ status: verifyMode === "rate" ? 429 : verifyMode === "outage" ? 503 : 400, json: {
          ok: false, code: verifyMode === "rate" ? "RATE_LIMITED" : verifyMode === "outage" ? "AUTH_UNAVAILABLE" : "CODE_INVALID",
          error: verifyMode === "rate" ? "요청이 제한되었습니다." : verifyMode === "outage" ? "인증 서비스에 연결할 수 없습니다." : "인증번호가 틀립니다. 다시 확인해 주세요.", retryAfterSeconds: 37,
        } });
      }
      if (url.pathname.endsWith("/resend")) {
        resendCalls++;
        if (resendCalls === 1) {
          await new Promise((resolve) => { releaseResend = resolve; });
          return route.fulfill({ status: 429, json: { ok: false, code: "RATE_LIMITED", error: "재발송 요청이 제한되었습니다.", retryAfterSeconds: 37 } });
        }
        if (resendCalls === 2) return route.fulfill({ status: 503, json: { ok: false, code: "EMAIL_SEND_FAILED", error: "인증 메일을 보내지 못했습니다." } });
        if (resendCalls === 3) return route.abort("failed");
        if (resendCalls === 4) return route.fulfill({ json: { ok: true, expiresAt: 1 } });
      }
      const now = await page.evaluate(() => Date.now());
      return route.fulfill({ json: { ok: true, expiresAt: now + 180000, cooldownSeconds: 60 } });
    });
    try {
      await page.goto(`${origin}/signup/profile`);
      await page.getByRole("button", { name: "인증번호 받기", exact: true }).click();
      const token = page.getByPlaceholder("인증번호 6자리 입력");
      await token.fill("999999");
      const deadline = await page.evaluate(() => JSON.parse(sessionStorage.getItem("signupOtpDraft")).expiresAt);
      for (const mode of ["invalid", "rate", "outage", "non-json"]) {
        verifyMode = mode;
        await page.getByRole("button", { name: "인증 확인", exact: true }).click();
        const message = mode === "invalid" ? "인증번호가 틀립니다. 다시 확인해 주세요." : mode === "rate" ? "요청이 제한되었습니다." : mode === "outage" ? "인증 서비스에 연결할 수 없습니다." : "인증 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.";
        const error = page.getByText(message, { exact: true });
        await error.waitFor();
        assert.ok((await error.boundingBox()).y >= (await token.boundingBox()).y + (await token.boundingBox()).height);
        assert.equal(await token.inputValue(), "999999");
        assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("signupOtpDraft")).expiresAt), deadline);
        assert.equal(await page.getByPlaceholder("예: 홍길동").inputValue(), "Kim Min-su");
        assert.equal(await page.getByPlaceholder("예: 홍길동").isDisabled(), true);
      }
      await page.clock.fastForward(61000);
      const pending = page.waitForRequest("**/api/auth/signup/owner-staff/resend");
      await page.getByRole("button", { name: "인증번호 재발송", exact: true }).click();
      await pending;
      await page.getByRole("button", { name: "발송 중...", exact: true }).dispatchEvent("click");
      assert.equal(resendCalls, 1);
      releaseResend();
      await page.getByText("재발송 요청이 제한되었습니다.", { exact: true }).waitFor();
      await page.clock.fastForward(37000);
      for (const message of ["인증 메일을 보내지 못했습니다.", "인증번호 재발송 중 오류가 발생했습니다."]) {
        await page.getByRole("button", { name: "인증번호 재발송", exact: true }).click();
        await page.getByText(message, { exact: true }).waitFor();
        assert.equal(await token.inputValue(), "999999");
        assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("signupOtpDraft")).expiresAt), deadline);
      }
      await page.getByRole("button", { name: "인증번호 재발송", exact: true }).click();
      await page.getByText("인증번호 재발송 중 오류가 발생했습니다.", { exact: true }).waitFor();
      assert.equal(await token.inputValue(), "999999");
      assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("signupOtpDraft")).expiresAt), deadline);
      await page.getByRole("button", { name: "인증번호 재발송", exact: true }).click();
      await page.getByText("인증번호를 다시 보냈습니다. 가장 최근에 받은 인증번호를 입력해주세요.", { exact: true }).waitFor();
      assert.equal(await token.inputValue(), "");
      assert.ok(await page.evaluate(() => JSON.parse(sessionStorage.getItem("signupOtpDraft")).expiresAt) > deadline);
      assert.equal(await page.getByText("인증번호 재발송 중 오류가 발생했습니다.", { exact: true }).count(), 0);
    } finally { await browser.close(); }
  });
}

for (const role of ["owner", "staff"]) {
  for (const theme of ["light", "dark"]) {
    test(`${role}/${theme}: verified email hides OTP, closes spacing, focuses name only on explicit success`, async () => {
      const browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : undefined });
      const viewport = { width: role === "owner" ? 1280 : 320, height: 844 };
      const context = await browser.newContext({ viewport });
      await context.routeWebSocket("**/_next/webpack-hmr*", (socket) => socket.close());
      await context.addInitScript(({ role, theme, origin }) => {
        if (window.location.origin !== origin) return;
        sessionStorage.setItem("signupRole", role);
        sessionStorage.setItem("signupTerms", JSON.stringify({ service: true, privacy: true, store_connection: true, store_work: true }));
        localStorage.setItem("ilitda-theme", theme);
      }, { role, theme, origin });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let verified = false;
      let releaseVerification;
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith("/api/")) return route.continue();
        if (url.pathname.endsWith("/status")) return route.fulfill({ status: verified ? 200 : 401, json: verified
          ? { ok: true, email: "ui-only@example.org", role, name: "", phone: "", profileComplete: false }
          : { ok: false } });
        if (url.pathname.endsWith("/verify")) {
          await new Promise((resolve) => { releaseVerification = resolve; });
          verified = true;
          return route.fulfill({ json: { ok: true, role } });
        }
        if (url.pathname.endsWith("/start")) return route.fulfill({ json: { ok: true, expiresAt: Date.now() + 180000, cooldownSeconds: 60 } });
        return route.fulfill({ json: { success: true, data: [], stores: [], brands: [] } });
      });
      try {
        await page.goto(`${origin}/signup/profile`);
        await page.waitForFunction((theme) => document.documentElement.classList.contains(theme), theme);
        const email = page.getByPlaceholder("example@email.com");
        const name = page.getByPlaceholder("예: 홍길동");
        const token = page.getByPlaceholder("인증번호 6자리 입력");
        const notice = page.getByRole("status").filter({ hasText: "이메일 인증이 완료되었습니다." });
        await email.fill("ui-only@example.org");
        await page.getByRole("button", { name: "인증번호 받기", exact: true }).click();
        await token.fill("012345");
        const pending = page.waitForRequest("**/api/auth/signup/owner-staff/verify");
        await page.getByRole("button", { name: "인증 확인", exact: true }).click();
        await pending;
        assert.equal(await token.count(), 1);
        assert.equal(await notice.count(), 0);
        releaseVerification();
        await notice.waitFor();
        await page.waitForFunction(() => document.activeElement?.getAttribute("placeholder") === "예: 홍길동");
        assert.equal(await token.count(), 0);
        assert.equal(await page.getByText("인증번호", { exact: true }).count(), 0);
        assert.equal(await page.getByRole("button", { name: "인증 확인", exact: true }).count(), 0);
        assert.equal(await page.getByRole("timer").count(), 0);
        assert.equal(await page.getByRole("button", { name: /재발송|인증번호 다시 받기/ }).count(), 0);
        assert.equal(await notice.count(), 1);
        assert.equal(await notice.locator("svg").count(), 1);
        const noticeBox = await notice.boundingBox();
        const emailBox = await email.boundingBox();
        const nameBox = await name.boundingBox();
        assert.ok(noticeBox.y >= emailBox.y + emailBox.height);
        assert.ok(nameBox.y > noticeBox.y + noticeBox.height && nameBox.y - noticeBox.y - noticeBox.height < 90, "no blank OTP area before name");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `.next/signup-verified-${role}-${theme}.png`, fullPage: true });
        await page.reload();
        await notice.waitFor();
        await page.waitForFunction(() => !document.querySelector('input[placeholder="예: 홍길동"]')?.disabled);
        assert.equal(await token.count(), 0);
        assert.equal(await name.evaluate((element) => element === document.activeElement), false);
        await email.fill("new-email@example.org");
        assert.equal(await notice.count(), 0);
        assert.equal(await name.isDisabled(), true);
        verified = false;
        await page.getByRole("button", { name: "인증번호 받기", exact: true }).click();
        await token.waitFor();
        assert.equal(await page.getByText("인증번호", { exact: true }).count(), 1);
        assert.equal(await page.getByRole("button", { name: "인증 확인", exact: true }).count(), 1);
        assert.equal(await page.getByRole("timer").count(), 1);
        assert.deepEqual(errors, []);
      } finally { await browser.close(); }
    });
  }
}