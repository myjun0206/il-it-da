import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { isMembershipInHqFranchise, isUuid } from "../../lib/hq/approval-scope.ts";

const HQ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("isMembershipInHqFranchise", () => {
  test("membership.franchise_id가 NULL인 기존 행은 stores.franchise_id로 인정한다", () => {
    assert.equal(isMembershipInHqFranchise(null, HQ, HQ), true);
  });

  test("양쪽이 같은 franchise면 인정한다", () => {
    assert.equal(isMembershipInHqFranchise(HQ, HQ, HQ), true);
    assert.equal(isMembershipInHqFranchise(HQ, null, HQ), true);
  });

  test("다른 franchise의 요청은 제외한다", () => {
    assert.equal(isMembershipInHqFranchise(OTHER, OTHER, HQ), false);
    assert.equal(isMembershipInHqFranchise(null, OTHER, HQ), false);
    assert.equal(isMembershipInHqFranchise(OTHER, null, HQ), false);
  });

  test("membership과 매장의 franchise가 어긋나면 어느 쪽이 HQ여도 제외한다", () => {
    assert.equal(isMembershipInHqFranchise(OTHER, HQ, HQ), false);
    assert.equal(isMembershipInHqFranchise(HQ, OTHER, HQ), false);
  });

  test("franchise 근거가 전혀 없거나 HQ franchise가 없으면 제외한다", () => {
    assert.equal(isMembershipInHqFranchise(null, null, HQ), false);
    assert.equal(isMembershipInHqFranchise(undefined, undefined, HQ), false);
    assert.equal(isMembershipInHqFranchise(null, null, null), false);
    assert.equal(isMembershipInHqFranchise(HQ, HQ, ""), false);
  });

  test("isUuid는 PostgREST 필터 주입 문자를 거른다", () => {
    assert.equal(isUuid(HQ), true);
    assert.equal(isUuid(`${HQ},role.eq.staff`), false);
    assert.equal(isUuid(""), false);
  });
});

describe("app/api/hq/approvals/route.ts 계약", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/api/hq/approvals/route.ts"),
    "utf8",
  );
  const putSource = source.slice(source.indexOf("export async function PUT"));

  test("충돌 마커가 남아 있지 않다", () => {
    assert.equal(/^(<<<<<<<|=======|>>>>>>>)/m.test(source), false);
  });

  test("GET은 owner 요청만, 같은 franchise 또는 NULL franchise 행만 조회한 뒤 범위 함수로 다시 거른다", () => {
    assert.match(source, /\.eq\("role", "owner"\)\s*\n\s*\.or\(`franchise_id\.eq\.\$\{hqUser\.franchiseId\},franchise_id\.is\.null`\)/);
    assert.equal(/\.in\("role", \["owner", "staff"\]\)/.test(source), false);
    assert.match(source, /memberships\.filter\(\(membership\) =>\s*\n\s*isMembershipInHqFranchise\(/);
  });

  test("PUT은 staff 멤버십을 403으로 막고 owner가 아니면 모두 403이다", () => {
    const staffIndex = putSource.indexOf('membership.role === "staff"');
    const ownerIndex = putSource.indexOf('membership.role !== "owner"');
    const updateIndex = putSource.indexOf(".update(update)");
    assert.ok(staffIndex > 0 && ownerIndex > staffIndex && updateIndex > ownerIndex);
    assert.match(putSource, /isMembershipInHqFranchise\(membership\.franchise_id, membershipStore\?\.franchise_id, hqUser\.franchiseId\)/);
  });

  test("staff 차단 로그에 사용자·매장·멤버십 식별자를 남기지 않는다", () => {
    const warn = putSource.match(/console\.warn\([^;]*\);/)?.[0] ?? "";
    assert.match(warn, /STAFF_APPROVAL_BLOCKED/);
    for (const leak of ["user_id", "store_id", "membership.id", "userId", "storeId", "membershipId"]) {
      assert.equal(warn.includes(leak), false, `leaks ${leak}`);
    }
  });

  test("pending/requested 상태 전이 계약을 유지한다", () => {
    assert.match(putSource, /\["pending", "requested", "rejected"\]/);
    assert.match(putSource, /\["pending", "requested", "approved"\]/);
    assert.match(putSource, /\.in\("status", allowedCurrentStatuses\)/);
  });
});
