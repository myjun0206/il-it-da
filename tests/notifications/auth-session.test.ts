import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const center = readFileSync(path.join(root, "components/common/NotificationCenter.tsx"), "utf8");
const middleware = readFileSync(path.join(root, "lib/supabase/middleware.ts"), "utf8");
const cookiePolicy = readFileSync(path.join(root, "lib/supabase/session-cookies.ts"), "utf8");

describe("알림 요청 인증 세션 처리", () => {
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