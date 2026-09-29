import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveOwnerRequestHqRecipientIds,
  submitStoreMembershipRequest,
  upsertSignupProfile,
} from "../../lib/signup/store-membership-service.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const FRANCHISE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_FRANCHISE_ID = "44444444-4444-4444-8444-444444444444";
const MEMBERSHIP_ID = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, unknown>;
type Call = { table: string; op: "insert" | "update"; payload: Row; filters: Row };

const NOT_FOUND = { code: "PGRST116", message: "No rows found" };

/**
 * 001/004/006 + 023(profiles.user_id, brand_id)을 흉내낸 최소 가짜 DB.
 * 실제 Supabase는 쓰지 않는다. 기록된 insert/update로 "무엇을 썼는지"까지 검증한다.
 */
function fakeClient(options: {
  profiles?: Row[];
  stores?: Row[];
  memberships?: Row[];
  profileLookupError?: { code: string; message: string };
  profileInsertError?: { code: string; message: string };
  membershipUpdateError?: { code: string; message: string };
} = {}) {
  const tables: Record<string, Row[]> = {
    profiles: (options.profiles ?? []).map((row) => ({ ...row })),
    stores: (options.stores ?? []).map((row) => ({ ...row })),
    store_memberships: (options.memberships ?? []).map((row) => ({ ...row })),
    franchises: [{ id: FRANCHISE_ID }, { id: OTHER_FRANCHISE_ID }],
  };
  const calls: Call[] = [];

  function matches(row: Row, filters: Row): boolean {
    return Object.entries(filters).every(([column, value]) => row[column] === value);
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
        if (table === "profiles" && options.profileLookupError) {
          return Promise.resolve({ data: null, error: options.profileLookupError });
        }
        const found = tables[table].find((row) => matches(row, filters)) ?? null;
        return Promise.resolve({ data: found ? { ...found } : null, error: null });
      },
      single() {
        const found = tables[table].find((row) => matches(row, filters)) ?? null;
        return Promise.resolve(
          found ? { data: { ...found }, error: null } : { data: null, error: NOT_FOUND },
        );
      },
    };
    return builder;
  }

  const client = {
    from(table: string) {
      if (!tables[table]) {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select: () => makeSelect(table),
        insert(payload: Row) {
          if (table === "profiles" && options.profileInsertError) {
            calls.push({ table, op: "insert", payload, filters: {} });
            return Promise.resolve({ error: options.profileInsertError });
          }

          const inserted = {
            id: payload.id ?? (table === "store_memberships" ? MEMBERSHIP_ID : `${table}-generated`),
            ...payload,
          };
          tables[table].push(inserted);
          calls.push({ table, op: "insert", payload, filters: {} });

          const result = {
            select: () => ({ single: () => Promise.resolve({ data: { ...inserted }, error: null }) }),
            then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
          };
          return result;
        },
        update(payload: Row) {
          const filters: Row = {};
          const builder = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return builder;
            },
            then(resolve: (value: unknown) => unknown) {
              if (table === "store_memberships" && options.membershipUpdateError) {
                calls.push({ table, op: "update", payload, filters: { ...filters } });
                return Promise.resolve({ error: options.membershipUpdateError }).then(resolve);
              }
              for (const row of tables[table]) {
                if (matches(row, filters)) Object.assign(row, payload);
              }
              calls.push({ table, op: "update", payload, filters: { ...filters } });
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return builder;
        },
      };
    },
  } as unknown as SupabaseClient;

  return {
    client,
    tables,
    calls,
    callsFor: (table: string, op: Call["op"]) => calls.filter((c) => c.table === table && c.op === op),
  };
}

const PROFILE_INPUT = {
  userId: USER_ID,
  email: "Staff@Example.com",
  role: "staff" as const,
  name: "김직원",
  phone: "01011112222",
};

