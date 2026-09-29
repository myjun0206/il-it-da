import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildSignupProfileRow } from "../../lib/auth/signup-profile.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BRAND_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-09-29T00:00:00.000Z");

/** 004 profiles + 023(user_id NOT NULL)만 흉내낸다. 실제 Supabase는 쓰지 않는다. */
function insertIntoFakeProfiles(row: Record<string, unknown>): { code: string; message: string } | null {
  for (const column of ["id", "user_id", "email", "role"]) {
    if (row[column] === null || row[column] === undefined) {
      return { code: "23502", message: `null value in column "${column}" violates not-null constraint` };
    }
  }
  return null;
}

describe("buildSignupProfileRow (신규 HQ 가입)", () => {
  const hqRow = buildSignupProfileRow({
    userId: USER_ID,
    email: "hq@example.com",
    fullName: "본사 담당자",
    role: "hq",
    phone: "010-0000-0000",
    brandId: BRAND_ID,
    now: NOW,
  });

  test("023 이후 NOT NULL인 user_id를 id와 같은 auth 사용자로 채운다", () => {
    assert.equal(hqRow.id, USER_ID);
    assert.equal(hqRow.user_id, USER_ID);
    assert.equal(insertIntoFakeProfiles(hqRow), null);
  });

  test("user_id가 빠진 행은 가짜 테이블에서도 23502로 실패한다 (테스트 자체 검증)", () => {
    const legacyRow: Record<string, unknown> = { ...hqRow };
    delete legacyRow.user_id;
    assert.equal(insertIntoFakeProfiles(legacyRow)?.code, "23502");
  });

  test("HQ는 선택한 브랜드와 승인 상태로 바로 생성된다", () => {
    assert.equal(hqRow.role, "hq");
    assert.equal(hqRow.brand_id, BRAND_ID);
    assert.equal(hqRow.approval_status, "approved");
    assert.equal(hqRow.approved_at, NOW.toISOString());
  });

  test("brandId가 없으면 null로 둔다", () => {
    const row = buildSignupProfileRow({ userId: USER_ID, email: "a@b.co", fullName: "x", role: "hq", now: NOW });
    assert.equal(row.brand_id, null);
    assert.equal(row.phone, null);
    assert.equal(row.company_email, null);
  });

  test("점주·직원은 brand_id 없이 pending으로 생성되고 user_id도 채운다", () => {
    for (const role of ["owner", "staff"] as const) {
      const row = buildSignupProfileRow({ userId: USER_ID, email: "a@b.co", fullName: "x", role, brandId: BRAND_ID });
      assert.equal(row.user_id, USER_ID);
      assert.equal(row.brand_id, null);
      assert.equal(row.approval_status, "pending");
      assert.equal(row.approved_at, null);
    }
  });
});
