import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiSource = readFileSync(path.join(root, "app/api/boss/change-password/route.ts"), "utf8");
const verifyApiSource = readFileSync(path.join(root, "app/api/boss/verify-password/route.ts"), "utf8");
const formSource = readFileSync(path.join(root, "components/owner/OwnerPasswordChangeForm.tsx"), "utf8");
const settingsSource = readFileSync(path.join(root, "app/boss/settings/page.tsx"), "utf8");

describe("점주 비밀번호 변경 보안 계약", () => {
  test("서버가 profiles 기반 owner 역할을 확인하고 로그인 세션과 분리해 현재 비밀번호를 검증한다", () => {
    assert.match(apiSource, /requireServerRole\("owner"\)/);
    assert.match(apiSource, /createPasswordVerificationClient\(supabaseUrl, supabaseAnonKey\)/);
    assert.match(apiSource, /verifyPasswordWithIsolatedClient\(/);
    assert.match(apiSource, /INVALID_CURRENT_PASSWORD/);
    assert.match(apiSource, /Cache-Control.*no-store/);
  });

  test("현재 비밀번호 검증 후에만 최소 8자 새 비밀번호를 Admin API로 갱신한다", () => {
    const verifyIndex = apiSource.indexOf("verifyPasswordWithIsolatedClient(");
    const updateIndex = apiSource.indexOf("updateUserById(access.userId");
    assert.ok(verifyIndex >= 0 && updateIndex > verifyIndex);
    assert.match(apiSource, /newPassword\.length < PASSWORD_MIN_LENGTH/);
    assert.match(apiSource, /currentPassword === newPassword/);
    assert.match(apiSource, /PASSWORD_MIN_LENGTH = 8/);
  });

  test("점주 설정 폼에 세 필드, 실시간 불일치 안내, 성공·오류 피드백이 연결된다", () => {
    assert.match(settingsSource, /<OwnerPasswordChangeForm\s*\/>/);
    assert.match(formSource, /현재 비밀번호/);
    assert.match(formSource, /비밀번호 확인/);
    assert.match(formSource, /newPassword !== confirmPassword/);
    assert.match(formSource, /aria-invalid=\{passwordsMismatch\}/);
    assert.match(formSource, /fetch\("\/api\/boss\/change-password"/);
    assert.match(formSource, /role=\{isSuccess \? "status" : "alert"\}/);
    assert.match(formSource, /네트워크 오류가 발생했습니다/);
  });

  test("버튼부터 현재 비밀번호 확인, 새 비밀번호 입력으로 진행하고 취소로 초기화한다", () => {
    assert.match(formSource, /useState<PasswordStep>\("closed"\)/);
    assert.match(formSource, /비밀번호 변경하기/);
    assert.match(formSource, /현재 비밀번호를 입력하세요\./);
    assert.match(formSource, /fetch\("\/api\/boss\/verify-password"/);
    assert.match(formSource, /setStep\("new"\)/);
    assert.match(formSource, /변경 완료/);
    assert.match(formSource, /onClick=\{resetForm\}/);
    assert.match(verifyApiSource, /requireServerRole\("owner"\)/);
    assert.match(verifyApiSource, /verifyPasswordWithIsolatedClient\(/);
  });
});