describe("upsertSignupProfile - 신규 계정", () => {
  test("프로필이 없으면 insert하고 023의 user_id를 함께 채운다", async () => {
    const db = fakeClient();
    const result = await upsertSignupProfile(db.client, PROFILE_INPUT);

    assert.equal(result.success, true);
    const inserts = db.callsFor("profiles", "insert");
    assert.equal(inserts.length, 1);
    // 023에서 profiles.user_id가 NOT NULL이므로 빠지면 23502로 가입이 막힌다.
    assert.equal(inserts[0].payload.user_id, USER_ID);
    assert.equal(inserts[0].payload.id, USER_ID);
    assert.equal(inserts[0].payload.approval_status, "pending");
    assert.equal(inserts[0].payload.role, "staff");
  });

  test("이메일은 소문자로 정규화해 저장한다", async () => {
    const db = fakeClient();
    await upsertSignupProfile(db.client, PROFILE_INPUT);

    assert.equal(db.callsFor("profiles", "insert")[0].payload.email, "staff@example.com");
  });

  test("신규 생성 경로에서는 update를 호출하지 않는다", async () => {
    const db = fakeClient();
    await upsertSignupProfile(db.client, PROFILE_INPUT);

    assert.equal(db.callsFor("profiles", "update").length, 0);
  });
});

describe("upsertSignupProfile - 기존 계정", () => {
  const existing = {
    id: USER_ID,
    user_id: USER_ID,
    email: "staff@example.com",
    full_name: "김직원",
    phone: "01011112222",
    approval_status: "approved",
    brand_id: null,
  };

  test("기존 프로필이 있으면 insert를 아예 시도하지 않는다", async () => {
    // 회귀: insert의 23505로 기존 계정을 감지하던 시절에는 NOT NULL 컬럼 때문에
    // 23502가 먼저 터져 이미 가입한 사용자의 추가 매장 신청이 막혔다.
    const db = fakeClient({ profiles: [existing] });
    const result = await upsertSignupProfile(db.client, PROFILE_INPUT);

    assert.equal(result.success, true);
    assert.equal(db.callsFor("profiles", "insert").length, 0);
  });

  test("이미 채워진 필드는 덮어쓰지 않는다", async () => {
    const db = fakeClient({ profiles: [existing] });
    await upsertSignupProfile(db.client, PROFILE_INPUT);

    assert.equal(db.callsFor("profiles", "update").length, 0);
    // 승인 상태를 pending으로 되돌리지 않는다.
    assert.equal(db.tables.profiles[0].approval_status, "approved");
  });

  test("비어 있는 필드만 보완한다", async () => {
    const db = fakeClient({
      profiles: [{ ...existing, full_name: null, phone: null, approval_status: null }],
    });
    await upsertSignupProfile(db.client, PROFILE_INPUT);

    const updates = db.callsFor("profiles", "update");
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].payload, {
      full_name: "김직원",
      phone: "01011112222",
      approval_status: "pending",
    });
    assert.deepEqual(updates[0].filters, { id: USER_ID });
  });

  test("023 이전에 만들어져 user_id가 비어 있으면 backfill 한다", async () => {
    const db = fakeClient({ profiles: [{ ...existing, user_id: null }] });
    await upsertSignupProfile(db.client, PROFILE_INPUT);

    const updates = db.callsFor("profiles", "update");
    assert.equal(updates.length, 1);
    assert.equal(updates[0].payload.user_id, USER_ID);
    assert.equal(db.tables.profiles[0].user_id, USER_ID);
  });

  test("이메일이 바뀌었으면 갱신한다", async () => {
    const db = fakeClient({ profiles: [{ ...existing, email: "old@example.com" }] });
    await upsertSignupProfile(db.client, PROFILE_INPUT);

    assert.equal(db.callsFor("profiles", "update")[0].payload.email, "staff@example.com");
  });

  test("브랜드 프로필(brand_id 있음)은 마스터 프로필 조회에 끼어들지 않는다", async () => {
    const db = fakeClient({
      profiles: [{ ...existing, id: "brand-profile", brand_id: FRANCHISE_ID }],
    });
    const result = await upsertSignupProfile(db.client, PROFILE_INPUT);

    // id로만 조회하므로 브랜드 행은 매칭되지 않고 마스터 프로필이 새로 만들어진다.
    assert.equal(result.success, true);
    assert.equal(db.callsFor("profiles", "insert").length, 1);
  });
});

