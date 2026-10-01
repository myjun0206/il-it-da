import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { submitStoreMembershipRequest } from "../../lib/signup/store-membership-service.ts";

const NEW_USER = "11111111-1111-4111-8111-111111111111";
const APPROVED_OWNER = "22222222-2222-4222-8222-222222222222";
const STAFF_USER = "33333333-3333-4333-8333-333333333333";
const BRANDED_STORE = "44444444-4444-4444-8444-444444444444";
const BRANDLESS_STORE = "55555555-5555-4555-8555-555555555555";
const BRAND_A = "66666666-6666-4666-8666-666666666666";
const BRAND_B = "77777777-7777-4777-8777-777777777777";

type Row = Record<string, unknown>;
type WriteCall = { table: string; op: "insert" | "update"; payload: Row };

const NOT_FOUND = { code: "PGRST116", message: "No rows found" };

/** 004/006 + 011 구조를 흉내낸 최소 가짜 DB. 실제 Supabase는 쓰지 않는다. */
function fakeClient(seed: { stores?: Row[]; memberships?: Row[]; profiles?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    stores: (seed.stores ?? []).map((row) => ({ ...row })),
    store_memberships: (seed.memberships ?? []).map((row) => ({ ...row })),
    profiles: (seed.profiles ?? []).map((row) => ({ ...row })),
    franchises: [{ id: BRAND_A }, { id: BRAND_B }],
  };
  const writes: WriteCall[] = [];

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

function storeSeed() {
  return [
    { id: BRANDED_STORE, store_name: "브랜드A 1호점", franchise_id: BRAND_A },
    { id: BRANDLESS_STORE, store_name: "브랜드미상 지점", franchise_id: null },
  ];
}

const BASE_INPUT = { userName: "김신청", role: "owner" as const };

describe("정상 가입·신청 경로", () => {
  test("브랜드가 연결된 매장에 신규 점주가 신청하면 pending으로 접수된다", async () => {
    const { client, tables } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeId: BRANDED_STORE,
      storeName: "브랜드A 1호점",
    });

    assert.equal(result.success, true);
    assert.equal(result.membershipStatus, "pending");
    assert.equal(tables.store_memberships[0]?.franchise_id, BRAND_A);
  });

  test("직원도 브랜드가 연결된 기존 매장에 신청할 수 있다", async () => {
    const { client, tables } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      userId: STAFF_USER,
      userName: "박직원",
      role: "staff",
      storeId: BRANDED_STORE,
      storeName: "브랜드A 1호점",
    });

    assert.equal(result.success, true);
    assert.equal(tables.store_memberships[0]?.role, "staff");
    assert.equal(tables.store_memberships[0]?.status, "pending");
  });

  test("매장 id 없이 이름만 보내도 기존 매장의 브랜드로 접수된다", async () => {
    const { client, tables } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeName: "브랜드A 1호점",
    });

    assert.equal(result.success, true);
    assert.equal(tables.store_memberships[0]?.franchise_id, BRAND_A);
  });
});

describe("기존 매장 브랜드 쓰기 차단", () => {
  test("브랜드 없는 기존 매장에 임의 franchiseId를 보내도 stores를 바꾸지 않는다", async () => {
    const { client, tables, writes } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeId: BRANDLESS_STORE,
      storeName: "브랜드미상 지점",
      franchiseId: BRAND_B,
    });

    assert.equal(result.success, false);
    assert.equal(result.code, "STORE_BRAND_UNKNOWN");
    assert.equal(result.status, 400);
    assert.equal(tables.stores.find((row) => row.id === BRANDLESS_STORE)?.franchise_id, null);
    assert.equal(writes.some((call) => call.table === "stores"), false);
  });

  test("거절된 요청은 membership도 만들지 않아 HQ 알림이 가지 않는다", async () => {
    const { client, tables, writes } = fakeClient({ stores: storeSeed() });

    await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeId: BRANDLESS_STORE,
      storeName: "브랜드미상 지점",
      franchiseId: BRAND_B,
    });

    assert.deepEqual(tables.store_memberships, []);
    assert.equal(writes.some((call) => call.table === "store_memberships"), false);
  });

  test("신규·대기 사용자와 승인된 점주 모두 같은 시도가 막힌다", async () => {
    for (const actor of [
      { userId: NEW_USER, currentApprovalStatus: undefined },
      { userId: NEW_USER, currentApprovalStatus: "pending" },
      { userId: APPROVED_OWNER, currentApprovalStatus: "approved" },
    ]) {
      const { client, tables } = fakeClient({ stores: storeSeed() });

      const result = await submitStoreMembershipRequest(client, {
        ...BASE_INPUT,
        userId: actor.userId,
        storeId: BRANDLESS_STORE,
        storeName: "브랜드미상 지점",
        franchiseId: BRAND_A,
        currentApprovalStatus: actor.currentApprovalStatus,
      });

      assert.equal(result.code, "STORE_BRAND_UNKNOWN", String(actor.currentApprovalStatus));
      assert.equal(tables.stores.find((row) => row.id === BRANDLESS_STORE)?.franchise_id, null);
    }
  });

  test("직원도 같은 방식으로 기존 매장 브랜드를 정할 수 없다", async () => {
    const { client, tables } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      userId: STAFF_USER,
      userName: "박직원",
      role: "staff",
      storeId: BRANDLESS_STORE,
      storeName: "브랜드미상 지점",
      franchiseId: BRAND_B,
    });

    assert.equal(result.code, "STORE_BRAND_UNKNOWN");
    assert.equal(tables.stores.find((row) => row.id === BRANDLESS_STORE)?.franchise_id, null);
  });

  test("요청 franchiseId가 실제 매장 브랜드와 다르면 거절한다", async () => {
    const { client, tables } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeId: BRANDED_STORE,
      storeName: "브랜드A 1호점",
      franchiseId: BRAND_B,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 400);
    assert.equal(tables.stores.find((row) => row.id === BRANDED_STORE)?.franchise_id, BRAND_A);
    assert.deepEqual(tables.store_memberships, []);
  });

  test("매장 id 없이 이름만 보내도 body franchiseId로 기존 브랜드를 바꿀 수 없다", async () => {
    const { client, tables, writes } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeName: "브랜드A 1호점",
      franchiseId: BRAND_B,
    });

    assert.equal(result.success, false);
    assert.equal(tables.stores.find((row) => row.id === BRANDED_STORE)?.franchise_id, BRAND_A);
    assert.equal(writes.some((call) => call.table === "stores"), false);
  });

  test("같은 이름의 브랜드 없는 매장도 이름 경로에서 채워지지 않는다", async () => {
    const { client, tables } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeName: "브랜드미상 지점",
      franchiseId: BRAND_A,
    });

    assert.equal(result.code, "STORE_BRAND_UNKNOWN");
    assert.equal(tables.stores.find((row) => row.id === BRANDLESS_STORE)?.franchise_id, null);
  });

  test("실재하지 않는 franchiseId는 조회 전에 막는다", async () => {
    const { client, writes } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeId: BRANDED_STORE,
      storeName: "브랜드A 1호점",
      franchiseId: "99999999-9999-4999-8999-999999999999",
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 400);
    assert.equal(writes.length, 0);
  });
});

