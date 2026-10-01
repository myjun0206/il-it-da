import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MembershipAuthNotReadyError,
  ensureBrandProfileForApprovedMembership,
} from "../../lib/signup/store-membership-service.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const BRAND_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_BRAND_ID = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, unknown>;
type WriteCall = { table: string; op: "insert" | "update"; payload: Row };
type FailurePoint = "membership_lookup" | "store_lookup" | "master_lookup" | "brand_lookup" | "brand_write";

const DB_ERROR = { code: "500", message: 'relation "profiles" does not exist' };

const APPROVED_MEMBERSHIP = {
  user_id: USER_ID,
  store_id: STORE_ID,
  role: "owner",
  status: "approved",
  franchise_id: BRAND_ID,
  approved_at: "2026-09-30T00:00:00.000Z",
  approved_by: "hq-user",
};

const MASTER_PROFILE = {
  id: USER_ID,
  user_id: USER_ID,
  brand_id: null,
  role: "owner",
  email: "owner@example.com",
  full_name: "김점주",
  phone: "01011112222",
  company_email: null,
  approval_status: "approved",
  approved_at: "2026-09-30T00:00:00.000Z",
  approved_by: "hq-user",
};

function fakeClient(options: {
  memberships?: Row[];
  stores?: Row[];
  profiles?: Row[];
  failAt?: FailurePoint;
  unconfirmedAuthUser?: boolean;
  missingAuthUser?: boolean;
  brandInsertConflict?: boolean;
} = {}) {
  const tables: Record<string, Row[]> = {
    store_memberships: (options.memberships ?? [APPROVED_MEMBERSHIP]).map((row) => ({ ...row })),
    stores: (options.stores ?? [{ id: STORE_ID, franchise_id: BRAND_ID }]).map((row) => ({ ...row })),
    profiles: (options.profiles ?? [MASTER_PROFILE]).map((row) => ({ ...row })),
  };
  const writes: WriteCall[] = [];

  const matches = (row: Row, filters: Row) =>
    Object.entries(filters).every(([column, value]) => row[column] === value);

  function failureFor(table: string, filters: Row): FailurePoint | null {
    if (table === "store_memberships") return "membership_lookup";
    if (table === "stores") return "store_lookup";
    if (table === "profiles") return "brand_id" in filters && filters.brand_id === null ? "master_lookup" : "brand_lookup";
    return null;
  }

  function makeSelect(table: string) {
    const filters: Row = {};
    const builder = {
      eq(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      is(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      maybeSingle() {
        if (options.failAt && options.failAt === failureFor(table, filters)) {
          return Promise.resolve({ data: null, error: DB_ERROR });
        }
        return Promise.resolve({ data: tables[table].find((row) => matches(row, filters)) ?? null, error: null });
      },
    };
    return builder;
  }

  const client = {
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user: options.missingAuthUser
              ? null
              : {
                  id: USER_ID,
                  email: "owner@example.com",
                  email_confirmed_at: options.unconfirmedAuthUser ? null : "2026-09-29T00:00:00Z",
                  user_metadata: { name: "김점주", phone: "01011112222" },
                },
          },
          error: options.missingAuthUser ? { status: 404, message: "not found" } : null,
        }),
      },
    },
    from(table: string) {
      if (!tables[table]) throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => makeSelect(table),
        insert(payload: Row) {
          if (options.failAt === "brand_write" && table === "profiles") {
            writes.push({ table, op: "insert", payload });
            return Promise.resolve({ error: DB_ERROR });
          }
          if (options.brandInsertConflict && table === "profiles" && payload.brand_id) {
            // 동시 승인: 사전 조회에는 없었지만 insert 시점에는 이미 존재한다.
            tables.profiles.push({ ...payload, id: "concurrent-brand-profile" });
            writes.push({ table, op: "insert", payload });
            return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
          }
          tables[table].push({ id: `${table}-new`, ...payload });
          writes.push({ table, op: "insert", payload });
          return Promise.resolve({ error: null });
        },
        update(payload: Row) {
          const filters: Row = {};
          const builder = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return builder;
            },
            then(resolve: (value: unknown) => unknown) {
              if (options.failAt === "brand_write" && table === "profiles") {
                writes.push({ table, op: "update", payload });
                return Promise.resolve({ error: DB_ERROR }).then(resolve);
              }
              for (const row of tables[table]) {
                if (matches(row, filters)) Object.assign(row, payload);
              }
              writes.push({ table, op: "update", payload });
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return builder;
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, tables, writes };
}

