import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MembershipAuthNotReadyError,
  ensureBrandProfileForApprovedMembership,
  requireConfirmedMembershipAuthUser,
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
  profileInsertError?: { code: string; message: string; details?: string; hint?: string };
  brandInsertThrows?: boolean;
  membershipUpdateError?: { code: string; message: string };
  missingAuthUser?: boolean;
  unconfirmedAuthUser?: boolean;
  raceBrandInsert?: boolean;
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
      limit(count: number) {
        const rows = tables[table].filter((row) => matches(row, filters)).slice(0, count);
        return Promise.resolve({ data: rows.map((row) => ({ ...row })), error: null });
      },
    };
    return builder;
  }

  const client = {
    auth: { admin: { getUserById: async () => ({
      data: { user: options.missingAuthUser ? null : {
        id: USER_ID, email: "Owner@Example.com",
        email_confirmed_at: options.unconfirmedAuthUser ? null : "2026-09-29T00:00:00Z",
        user_metadata: { name: "김점주", phone: "01011112222" },
      } }, error: null,
    }) } },
    from(table: string) {
      if (!tables[table]) {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select: () => makeSelect(table),
        insert(payload: Row) {
          if (table === "profiles" && options.brandInsertThrows && payload.brand_id) {
            throw new Error("Brand insert failed for owner@example.com");
          }
          if (table === "profiles" && options.profileInsertError) {
            if (options.raceBrandInsert && payload.brand_id) {
              tables.profiles.push({ ...payload, id: "concurrent-brand-profile" });
            }
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
    assert.equal(inserts[0].payload.brand_id, null);
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

describe("ensureBrandProfileForApprovedMembership - 누락된 마스터", () => {
  const approvedMembership = {
    id: MEMBERSHIP_ID, user_id: USER_ID, store_id: STORE_ID, role: "owner", status: "approved",
    franchise_id: FRANCHISE_ID, approved_at: "2026-09-29T00:00:00Z", approved_by: "hq-user",
  };

  test("Auth 사용자와 승인된 점주 멤버십을 확인한 뒤 마스터와 브랜드 행을 각각 insert한다", async () => {
    const db = fakeClient({ stores: [STORE_ROW], memberships: [approvedMembership] });
    assert.equal(await ensureBrandProfileForApprovedMembership(db.client, USER_ID, STORE_ID), true);

    const inserts = db.callsFor("profiles", "insert");
    assert.equal(inserts.length, 2);
    assert.deepEqual({ id: inserts[0].payload.id, user_id: inserts[0].payload.user_id,
      brand_id: inserts[0].payload.brand_id, role: inserts[0].payload.role },
    { id: USER_ID, user_id: USER_ID, brand_id: null, role: "owner" });
    assert.equal(inserts[1].payload.user_id, USER_ID);
    assert.equal(inserts[1].payload.brand_id, FRANCHISE_ID);
    assert.equal(inserts[1].payload.role, "owner");
    assert.notEqual(inserts[1].payload.id, USER_ID);
    assert.equal(db.callsFor("profiles", "update").length, 0);
    for (const { payload } of inserts) {
      assert.equal("created_at" in payload, false);
      assert.equal("updated_at" in payload, false);
    }
  });

  test("디버그를 켰을 때만 INSERT의 Auth user_id와 독립 브랜드 프로필 ID를 보여준다", async () => {
    const db = fakeClient({ stores: [STORE_ROW], memberships: [approvedMembership] });
    const originalFlag = process.env.DEBUG_PROFILE_INSERT;
    const originalInfo = console.info;
    const logs: unknown[][] = [];
    process.env.DEBUG_PROFILE_INSERT = "true";
    console.info = (...args: unknown[]) => { logs.push(args); };
    try {
      assert.equal(await ensureBrandProfileForApprovedMembership(db.client, USER_ID, STORE_ID), true);
    } finally {
      console.info = originalInfo;
      if (originalFlag === undefined) delete process.env.DEBUG_PROFILE_INSERT;
      else process.env.DEBUG_PROFILE_INSERT = originalFlag;
    }
    assert.equal(logs.length, 2);
    assert.equal(logs[0][1], USER_ID);
    assert.equal(logs[1][1], USER_ID);
    assert.equal((logs[0][2] as { profileId: string }).profileId, USER_ID);
    assert.notEqual((logs[1][2] as { profileId: string }).profileId, USER_ID);
  });

  test("Auth 사용자가 없으면 명확한 오류를 반환하고 프로필 insert를 시도하지 않는다", async () => {
    const db = fakeClient({ stores: [STORE_ROW], memberships: [approvedMembership], missingAuthUser: true });
    await assert.rejects(ensureBrandProfileForApprovedMembership(db.client, USER_ID, STORE_ID),
      (error: unknown) => error instanceof MembershipAuthNotReadyError && /인증 또는 계정 생성/.test(error.message));
    assert.equal(db.callsFor("profiles", "insert").length, 0);
  });

  test("미인증 Auth 사용자는 프로필을 만들지 않는다", async () => {
    const db = fakeClient({ stores: [STORE_ROW], memberships: [approvedMembership], unconfirmedAuthUser: true });
    await assert.rejects(ensureBrandProfileForApprovedMembership(db.client, USER_ID, STORE_ID), MembershipAuthNotReadyError);
    assert.equal(db.callsFor("profiles", "insert").length, 0);
  });

  test("UUID가 아닌 사용자 ID는 프로필을 만들지 않는다", async () => {
    const db = fakeClient({ stores: [STORE_ROW], memberships: [{ ...approvedMembership, user_id: "[id]" }] });
    await assert.rejects(ensureBrandProfileForApprovedMembership(db.client, "[id]", STORE_ID), MembershipAuthNotReadyError);
    assert.equal(db.callsFor("profiles", "insert").length, 0);
  });

  test("마스터 insert 실패 시 브랜드 행은 생성하지 않고 안전한 오류 코드만 남긴다", async () => {
    const db = fakeClient({
      stores: [STORE_ROW], memberships: [approvedMembership],
      profileInsertError: { code: "23502", message: "owner@example.com is missing" },
    });
    const calls: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { calls.push(args); };
    try {
      assert.equal(await ensureBrandProfileForApprovedMembership(db.client, USER_ID, STORE_ID), false);
    } finally {
      console.error = original;
    }
    assert.equal(db.callsFor("profiles", "insert").length, 1);
    assert.equal(db.tables.profiles.length, 0);
    assert.match(JSON.stringify(calls), /23502/);
    assert.equal(JSON.stringify(calls).includes("owner@example.com"), false);
  });

  test("브랜드 insert FK 실패는 제약명과 코드를 한 번만 기록하고 민감한 값은 가린다", async () => {
    const db = fakeClient({
      profiles: [{ id: USER_ID, user_id: USER_ID, brand_id: null, role: "owner",
        email: "owner@example.com", approved_at: "2026-09-29T00:00:00Z", approved_by: "hq-user" }],
      stores: [STORE_ROW], memberships: [approvedMembership],
      profileInsertError: { code: "23503", message: 'constraint "profiles_id_fkey" for owner@example.com',
        details: `Key (id)=(${USER_ID}) is not present` },
    });
    const calls: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { calls.push(args); };
    try {
      assert.equal(await ensureBrandProfileForApprovedMembership(db.client, USER_ID, STORE_ID), false);
    } finally {
      console.error = original;
    }
    assert.equal(calls.length, 1);
    assert.match(JSON.stringify(calls), /23503.*profiles_id_fkey|profiles_id_fkey.*23503/);
    assert.equal(JSON.stringify(calls).includes("owner@example.com"), false);
    assert.equal(JSON.stringify(calls).includes(USER_ID), false);
    assert.match(JSON.stringify(calls), /\[redacted-uuid\]/);
    assert.equal(JSON.stringify(calls).includes("([id])"), false);
    assert.match(JSON.stringify(calls), /generated_brand_profile/);
    assert.match(JSON.stringify(calls), /legacy profiles\.id FK/);
    assert.equal(db.callsFor("profiles", "update").length, 0);
  });

  test("23505 경쟁으로 브랜드 행이 생겼을 때만 해당 행을 찾아 갱신한다", async () => {
    const db = fakeClient({
      profiles: [{ id: USER_ID, user_id: USER_ID, brand_id: null, role: "owner",
        email: "owner@example.com", approved_at: "2026-09-29T00:00:00Z" }],
      stores: [STORE_ROW], memberships: [approvedMembership], raceBrandInsert: true,
      profileInsertError: { code: "23505", message: "duplicate brand profile" },
    });
    assert.equal(await ensureBrandProfileForApprovedMembership(db.client, USER_ID, STORE_ID), true);
    assert.equal(db.callsFor("profiles", "update")[0].filters.id, "concurrent-brand-profile");
    assert.equal(db.tables.profiles.filter((profile) => profile.brand_id === FRANCHISE_ID).length, 1);
  });

  test("23505가 발생했어도 해당 브랜드 행이 없으면 성공으로 처리하지 않는다", async () => {
    const db = fakeClient({
      profiles: [{ id: USER_ID, user_id: USER_ID, brand_id: null, role: "owner",
        email: "owner@example.com", approved_at: "2026-09-29T00:00:00Z" }],
      stores: [STORE_ROW], memberships: [approvedMembership],
      profileInsertError: { code: "23505", message: 'constraint "profiles_email_lower_key"' },
    });
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal(await ensureBrandProfileForApprovedMembership(db.client, USER_ID, STORE_ID), false);
    } finally {
      console.error = original;
    }
    assert.equal(db.callsFor("profiles", "update").length, 0);
  });

  test("브랜드 insert 예외도 민감정보를 가린 메시지와 스택으로 진단한다", async () => {
    const db = fakeClient({
      profiles: [{ id: USER_ID, user_id: USER_ID, brand_id: null, role: "owner",
        email: "owner@example.com", approved_at: "2026-09-29T00:00:00Z" }],
      stores: [STORE_ROW], memberships: [approvedMembership], brandInsertThrows: true,
    });
    const calls: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { calls.push(args); };
    try {
      assert.equal(await ensureBrandProfileForApprovedMembership(db.client, USER_ID, STORE_ID), false);
    } finally {
      console.error = original;
    }
    assert.equal(calls.length, 1);
    assert.match(JSON.stringify(calls), /Brand insert failed for \[email\]/);
    assert.equal(JSON.stringify(calls).includes("owner@example.com"), false);
  });
});

test("028 moves the auth FK from profile id to user_id without removing valid user references", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/028_repair_brand_profile_auth_user_fk.sql", import.meta.url), "utf8");
  assert.match(sql, /column_row\.attname = 'id'/);
  assert.match(sql, /alter table public\.profiles drop constraint %I/);
  assert.match(sql, /column_row\.attname = 'user_id'/);
  assert.match(sql, /foreign key \(user_id\) references auth\.users\(id\) on delete cascade/);
  assert.match(sql, /where profile\.user_id is null[\s\S]*?not exists/);
  assert.match(sql, /alter table public\.profiles alter column user_id set not null/);
});

test("HQ and owner APIs validate Auth before changing membership approval", () => {
  for (const relative of ["../../app/api/hq/approvals/route.ts", "../../app/api/boss/employees/[id]/route.ts"]) {
    const route = readFileSync(new URL(relative, import.meta.url), "utf8");
    const approvalUpdate = route.indexOf(".update(update");
    assert.ok(approvalUpdate > route.indexOf("await requireConfirmedMembershipAuthUser("), relative);
    assert.match(route, /authError instanceof MembershipAuthNotReadyError/);
    assert.match(route, /status: 409/);
  }
});

test("HQ request membershipId selects the membership row; user_id comes from the database", () => {
  const route = readFileSync(new URL("../../app/api/hq/approvals/route.ts", import.meta.url), "utf8");
  assert.match(route, /\.from\("store_memberships"\)[\s\S]*?\.eq\("id", body\.membershipId\.trim\(\)\)/);
  assert.match(route, /ensureBrandProfileForApprovedMembership\([\s\S]*?updated\.user_id/);
  assert.match(route, /membershipUserId: membership\.user_id,\s*authUserId: authUser\.id/);
  assert.equal(/body\.(userId|user_id|member_id)/.test(route), false);
});

test("placeholder user ID is rejected before any database lookup", async () => {
  const db = fakeClient();
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    await assert.rejects(requireConfirmedMembershipAuthUser(db.client, "[id]"), MembershipAuthNotReadyError);
  } finally {
    console.warn = original;
  }
  assert.deepEqual(warnings, [["[AUTH] STORE_MEMBERSHIP_USER_ID_INVALID", { reason: "not_uuid" }]]);
  assert.equal(db.calls.length, 0);
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
  // 직원 신청은 그 매장의 승인된 점주가 받는다.
  const approvedOwnerMembership = {
    id: "99999999-9999-4999-8999-999999999999",
    user_id: "88888888-8888-4888-8888-888888888888",
    store_id: STORE_ID,
    role: "owner",
    status: "approved",
    franchise_id: FRANCHISE_ID,
  };

  test("승인된 점주가 없는 매장은 직원 신청을 만들지 않는다 (STORE_NO_OWNER)", async () => {
    const db = fakeClient({
      stores: [STORE_ROW],
      memberships: [{ ...approvedOwnerMembership, status: "pending" }],
    });
    const result = await submitStoreMembershipRequest(db.client, MEMBERSHIP_INPUT);

    assert.equal(result.success, false);
    assert.equal(result.code, "STORE_NO_OWNER");
    assert.equal(result.status, 409);
    assert.equal(db.callsFor("store_memberships", "insert").length, 0);
  });

  test("멤버십이 없으면 pending으로 만들고 created:true를 돌려준다", async () => {
    const db = fakeClient({ stores: [STORE_ROW], memberships: [approvedOwnerMembership] });
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