describe("upsertSignupProfile - 실패 처리", () => {
  test("프로필 조회가 실패하면 insert를 시도하지 않고 실패를 돌려준다", async () => {
    const db = fakeClient({ profileLookupError: { code: "42703", message: "column missing" } });
    const result = await upsertSignupProfile(db.client, PROFILE_INPUT);

    assert.equal(result.success, false);
    assert.equal(result.error, "Failed to load profile");
    assert.equal(db.callsFor("profiles", "insert").length, 0);
  });

  test("동시 가입으로 23505가 나면 성공으로 처리한다", async () => {
    const db = fakeClient({ profileInsertError: { code: "23505", message: "duplicate key" } });
    const result = await upsertSignupProfile(db.client, PROFILE_INPUT);

    assert.equal(result.success, true);
  });

  test("그 밖의 insert 오류는 실패로 돌려준다", async () => {
    const db = fakeClient({ profileInsertError: { code: "23502", message: "null value" } });
    const result = await upsertSignupProfile(db.client, PROFILE_INPUT);

    assert.equal(result.success, false);
    assert.equal(result.error, "Failed to create profile");
  });
});

const STORE_ROW = { id: STORE_ID, store_name: "강남점", franchise_id: FRANCHISE_ID };

const MEMBERSHIP_INPUT = {
  userId: USER_ID,
  userName: "김직원",
  role: "staff" as const,
  storeId: STORE_ID,
};

describe("submitStoreMembershipRequest - 중복 요청", () => {
  const pendingMembership = {
    id: MEMBERSHIP_ID,
    user_id: USER_ID,
    store_id: STORE_ID,
    role: "staff",
    status: "pending",
    franchise_id: FRANCHISE_ID,
  };

  test("이미 신청한 매장이면 새 row를 만들지 않고 기존 상태를 돌려준다", async () => {
    const db = fakeClient({ stores: [STORE_ROW], memberships: [pendingMembership] });
    const result = await submitStoreMembershipRequest(db.client, MEMBERSHIP_INPUT);

    assert.equal(result.success, true);
    assert.equal(result.membershipId, MEMBERSHIP_ID);
    // 가입/매장 추가 화면이 "이미 신청함" 안내를 고르는 데 쓰는 값이다.
    assert.equal(result.created, false);
    assert.equal(result.membershipStatus, "pending");
    assert.equal(db.callsFor("store_memberships", "insert").length, 0);
  });

  test("이미 승인된 매장이면 승인 상태를 그대로 알려준다", async () => {
    const db = fakeClient({
      stores: [STORE_ROW],
      memberships: [{ ...pendingMembership, status: "approved" }],
    });
    const result = await submitStoreMembershipRequest(db.client, MEMBERSHIP_INPUT);

    assert.equal(result.created, false);
    assert.equal(result.membershipStatus, "approved");
  });

  test("다른 역할로 이미 등록돼 있으면 409로 막는다", async () => {
    const db = fakeClient({
      stores: [STORE_ROW],
      memberships: [{ ...pendingMembership, role: "owner" }],
    });
    const result = await submitStoreMembershipRequest(db.client, MEMBERSHIP_INPUT);

    assert.equal(result.success, false);
    assert.equal(result.status, 409);
    assert.equal(db.callsFor("store_memberships", "insert").length, 0);
  });

  test("멤버십 브랜드가 비어 있으면 채우고도 created:false를 유지한다", async () => {
    const db = fakeClient({
      stores: [STORE_ROW],
      memberships: [{ ...pendingMembership, franchise_id: null }],
    });
    const result = await submitStoreMembershipRequest(db.client, MEMBERSHIP_INPUT);

    const updates = db.callsFor("store_memberships", "update");
    assert.equal(updates.length, 1);
    assert.equal(updates[0].payload.franchise_id, FRANCHISE_ID);
    assert.equal(result.success, true);
    assert.equal(result.created, false);
    assert.equal(result.membershipStatus, "pending");
  });

  test("브랜드 동기화가 실패하면 500으로 돌려준다", async () => {
    const db = fakeClient({
      stores: [STORE_ROW],
      memberships: [{ ...pendingMembership, franchise_id: null }],
      membershipUpdateError: { code: "42703", message: "column missing" },
    });
    const result = await submitStoreMembershipRequest(db.client, MEMBERSHIP_INPUT);

    assert.equal(result.success, false);
    assert.equal(result.status, 500);
  });
});

