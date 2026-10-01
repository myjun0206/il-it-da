import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveOwnerRequestHqRecipientIds,
  submitStoreMembershipRequest,
} from "../../lib/signup/store-membership-service.ts";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const STORE_A = "22222222-2222-4222-8222-222222222222";
const STORE_B = "33333333-3333-4333-8333-333333333333";
const STORE_OTHER_BRAND = "44444444-4444-4444-8444-444444444444";
const BRAND_A = "55555555-5555-4555-8555-555555555555";
const BRAND_B = "66666666-6666-4666-8666-666666666666";
const HQ_A = "77777777-7777-4777-8777-777777777777";
const HQ_B = "88888888-8888-4888-8888-888888888888";

type Row = Record<string, unknown>;
type WriteCall = { table: string; op: "insert" | "update"; payload: Row };

const NOT_FOUND = { code: "PGRST116", message: "No rows found" };

/** 004/006 + 023 구조를 흉내낸 최소 가짜 DB. 실제 Supabase는 쓰지 않는다. */
function fakeClient(
  seed: { stores?: Row[]; memberships?: Row[]; profiles?: Row[] } = {},
  options: { membershipInsertRace?: boolean } = {},
) {
  const tables: Record<string, Row[]> = {
    stores: (seed.stores ?? []).map((row) => ({ ...row })),
    store_memberships: (seed.memberships ?? []).map((row) => ({ ...row })),
    profiles: (seed.profiles ?? []).map((row) => ({ ...row })),
    franchises: [{ id: BRAND_A }, { id: BRAND_B }],
  };
  const writes: WriteCall[] = [];
  let membershipRacePending = options.membershipInsertRace === true;

  const matches = (row: Row, filters: Row) =>
    Object.entries(filters).every(([column, value]) => row[column] === value);

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
      maybeSingle: () =>
        Promise.resolve({ data: tables[table].find((row) => matches(row, filters)) ?? null, error: null }),
      single: () => {
        const found = tables[table].find((row) => matches(row, filters));
        return Promise.resolve(found ? { data: { ...found }, error: null } : { data: null, error: NOT_FOUND });
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: tables[table].filter((row) => matches(row, filters)), error: null }).then(resolve),
    };
    return builder;
  }

  const client = {
    from(table: string) {
      if (!tables[table]) throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => makeSelect(table),
        insert(payload: Row) {
          if (table === "store_memberships" && membershipRacePending) {
            membershipRacePending = false;
            tables.store_memberships.push({ id: "membership-created-concurrently", ...payload, status: "pending" });
            return {
              select: () => ({
                single: () => Promise.resolve({
                  data: null,
                  error: { code: "23505", message: "duplicate key violates store_memberships_user_id_store_id_key" },
                }),
              }),
            };
          }
          const inserted = { id: `${table}-new`, ...payload };
          tables[table].push(inserted);
          writes.push({ table, op: "insert", payload });
          return {
            select: () => ({ single: () => Promise.resolve({ data: { ...inserted }, error: null }) }),
            then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
          };
        },
        update(payload: Row) {
          const filters: Row = {};
          const builder = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return builder;
            },
            then(resolve: (value: unknown) => unknown) {
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

const APPROVED_A = {
  id: "membership-approved-a",
  user_id: OWNER_ID,
  store_id: STORE_A,
  franchise_id: BRAND_A,
  role: "owner",
  status: "approved",
};

function storeSeed() {
  return [
    { id: STORE_A, store_name: "브랜드A 1호점", franchise_id: BRAND_A },
    { id: STORE_B, store_name: "브랜드A 2호점", franchise_id: BRAND_A },
    { id: STORE_OTHER_BRAND, store_name: "브랜드B 1호점", franchise_id: BRAND_B },
  ];
}

describe("점주 매장 추가 (submitStoreMembershipRequest 실제 실행)", () => {
  test("마스터 brand_id가 NULL이어도 같은 브랜드 두 번째 매장을 신청할 수 있다", async () => {
    const { client, tables } = fakeClient({ stores: storeSeed(), memberships: [APPROVED_A] });

    const result = await submitStoreMembershipRequest(client, {
      userId: OWNER_ID,
      userName: "김점주",
      role: "owner",
      storeId: STORE_B,
      storeName: "브랜드A 2호점",
      franchiseId: BRAND_A,
      currentApprovalStatus: "approved",
    });

    assert.equal(result.success, true);
    assert.equal(result.created, true);
    assert.equal(result.membershipStatus, "pending");

    const created = tables.store_memberships.find((row) => row.store_id === STORE_B);
    assert.equal(created?.status, "pending");
    assert.equal(created?.franchise_id, BRAND_A);
    assert.equal(created?.role, "owner");
  });

  test("다른 브랜드의 첫 매장도 신청할 수 있다", async () => {
    const { client, tables } = fakeClient({ stores: storeSeed(), memberships: [APPROVED_A] });

    const result = await submitStoreMembershipRequest(client, {
      userId: OWNER_ID,
      userName: "김점주",
      role: "owner",
      storeId: STORE_OTHER_BRAND,
      storeName: "브랜드B 1호점",
      franchiseId: BRAND_B,
      currentApprovalStatus: "approved",
    });

    assert.equal(result.success, true);
    assert.equal(result.created, true);
    assert.equal(result.membershipStatus, "pending");
    assert.equal(
      tables.store_memberships.find((row) => row.store_id === STORE_OTHER_BRAND)?.franchise_id,
      BRAND_B,
    );
  });

  test("기존 approved 매장 권한은 그대로 남는다", async () => {
    const { client, tables } = fakeClient({ stores: storeSeed(), memberships: [APPROVED_A] });

    await submitStoreMembershipRequest(client, {
      userId: OWNER_ID,
      userName: "김점주",
      role: "owner",
      storeId: STORE_OTHER_BRAND,
      storeName: "브랜드B 1호점",
      franchiseId: BRAND_B,
      currentApprovalStatus: "approved",
    });

    const existing = tables.store_memberships.find((row) => row.id === APPROVED_A.id);
    assert.equal(existing?.status, "approved");
    assert.equal(existing?.franchise_id, BRAND_A);
  });

  test("승인 전에는 브랜드 profiles 행을 만들지 않는다", async () => {
    const { client, writes } = fakeClient({ stores: storeSeed(), memberships: [APPROVED_A] });

    await submitStoreMembershipRequest(client, {
      userId: OWNER_ID,
      userName: "김점주",
      role: "owner",
      storeId: STORE_OTHER_BRAND,
      storeName: "브랜드B 1호점",
      franchiseId: BRAND_B,
      currentApprovalStatus: "approved",
    });

    assert.equal(writes.some((call) => call.table === "profiles"), false);
  });

  test("같은 매장을 다시 신청하면 기존 membership을 그대로 돌려준다", async () => {
    const pending = { ...APPROVED_A, id: "membership-pending-b", store_id: STORE_B, status: "pending" };
    const { client, tables } = fakeClient({ stores: storeSeed(), memberships: [APPROVED_A, pending] });

    const result = await submitStoreMembershipRequest(client, {
      userId: OWNER_ID,
      userName: "김점주",
      role: "owner",
      storeId: STORE_B,
      storeName: "브랜드A 2호점",
      franchiseId: BRAND_A,
      currentApprovalStatus: "approved",
    });

    assert.equal(result.created, false);
    assert.equal(result.membershipStatus, "pending");
    assert.equal(tables.store_memberships.filter((row) => row.store_id === STORE_B).length, 1);
  });

  test("동시 신청으로 membership unique 위반이 나면 방금 생성된 요청을 재사용한다", async () => {
    const { client, tables } = fakeClient({ stores: storeSeed() }, { membershipInsertRace: true });

    const result = await submitStoreMembershipRequest(client, {
      userId: OWNER_ID,
      userName: "점주",
      role: "owner",
      storeId: STORE_B,
      storeName: "브랜드A 2호점",
      franchiseId: BRAND_A,
    });

    assert.equal(result.success, true);
    assert.equal(result.created, false);
    assert.equal(result.membershipStatus, "pending");
    assert.equal(tables.store_memberships.length, 1);
  });

  test("이미 승인된 매장을 다시 신청하면 approved 상태를 그대로 알린다", async () => {
    const { client } = fakeClient({ stores: storeSeed(), memberships: [APPROVED_A] });

    const result = await submitStoreMembershipRequest(client, {
      userId: OWNER_ID,
      userName: "김점주",
      role: "owner",
      storeId: STORE_A,
      storeName: "브랜드A 1호점",
      franchiseId: BRAND_A,
      currentApprovalStatus: "approved",
    });

    assert.equal(result.created, false);
    assert.equal(result.membershipStatus, "approved");
  });

  test("같은 매장에 직원으로 등록돼 있으면 역할 충돌로 막는다", async () => {
    const staffMembership = {
      id: "membership-staff",
      user_id: OWNER_ID,
      store_id: STORE_B,
      franchise_id: BRAND_A,
      role: "staff",
      status: "approved",
    };
    const { client } = fakeClient({ stores: storeSeed(), memberships: [staffMembership] });

    const result = await submitStoreMembershipRequest(client, {
      userId: OWNER_ID,
      userName: "김점주",
      role: "owner",
      storeId: STORE_B,
      storeName: "브랜드A 2호점",
      franchiseId: BRAND_A,
      currentApprovalStatus: "approved",
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 409);
  });

  test("기존 매장의 브랜드를 덮어쓰지 않는다", async () => {
    const { client, tables } = fakeClient({ stores: storeSeed(), memberships: [APPROVED_A] });

    await submitStoreMembershipRequest(client, {
      userId: OWNER_ID,
      userName: "김점주",
      role: "owner",
      storeId: STORE_OTHER_BRAND,
      storeName: "브랜드B 1호점",
      franchiseId: BRAND_B,
      currentApprovalStatus: "approved",
    });

    assert.equal(tables.stores.find((row) => row.id === STORE_A)?.franchise_id, BRAND_A);
    assert.equal(tables.stores.find((row) => row.id === STORE_OTHER_BRAND)?.franchise_id, BRAND_B);
  });
});

describe("신청 알림 수신자 (resolveOwnerRequestHqRecipientIds 실제 실행)", () => {
  const profiles = [
    { id: HQ_A, user_id: HQ_A, role: "hq", brand_id: BRAND_A },
    { id: HQ_B, user_id: HQ_B, role: "hq", brand_id: BRAND_B },
    { id: OWNER_ID, user_id: OWNER_ID, role: "owner", brand_id: null },
  ];

  test("신청 매장 브랜드의 HQ에게만 간다", async () => {
    const { client } = fakeClient({ stores: storeSeed(), profiles });
    assert.deepEqual(await resolveOwnerRequestHqRecipientIds(client, STORE_OTHER_BRAND), [HQ_B]);
  });

  test("다른 브랜드 HQ는 수신자에 포함되지 않는다", async () => {
    const { client } = fakeClient({ stores: storeSeed(), profiles });
    const recipients = await resolveOwnerRequestHqRecipientIds(client, STORE_A);
    assert.deepEqual(recipients, [HQ_A]);
    assert.equal(recipients.includes(HQ_B), false);
  });

  test("브랜드가 없는 매장이면 아무에게도 보내지 않는다", async () => {
    const { client } = fakeClient({
      stores: [{ id: STORE_A, store_name: "브랜드 없음", franchise_id: null }],
      profiles,
    });
    assert.deepEqual(await resolveOwnerRequestHqRecipientIds(client, STORE_A), []);
  });
});

// 아래는 라우트 파일의 소스 계약 검사다(실제 HTTP 요청을 실행하지 않는다).
describe("라우트 소스 계약", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const readSource = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");
  const storeRequest = readSource("app/api/boss/stores/requests/route.ts");
  const bossProfile = readSource("app/api/boss/profile/route.ts");
  /** 설명 주석은 계약 검사 대상이 아니므로 제외한다. */
  const withoutComments = (source: string) => source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");

  test("매장 추가에서 마스터 brand_id 기반 차단을 제거했다", () => {
    assert.equal(/NO_BRAND/.test(storeRequest), false);
    assert.equal(/BRAND_MISMATCH/.test(storeRequest), false);
    assert.equal(/brand_id/.test(withoutComments(storeRequest)), false);
  });

  test("대상 매장 브랜드는 stores.franchise_id로 정한다", () => {
    assert.match(storeRequest, /from\("stores"\)\s*\n\s*\.select\("franchise_id"\)\s*\n\s*\.eq\("id", requestedStoreId\)/);
    assert.match(storeRequest, /franchiseId: storeFranchiseId/);
  });

  test("브랜드를 확인할 수 없으면 고정 안내로 거절한다", () => {
    assert.match(storeRequest, /code: "STORE_BRAND_UNKNOWN"/);
    assert.match(storeRequest, /STORE_BRAND_UNKNOWN_MESSAGE/);
  });

  test("운영 신청 서버 진단에는 requestId와 안전한 실패 단계 로그가 포함된다", () => {
    assert.match(storeRequest, /createDiagnosticRequestId\(\)/);
    assert.match(storeRequest, /logDiagnosticError\("OWNER_STORE_REQUEST"/);
    assert.match(storeRequest, /"X-Request-Id": requestId/);
    assert.match(storeRequest, /requestId\s*\}/);
  });

  test("두 라우트 모두 세션 사용자로 대상을 정한다", () => {
    for (const source of [storeRequest, bossProfile]) {
      assert.match(source, /serverClient\.auth\.getUser\(\)/);
      assert.equal(/body\.(userId|user_id)/.test(source), false);
    }
  });

  test("이름 변경에서 brand_id 차단을 제거하고 세션 사용자 행만 갱신한다", () => {
    assert.equal(/brand_id/.test(withoutComments(bossProfile)), false);
    assert.match(bossProfile, /\.update\(\{ full_name: name \}\)\s*\n\s*\.eq\("user_id", userData\.user\.id\)/);
  });

  test("이름 변경이 역할·승인 상태를 건드리지 않는다", () => {
    const updatePayloads = bossProfile.match(/\.update\(\{[^}]*\}\)/g) ?? [];
    assert.equal(updatePayloads.length, 1);
    for (const field of ["role", "approval_status", "brand_id", "email"]) {
      assert.equal(updatePayloads[0].includes(field), false, field);
    }
  });

  test("DB 오류 원문을 응답에 넣지 않는다", () => {
    for (const source of [storeRequest, bossProfile]) {
      assert.equal(/error: \w*[Ee]rror\.message/.test(source), false);
      assert.equal(/details: \w*[Ee]rror\.details/.test(source), false);
    }
  });
});
