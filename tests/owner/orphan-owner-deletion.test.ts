import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(path.join(root, "supabase/migrations/035_preserve_manuals_on_owner_deletion.sql"), "utf8");
const orphanOwner = readFileSync(path.join(root, "lib/owner/orphan-owner.ts"), "utf8");
const deleteRoute = readFileSync(path.join(root, "app/api/boss/delete-account/route.ts"), "utf8");
const deletionForm = readFileSync(path.join(root, "components/owner/OwnerAccountDeletionForm.tsx"), "utf8");
const settingsPage = readFileSync(path.join(root, "app/boss/settings/page.tsx"), "utf8");
const seedScript = readFileSync(path.join(root, "scripts/ensure-system-orphan-owner.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};

describe("점주 탈퇴 시 매장/매뉴얼 보존 계약", () => {
  test("stores.boss_id FK 삭제 안전망은 stores cascade 대신 set null이다", () => {
    assert.match(migration, /foreign key \(boss_id\) references public\.profiles\(id\) on delete set null/);
    assert.doesNotMatch(migration, /foreign key \(boss_id\) references public\.profiles\(id\) on delete cascade/);
  });

  test("owner의 모든 브랜드 profile을 찾아 stores를 시스템 owner로 이전한다", () => {
    assert.match(migration, /owner_profile\.user_id = p_owner_user_id or owner_profile\.id = p_owner_user_id/);
    assert.match(migration, /membership\.user_id = p_owner_user_id[\s\S]*?membership\.role = 'owner'/);
    assert.match(migration, /owner_store_ids is not null and id = any\(owner_store_ids\)/);
    assert.match(migration, /set boss_id = p_system_profile_id[\s\S]*?where boss_id = any\(owner_profile_ids\)/);
    assert.match(migration, /system_profile\.email = 'system-unassigned@il-it-da\.internal'/);
  });

  test("점주가 approver/rejecter인 membership FK도 Auth 삭제 전에 보존 주체를 바꾼다", () => {
    assert.match(migration, /set approved_by = p_system_user_id[\s\S]*?where approved_by = p_owner_user_id/);
    assert.match(migration, /set rejected_by = p_system_user_id[\s\S]*?where rejected_by = p_owner_user_id/);
    assert.match(migration, /grant execute on function public\.transfer_owner_data_to_system_account\(uuid, uuid, uuid\)\s+to service_role/);
  });

  test("시스템 owner는 내부 이메일, 암호학적 난수 비밀번호와 Auth ban으로 로그인할 수 없다", () => {
    assert.match(orphanOwner, /system-unassigned@il-it-da\.internal/);
    assert.match(orphanOwner, /randomBytes\(48\)\.toString\("base64url"\)/);
    assert.match(orphanOwner, /ban_duration: SYSTEM_BAN_DURATION/);
    assert.match(orphanOwner, /SYSTEM_MARKER = "orphan-owner"/);
    assert.match(orphanOwner, /Reserved orphan-owner email is already used by a non-system account/);
  });

  test("초기화 명령은 .env.local의 service role로 같은 시스템 계정을 준비한다", () => {
    assert.equal(packageJson.scripts?.["setup:orphan-owner"], "node scripts/ensure-system-orphan-owner.mjs");
    assert.match(seedScript, /\.env\.local/);
    assert.match(seedScript, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(seedScript, /ensureSystemOrphanOwner\(adminClient\)/);
  });

  test("점주 API는 재인증·아바타 정리·DB 이전이 성공한 뒤에만 Auth 계정을 삭제한다", () => {
    assert.match(deleteRoute, /requireServerRole\("owner"\)/);
    assert.match(deleteRoute, /verifyPasswordWithIsolatedClient\(/);
    const avatarCleanupIndex = deleteRoute.indexOf("removeOwnerAvatarFiles(adminClient, access.userId)");
    const transferIndex = deleteRoute.indexOf('adminClient.rpc("transfer_owner_data_to_system_account"');
    const deleteIndex = deleteRoute.indexOf("adminClient.auth.admin.deleteUser(access.userId)");
    assert.ok(avatarCleanupIndex >= 0 && transferIndex > avatarCleanupIndex && deleteIndex > transferIndex);
    assert.match(deleteRoute, /if \(transferError\) \{[\s\S]*?return jsonResponse\([\s\S]*?OWNERSHIP_TRANSFER_FAILED/);
  });

  test("점주 설정에서 현재 비밀번호와 탈퇴 확인 문구를 요구한다", () => {
    assert.match(settingsPage, /<OwnerAccountDeletionForm\s*\/>/);
    assert.match(deletionForm, /\/api\/boss\/delete-account/);
    assert.match(deletionForm, /currentPassword/);
    assert.match(deletionForm, /confirmation !== "탈퇴"/);
    assert.match(deletionForm, /signOut\(\{ scope: "local" \}\)/);
  });
});