describe("submitStoreMembershipRequest - 신규 요청", () => {
  test("멤버십이 없으면 pending으로 만들고 created:true를 돌려준다", async () => {
    const db = fakeClient({ stores: [STORE_ROW] });
    const result = await submitStoreMembershipRequest(db.client, MEMBERSHIP_INPUT);

    assert.equal(result.success, true);
    assert.equal(result.created, true);
    assert.equal(result.membershipStatus, "pending");

    const inserts = db.callsFor("store_memberships", "insert");
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].payload.user_id, USER_ID);
    assert.equal(inserts[0].payload.store_id, STORE_ID);
    assert.equal(inserts[0].payload.franchise_id, FRANCHISE_ID);
    assert.equal(inserts[0].payload.status, "pending");
  });

  test("매장을 찾지 못하면 멤버십을 만들지 않는다", async () => {
    const db = fakeClient({ stores: [] });
    const result = await submitStoreMembershipRequest(db.client, MEMBERSHIP_INPUT);

    assert.equal(result.success, false);
    assert.equal(db.callsFor("store_memberships", "insert").length, 0);
  });
});

describe("resolveOwnerRequestHqRecipientIds - 점주 신청 알림은 매장 브랜드 HQ에게만", () => {
  const M_STORE = "aaaaaaaa-0000-4000-8000-000000000001";
  const B_STORE = "bbbbbbbb-0000-4000-8000-000000000001";
  const NO_BRAND_STORE = "cccccccc-0000-4000-8000-000000000001";
  const M_FRANCHISE = FRANCHISE_ID;
  const B_FRANCHISE = OTHER_FRANCHISE_ID;
  const M_HQ = "aaaaaaaa-1111-4111-8111-000000000001";
  const M_HQ2 = "aaaaaaaa-1111-4111-8111-000000000002";
  const B_HQ = "bbbbbbbb-1111-4111-8111-000000000001";
  const MULTI_HQ = "dddddddd-1111-4111-8111-000000000001";
  const LEGACY_HQ = "eeeeeeee-1111-4111-8111-000000000001";
  const M_OWNER = "ffffffff-1111-4111-8111-000000000001";

  /** stores + profiles(마스터 id=user_id, 브랜드별 행은 별도 id)만 흉내낸 가짜 DB. */
  function recipientDb(options: { storeError?: boolean; profileError?: boolean } = {}) {
    const tables: Record<string, Row[]> = {
      stores: [
        { id: M_STORE, franchise_id: M_FRANCHISE },
        { id: B_STORE, franchise_id: B_FRANCHISE },
        { id: NO_BRAND_STORE, franchise_id: null },
      ],
      profiles: [
        { id: M_HQ, user_id: M_HQ, role: "hq", brand_id: M_FRANCHISE },
        { id: M_HQ2, user_id: M_HQ2, role: "hq", brand_id: M_FRANCHISE },
        { id: B_HQ, user_id: B_HQ, role: "hq", brand_id: B_FRANCHISE },
        // 같은 HQ 사용자의 마스터 행 + 브랜드별 행
        { id: MULTI_HQ, user_id: MULTI_HQ, role: "hq", brand_id: M_FRANCHISE },
        { id: "dddddddd-2222-4222-8222-000000000001", user_id: MULTI_HQ, role: "hq", brand_id: M_FRANCHISE },
        { id: "dddddddd-2222-4222-8222-000000000002", user_id: MULTI_HQ, role: "hq", brand_id: B_FRANCHISE },
        // 023 이전 행(user_id 없음)은 마스터 id를 auth 사용자로 쓴다
        { id: LEGACY_HQ, role: "hq", brand_id: M_FRANCHISE },
        // 같은 브랜드의 점주 브랜드 행은 수신자가 아니다
        { id: "ffffffff-2222-4222-8222-000000000001", user_id: M_OWNER, role: "owner", brand_id: M_FRANCHISE },
      ],
    };
    const queried: string[] = [];

    const client = {
      from(table: string) {
        queried.push(table);
        const filters: Row = {};
        const builder = {
          select: () => builder,
          eq(column: string, value: unknown) {
            filters[column] = value;
            return builder;
          },
          maybeSingle() {
            if (table === "stores" && options.storeError) {
              return Promise.resolve({ data: null, error: { code: "500", message: "store lookup failed" } });
            }
            const found = tables[table].find((row) => Object.entries(filters).every(([k, v]) => row[k] === v)) ?? null;
            return Promise.resolve({ data: found, error: null });
          },
          then(resolve: (value: unknown) => unknown) {
            if (table === "profiles" && options.profileError) {
              return Promise.resolve({ data: null, error: { code: "500", message: "x" } }).then(resolve);
            }
            const rows = tables[table].filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v));
            return Promise.resolve({ data: rows.map(({ id, user_id }) => ({ id, user_id })), error: null }).then(resolve);
          },
        };
        return builder;
      },
    } as unknown as SupabaseClient;

    return { client, queried };
  }

  test("M Coffee 매장 신청 → M Coffee HQ만, 복수 프로필 HQ도 1번만", async () => {
    const { client } = recipientDb();
    const recipients = await resolveOwnerRequestHqRecipientIds(client, M_STORE);

    assert.deepEqual([...recipients].sort(), [M_HQ, M_HQ2, MULTI_HQ, LEGACY_HQ].sort());
    assert.equal(recipients.includes(B_HQ), false);
    assert.equal(recipients.includes(M_OWNER), false);
    assert.equal(recipients.length, new Set(recipients).size);
  });

  test("B Burger 매장 신청 → B Burger HQ만 (M Coffee 전용 HQ 0건)", async () => {
    const { client } = recipientDb();
    const recipients = await resolveOwnerRequestHqRecipientIds(client, B_STORE);

    assert.deepEqual([...recipients].sort(), [B_HQ, MULTI_HQ].sort());
    for (const mOnly of [M_HQ, M_HQ2, LEGACY_HQ]) {
      assert.equal(recipients.includes(mOnly), false);
    }
  });

  test("매장 브랜드가 없거나 매장을 찾지 못하면 0건이고 HQ 조회를 하지 않는다", async () => {
    for (const storeId of [NO_BRAND_STORE, "99999999-0000-4000-8000-000000000000"]) {
      const { client, queried } = recipientDb();
      assert.deepEqual(await resolveOwnerRequestHqRecipientIds(client, storeId), []);
      assert.deepEqual(queried, ["stores"]);
    }
  });

  test("매장·HQ 조회 오류는 전체 HQ로 넘어가지 않고 0건", async () => {
    assert.deepEqual(await resolveOwnerRequestHqRecipientIds(recipientDb({ storeError: true }).client, M_STORE), []);
    assert.deepEqual(await resolveOwnerRequestHqRecipientIds(recipientDb({ profileError: true }).client, M_STORE), []);
  });
});