const brandRows = (tables: Record<string, Row[]>) =>
  tables.profiles.filter((row) => row.brand_id === BRAND_ID);

describe("정상 승인", () => {
  test("승인된 멤버십에 브랜드 프로필을 만든다", async () => {
    const { client, tables } = fakeClient();

    assert.equal(await ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID), true);
    assert.equal(brandRows(tables).length, 1);
    assert.equal(brandRows(tables)[0].approval_status, "approved");
    assert.equal(brandRows(tables)[0].user_id, USER_ID);
  });

  test("마스터 프로필의 이름·역할을 그대로 복사한다", async () => {
    const { client, tables } = fakeClient();
    await ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID);

    assert.equal(brandRows(tables)[0].full_name, MASTER_PROFILE.full_name);
    assert.equal(brandRows(tables)[0].role, "owner");
  });
});

describe("부분 실패 지점", () => {
  test("Auth 확인이 안 된 계정은 예외로 구분한다", async () => {
    const { client, tables } = fakeClient({ unconfirmedAuthUser: true });

    await assert.rejects(
      () => ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID),
      MembershipAuthNotReadyError,
    );
    assert.equal(brandRows(tables).length, 0);
  });

  test("Auth 사용자가 없으면 예외로 구분한다", async () => {
    const { client } = fakeClient({ missingAuthUser: true });
    await assert.rejects(
      () => ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID),
      MembershipAuthNotReadyError,
    );
  });

  test("UUID가 아닌 사용자 id는 조회 전에 막는다", async () => {
    const { client, writes } = fakeClient();
    await assert.rejects(
      () => ensureBrandProfileForApprovedMembership(client, "not-a-uuid", STORE_ID),
      MembershipAuthNotReadyError,
    );
    assert.equal(writes.length, 0);
  });

  for (const failAt of ["membership_lookup", "store_lookup", "master_lookup", "brand_lookup"] as const) {
    test(`${failAt} 실패는 false로 수렴하고 브랜드 행을 만들지 않는다`, async () => {
      const { client, tables } = fakeClient({ failAt });

      assert.equal(await ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID), false);
      assert.equal(brandRows(tables).length, 0);
    });
  }

  test("브랜드 프로필 쓰기 실패는 false를 돌려준다(성공으로 숨기지 않는다)", async () => {
    const { client } = fakeClient({ failAt: "brand_write" });
    assert.equal(await ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID), false);
  });

  test("승인된 멤버십이 없으면 false다", async () => {
    const { client } = fakeClient({ memberships: [{ ...APPROVED_MEMBERSHIP, status: "pending" }] });
    assert.equal(await ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID), false);
  });

  test("매장 브랜드가 없으면 false다", async () => {
    const { client } = fakeClient({ stores: [{ id: STORE_ID, franchise_id: null }] });
    assert.equal(await ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID), false);
  });

  test("멤버십과 매장 브랜드가 다르면 false다", async () => {
    const { client, tables } = fakeClient({ stores: [{ id: STORE_ID, franchise_id: OTHER_BRAND_ID }] });

    assert.equal(await ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID), false);
    assert.equal(tables.profiles.filter((row) => row.brand_id).length, 0);
  });
});

describe("재시도와 동시 승인", () => {
  test("이미 approved지만 브랜드 행이 없으면 재시도로 복구된다", async () => {
    const { client, tables } = fakeClient();

    assert.equal(await ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID), true);
    assert.equal(brandRows(tables).length, 1);
  });

  test("같은 승인을 두 번 실행해도 브랜드 행이 늘지 않는다", async () => {
    const { client, tables, writes } = fakeClient();

    await ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID);
    await ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID);

    assert.equal(brandRows(tables).length, 1);
    assert.equal(writes.filter((call) => call.op === "insert" && call.table === "profiles").length, 1);
  });

  test("동시 승인으로 unique 충돌이 나도 기존 행을 쓰고 성공한다", async () => {
    const { client, tables } = fakeClient({ brandInsertConflict: true });

    assert.equal(await ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID), true);
    assert.equal(brandRows(tables).length, 1);
  });

  test("마스터 프로필이 없으면 승인 정보로 만들고 브랜드 행까지 잇는다", async () => {
    const { client, tables } = fakeClient({ profiles: [] });

    assert.equal(await ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID), true);
    assert.equal(tables.profiles.filter((row) => row.brand_id === null).length, 1);
    assert.equal(brandRows(tables).length, 1);
  });

  test("멤버십 franchise_id가 비어 있으면 매장 브랜드로 채운 뒤 진행한다", async () => {
    const { client, tables } = fakeClient({
      memberships: [{ ...APPROVED_MEMBERSHIP, franchise_id: null }],
    });

    assert.equal(await ensureBrandProfileForApprovedMembership(client, USER_ID, STORE_ID), true);
    assert.equal(tables.store_memberships[0].franchise_id, BRAND_ID);
  });
});