describe("직원의 매장 생성 차단", () => {
  test("직원은 없는 매장 이름으로 새 매장을 만들 수 없다", async () => {
    const { client, tables, writes } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      userId: STAFF_USER,
      userName: "박직원",
      role: "staff",
      storeName: "브랜드A 새지점",
      franchiseId: BRAND_A,
    });

    assert.equal(result.success, false);
    assert.equal(result.code, "STORE_NOT_FOUND");
    assert.equal(tables.stores.length, storeSeed().length);
    assert.equal(writes.some((call) => call.table === "stores" && call.op === "insert"), false);
  });
});

describe("존재하지 않는 storeId", () => {
  const MISSING_STORE = "88888888-8888-4888-8888-888888888888";

  test("기존 매장 이름을 함께 보내도 이름 경로로 넘어가지 않는다", async () => {
    const { client, tables, writes } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeId: MISSING_STORE,
      storeName: "브랜드A 1호점",
      franchiseId: BRAND_A,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 404);
    assert.equal(result.code, "STORE_NOT_FOUND");
    assert.deepEqual(tables.store_memberships, []);
    assert.equal(writes.length, 0);
  });

  test("새 이름을 함께 보내도 새 매장을 만들지 않는다", async () => {
    const { client, tables, writes } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeId: MISSING_STORE,
      storeName: "완전히 새로운 지점",
      franchiseId: BRAND_A,
    });

    assert.equal(result.status, 404);
    assert.equal(result.code, "STORE_NOT_FOUND");
    assert.equal(tables.stores.length, storeSeed().length);
    assert.equal(writes.some((call) => call.op === "insert"), false);
  });

  test("거절 응답에 매장·사용자 식별자를 담지 않는다", async () => {
    const { client } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeId: MISSING_STORE,
      storeName: "완전히 새로운 지점",
    });

    const serialized = `${result.error ?? ""} ${result.details ?? ""}`;
    for (const leak of [MISSING_STORE, NEW_USER, "PGRST"]) {
      assert.equal(serialized.includes(leak), false, leak);
    }
  });

  test("UUID 형식이 아닌 storeId는 기존 입력 검증대로 400으로 막는다", async () => {
    const { client, writes } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeId: "not-a-uuid",
      storeName: "브랜드A 1호점",
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 400);
    assert.equal(writes.length, 0);
  });

  test("storeId가 처음부터 없으면 기존 이름 기반 신청이 그대로 동작한다", async () => {
    const { client, tables } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeName: "브랜드A 1호점",
    });

    assert.equal(result.success, true);
    assert.equal(result.membershipStatus, "pending");
    assert.equal(tables.store_memberships[0]?.franchise_id, BRAND_A);
  });

  test("빈 storeId 문자열은 없는 것으로 보고 이름 경로를 쓴다", async () => {
    const { client } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeId: "   ",
      storeName: "브랜드A 1호점",
    });

    assert.equal(result.success, true);
  });
});

describe("잘못된 입력", () => {
  test("매장 정보가 없으면 고정 문구로 막는다", async () => {
    const { client, writes } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, { ...BASE_INPUT, userId: NEW_USER });

    assert.equal(result.success, false);
    assert.equal(result.status, 400);
    assert.equal(writes.length, 0);
  });

  test("오류 응답에 DB 원문이나 사용자 식별자를 담지 않는다", async () => {
    const { client } = fakeClient({ stores: storeSeed() });

    const result = await submitStoreMembershipRequest(client, {
      ...BASE_INPUT,
      userId: NEW_USER,
      storeId: BRANDLESS_STORE,
      storeName: "브랜드미상 지점",
      franchiseId: BRAND_B,
    });

    const serialized = `${result.error ?? ""} ${result.details ?? ""}`;
    for (const leak of [NEW_USER, BRANDLESS_STORE, BRAND_B, "PGRST", "relation"]) {
      assert.equal(serialized.includes(leak), false, leak);
    }
  });
});