// 아래는 라우트·화면 소스 계약 검사다(HTTP 요청을 실행하지 않는다).
describe("승인 라우트·화면 계약", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const read = (relativePath: string) =>
    readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
  const hqRoute = read("app/api/hq/approvals/route.ts");
  const hqPage = read("app/hq/approvals/page.tsx");
  const staffRoute = read("app/api/boss/employees/[id]/route.ts");
  const employeesRoute = read("app/api/boss/employees/route.ts");
  const employeesPage = read("app/boss/employees/page.tsx");

  test("HQ는 상태 변경 전에 Auth 확인을 한다", () => {
    const authCheck = hqRoute.indexOf("requireConfirmedMembershipAuthUser");
    const statusUpdate = hqRoute.indexOf(".update(update)");
    assert.ok(authCheck > 0, "Auth 확인이 있어야 한다");
    assert.ok(statusUpdate > authCheck, "상태 변경은 Auth 확인 뒤에 온다");
  });

  test("점주의 직원 승인도 상태 변경 전에 Auth 확인을 한다", () => {
    const authCheck = staffRoute.indexOf("requireConfirmedMembershipAuthUser");
    const statusUpdate = staffRoute.indexOf(".update(updateData)");
    assert.ok(authCheck > 0 && statusUpdate > authCheck);
  });

  test("브랜드 프로필 실패를 성공 응답으로 바꾸지 않는다", () => {
    assert.match(hqRoute, /if \(!brandProfileSynced\) \{[\s\S]{0,200}status: 500/);
    assert.match(staffRoute, /if \(!brandProfileSynced\) \{[\s\S]{0,200}status: 500/);
  });

  test("이미 approved인 요청은 결과 알림을 다시 보내지 않는다", () => {
    assert.match(hqRoute, /if \(!alreadyApproved\) \{\s*\n\s*createNotification\(/);
  });

  test("이미 approved여도 브랜드 프로필 복구는 다시 실행한다", () => {
    // ensure 호출이 alreadyApproved 가드 밖에 있어야 재시도로 복구된다.
    const ensureCall = hqRoute.indexOf("ensureBrandProfileForApprovedMembership(");
    const notificationGuard = hqRoute.lastIndexOf("if (!alreadyApproved) {");
    assert.ok(ensureCall > 0, "복구 호출이 있어야 한다");
    assert.ok(ensureCall < notificationGuard, "복구는 알림 가드보다 앞에서 실행된다");
    assert.match(hqRoute, /if \(action === "approve"\) \{\s*\n\s*const brandProfileSynced = await ensureBrandProfileForApprovedMembership\(/);
  });

  test("목록 API가 부분 승인 상태를 내려 준다", () => {
    assert.match(hqRoute, /needs_brand_profile_recovery/);
    assert.match(employeesRoute, /needsBrandProfileRecovery/);
  });

  test("새로고침 후에도 화면에서 복구 버튼이 보인다", () => {
    assert.match(hqPage, /membership\.needs_brand_profile_recovery \?/);
    assert.match(hqPage, /승인 마무리/);
    assert.match(employeesPage, /staff\.needsBrandProfileRecovery \?/);
    assert.match(employeesPage, /승인 마무리/);
  });

  test("복구 버튼은 기존 승인 API를 그대로 쓴다", () => {
    assert.match(hqPage, /handleApprove\(\s*\n?\s*membership\.id/);
    assert.match(employeesPage, /handleChangeStatus\(staff\.membershipId, "approved"\)/);
  });

  test("타 브랜드 HQ·타 매장 점주 접근 차단은 그대로다", () => {
    assert.match(hqRoute, /isMembershipInHqFranchise\(/);
    assert.match(hqRoute, /membership\.role === "staff"[\s\S]{0,200}forbiddenResponse\(\)/);
    assert.match(staffRoute, /\.eq\("role", "owner"\)\s*\n\s*\.eq\("status", "approved"\)/);
  });
});
