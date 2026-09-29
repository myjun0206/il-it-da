import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EMAIL_EXISTS_MESSAGE,
  INVALID_EMAIL_MESSAGE,
  RATE_LIMITED_MESSAGE,
  SIGNUP_FAILED_MESSAGE,
  WEAK_PASSWORD_MESSAGE,
  runSignup,
  type SignupRequestBody,
} from "../../lib/auth/signup-service.ts";

// 가짜 값만 쓴다. 실제 Supabase/Auth는 호출하지 않는다.
const USER_ID = "11111111-1111-4111-8111-111111111111";
const BRAND_ID = "33333333-3333-4333-8333-333333333333";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const EMAIL = "signup-test@example.com";
const PHONE = "010-0000-0000";
const NAME = "테스트사용자";

const SENSITIVE = [EMAIL, PHONE, NAME, USER_ID, "Failing row", "23502", "user_id", "details", "hook"];

type Row = Record<string, unknown>;
type FakeError = Record<string, unknown>;

interface FakeOptions {
  verification?: Row | null;
  verificationError?: FakeError;
  createUserError?: FakeError;
  createUserThrows?: boolean;
  createUserNoId?: boolean;
  profileInsertError?: FakeError;
  profileDeleteError?: FakeError;
  approvalInsertError?: FakeError;
  deleteUserError?: FakeError;
  deleteUserThrows?: boolean;
}

function fakeAdmin(options: FakeOptions = {}) {
  const calls = {
    createUser: [] as Row[],
    deleteUser: [] as string[],
    profileInserts: [] as Row[],
    profileDeletes: [] as Row[],
    approvalInserts: [] as Row[][],
  };
  const verification = options.verification === undefined
    ? { id: "v1", is_verified: true, expires_at: new Date(Date.now() + 60_000).toISOString() }
    : options.verification;

  const client = {
    from(table: string) {
      if (table === "email_verifications") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve(
            options.verificationError
              ? { data: null, error: options.verificationError }
              : { data: verification, error: null },
          ),
        };
        return chain;
      }
      if (table === "profiles") {
        return {
          insert(row: Row) {
            calls.profileInserts.push(row);
            return Promise.resolve({ error: options.profileInsertError ?? null });
          },
          delete() {
            return {
              eq(column: string, value: unknown) {
                calls.profileDeletes.push({ [column]: value });
                return Promise.resolve({ error: options.profileDeleteError ?? null });
              },
            };
          },
        };
      }
      if (table === "store_approval_requests") {
        return {
          insert(rows: Row[]) {
            calls.approvalInserts.push(rows);
            return Promise.resolve({ error: options.approvalInsertError ?? null });
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    auth: {
      admin: {
        createUser(payload: Row) {
          calls.createUser.push(payload);
          if (options.createUserThrows) return Promise.reject(new Error(`network failure for ${EMAIL}`));
          if (options.createUserError) return Promise.resolve({ data: { user: null }, error: options.createUserError });
          return Promise.resolve({ data: { user: options.createUserNoId ? {} : { id: USER_ID } }, error: null });
        },
        deleteUser(userId: string) {
          calls.deleteUser.push(userId);
          if (options.deleteUserThrows) return Promise.reject(new Error("delete failed"));
          return Promise.resolve({ data: null, error: options.deleteUserError ?? null });
        },
      },
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

function hqBody(overrides: SignupRequestBody = {}): SignupRequestBody {
  return { email: EMAIL, password: "Str0ng-pass!", name: NAME, phone: PHONE, role: "hq", brandId: BRAND_ID, ...overrides };
}

function assertNoSensitiveDetail(body: unknown): void {
  const serialized = JSON.stringify(body);
  for (const leak of SENSITIVE) {
    assert.equal(serialized.includes(leak), false, `response leaks ${leak}: ${serialized}`);
  }
}

const DB_NOT_NULL_ERROR = {
  code: "23502",
  message: 'null value in column "user_id" of relation "profiles" violates not-null constraint',
  details: `Failing row contains (${USER_ID}, ${EMAIL}, ${NAME}, hq, ${PHONE}).`,
  hint: null,
};

let logged: { code: string; error: unknown }[] = [];
const log = (code: string, error: unknown) => logged.push({ code, error });
beforeEach(() => {
  logged = [];
});

describe("runSignup 정상 가입 (프로필 데이터 계약)", () => {
  test("신규 HQ: 201, id/user_id 동일, 선택 브랜드·approved, 가입 직후 로그인 시도", async () => {
    const { client, calls } = fakeAdmin();
    const signIns: string[] = [];
    const result = await runSignup(hqBody(), {
      admin: client,
      log,
      signInHq: async (email) => {
        signIns.push(email);
        return { error: null };
      },
    });

    assert.deepEqual(result, { status: 201, body: { userId: USER_ID, role: "hq", sessionEstablished: true } });
    assert.equal(calls.profileInserts.length, 1);
    const row = calls.profileInserts[0];
    assert.equal(row.id, USER_ID);
    assert.equal(row.user_id, USER_ID);
    assert.equal(row.role, "hq");
    assert.equal(row.brand_id, BRAND_ID);
    assert.equal(row.approval_status, "approved");
    assert.equal(typeof row.approved_at, "string");
    assert.deepEqual(signIns, [EMAIL]);
    assert.deepEqual(calls.deleteUser, []);
  });

  test("HQ 가입 직후 로그인이 오류를 돌려주면 201 + sessionEstablished=false, 계정은 정리하지 않는다", async () => {
    const { client, calls } = fakeAdmin();
    const result = await runSignup(hqBody(), {
      admin: client,
      log,
      signInHq: async () => ({ error: { message: "invalid" } }),
    });
    assert.deepEqual(result, { status: 201, body: { userId: USER_ID, role: "hq", sessionEstablished: false } });
    assert.deepEqual(calls.deleteUser, []);
    assert.deepEqual(calls.profileDeletes, []);
    assert.deepEqual(logged.map((entry) => entry.code), ["SIGNUP_POST_SIGNIN_FAILED"]);
  });

  test("HQ 가입 직후 로그인이 예외를 던져도 500이 아니라 201 + sessionEstablished=false", async () => {
    const { client, calls } = fakeAdmin();
    const result = await runSignup(hqBody(), {
      admin: client,
      log,
      signInHq: async () => {
        throw new Error(`cookie write failed for ${EMAIL}`);
      },
    });
    assert.deepEqual(result, { status: 201, body: { userId: USER_ID, role: "hq", sessionEstablished: false } });
    assert.deepEqual(calls.deleteUser, []);
    assertNoSensitiveDetail({ role: result.body.role, sessionEstablished: result.body.sessionEstablished });
  });

  test("로그인 의존성이 없으면 HQ는 sessionEstablished=false로 응답한다", async () => {
    const { client } = fakeAdmin();
    const result = await runSignup(hqBody(), { admin: client, log });
    assert.equal(result.body.sessionEstablished, false);
  });

  test("boss는 owner로 저장되고 brand_id 없이 pending, 선택 매장 승인 요청을 만든다", async () => {
    const { client, calls } = fakeAdmin();
    const signIns: string[] = [];
    const result = await runSignup(
      { ...hqBody({ role: "boss" }), selectedStores: [{ storeId: STORE_ID, storeName: "테스트점" }] },
      { admin: client, log, signInHq: async (email) => { signIns.push(email); return { error: null }; } },
    );

    // 점주·직원은 자동 로그인 대상이 아니므로 응답 계약도 그대로다.
    assert.deepEqual(result, { status: 201, body: { userId: USER_ID, role: "owner" } });
    assert.deepEqual(signIns, []);
    const row = calls.profileInserts[0];
    assert.equal(row.user_id, USER_ID);
    assert.equal(row.role, "owner");
    assert.equal(row.brand_id, null);
    assert.equal(row.approval_status, "pending");
    assert.equal(calls.approvalInserts[0][0].requester_role, "owner");
    assert.equal(calls.approvalInserts[0][0].store_id, STORE_ID);
  });

  test("staff도 user_id를 채워 pending으로 만든다", async () => {
    const { client, calls } = fakeAdmin();
    const result = await runSignup(hqBody({ role: "staff", selectedStoreIds: [STORE_ID] }), { admin: client, log });

    assert.equal(result.status, 201);
    assert.equal("sessionEstablished" in result.body, false);
    assert.equal(calls.profileInserts[0].user_id, USER_ID);
    assert.equal(calls.profileInserts[0].approval_status, "pending");
    assert.equal(calls.approvalInserts[0][0].requester_role, "staff");
  });
});

describe("runSignup createUser 오류 매핑 (허용 목록만 안내)", () => {
  const cases: { name: string; error: FakeError; status: number; message: string }[] = [
    { name: "이미 가입된 이메일", error: { status: 422, code: "email_exists", message: `A user with ${EMAIL} already exists` }, status: 409, message: EMAIL_EXISTS_MESSAGE },
    { name: "비밀번호 규칙 위반", error: { status: 422, code: "weak_password", message: `Password is known to be weak (${EMAIL})` }, status: 400, message: WEAK_PASSWORD_MESSAGE },
    { name: "이메일 주소 거부", error: { status: 400, code: "email_address_invalid", message: `Email ${EMAIL} is invalid` }, status: 400, message: INVALID_EMAIL_MESSAGE },
    { name: "요청 한도 초과", error: { status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" }, status: 429, message: RATE_LIMITED_MESSAGE },
    { name: "hook이 돌려준 4xx 원문", error: { status: 400, code: "hook_payload_invalid", message: `before-user-created hook rejected ${EMAIL} ${PHONE}` }, status: 500, message: SIGNUP_FAILED_MESSAGE },
    { name: "코드 없는 4xx 원문", error: { status: 422, message: `Database error: Failing row contains (${EMAIL})` }, status: 500, message: SIGNUP_FAILED_MESSAGE },
    { name: "DB 트리거 5xx", error: { status: 500, code: "unexpected_failure", message: "Database error creating new user" }, status: 500, message: SIGNUP_FAILED_MESSAGE },
  ];

  for (const { name, error, status, message } of cases) {
    test(`${name} → ${status} 고정 문구, 원문 비노출`, async () => {
      const { client, calls } = fakeAdmin({ createUserError: error });
      const result = await runSignup(hqBody(), { admin: client, log });

      assert.equal(result.status, status);
      assert.equal(result.body.error, message);
      assert.equal("detail" in result.body, false);
      assertNoSensitiveDetail(result.body);
      assert.deepEqual(calls.profileInserts, []);
    });
  }

  test("createUser 예외도 고정 문구 500", async () => {
    const { client } = fakeAdmin({ createUserThrows: true });
    const result = await runSignup(hqBody(), { admin: client, log });
    assert.deepEqual(result, { status: 500, body: { error: SIGNUP_FAILED_MESSAGE } });
  });
});

describe("runSignup DB 오류 (failing row 비노출 + Auth 사용자 정리)", () => {
  test("profiles INSERT 23502 → 500 고정 문구, 생성된 Auth 사용자 삭제", async () => {
    const { client, calls } = fakeAdmin({ profileInsertError: DB_NOT_NULL_ERROR });
    const result = await runSignup(hqBody(), { admin: client, log });

    assert.deepEqual(result, { status: 500, body: { error: SIGNUP_FAILED_MESSAGE } });
    assertNoSensitiveDetail(result.body);
    assert.deepEqual(calls.deleteUser, [USER_ID]);
    assert.deepEqual(logged.map((entry) => entry.code), ["SIGNUP_PROFILE_INSERT_FAILED"]);
  });

  test("정리(deleteUser)가 오류를 돌려주면 응답은 같고 고정 코드로 기록한다", async () => {
    const { client, calls } = fakeAdmin({ profileInsertError: DB_NOT_NULL_ERROR, deleteUserError: { status: 500, message: "x" } });
    const result = await runSignup(hqBody(), { admin: client, log });

    assert.deepEqual(result, { status: 500, body: { error: SIGNUP_FAILED_MESSAGE } });
    assert.deepEqual(calls.deleteUser, [USER_ID]);
    assert.deepEqual(logged.map((entry) => entry.code), ["SIGNUP_PROFILE_INSERT_FAILED", "SIGNUP_ROLLBACK_DELETE_USER_FAILED"]);
  });

  test("정리(deleteUser)가 예외를 던져도 응답은 같다", async () => {
    const { client } = fakeAdmin({ profileInsertError: DB_NOT_NULL_ERROR, deleteUserThrows: true });
    const result = await runSignup(hqBody(), { admin: client, log });

    assert.deepEqual(result, { status: 500, body: { error: SIGNUP_FAILED_MESSAGE } });
    assert.ok(logged.some((entry) => entry.code === "SIGNUP_ROLLBACK_DELETE_USER_FAILED"));
  });

  test("매장 승인 요청 INSERT 실패 → profiles 삭제 + Auth 사용자 삭제, 고정 문구", async () => {
    const { client, calls } = fakeAdmin({ approvalInsertError: { code: "23503", message: "fk", details: `Key (store_id)=(${STORE_ID})` } });
    const result = await runSignup(hqBody({ role: "owner", selectedStoreIds: [STORE_ID] }), { admin: client, log });

    assert.deepEqual(result, { status: 500, body: { error: SIGNUP_FAILED_MESSAGE } });
    assert.equal(JSON.stringify(result.body).includes(STORE_ID), false);
    assert.deepEqual(calls.profileDeletes, [{ id: USER_ID }]);
    assert.deepEqual(calls.deleteUser, [USER_ID]);
  });

  test("매장 승인 롤백 중 profiles 삭제 실패도 기록하고 Auth 사용자 삭제는 계속한다", async () => {
    const { client, calls } = fakeAdmin({
      approvalInsertError: { code: "23503", message: "fk" },
      profileDeleteError: { code: "500", message: "x" },
    });
    const result = await runSignup(hqBody({ role: "owner", selectedStoreIds: [STORE_ID] }), { admin: client, log });

    assert.equal(result.status, 500);
    assert.deepEqual(calls.deleteUser, [USER_ID]);
    assert.ok(logged.some((entry) => entry.code === "SIGNUP_ROLLBACK_PROFILE_DELETE_FAILED"));
  });

  test("이메일 인증 조회 DB 오류 → 500 고정 문구, 사용자 생성 안 함", async () => {
    const { client, calls } = fakeAdmin({ verificationError: DB_NOT_NULL_ERROR });
    const result = await runSignup(hqBody(), { admin: client, log });

    assert.deepEqual(result, { status: 500, body: { error: SIGNUP_FAILED_MESSAGE } });
    assert.deepEqual(calls.createUser, []);
  });

  test("createUser가 id 없이 성공하면 500 고정 문구", async () => {
    const { client, calls } = fakeAdmin({ createUserNoId: true });
    const result = await runSignup(hqBody(), { admin: client, log });

    assert.deepEqual(result, { status: 500, body: { error: SIGNUP_FAILED_MESSAGE } });
    assert.deepEqual(calls.profileInserts, []);
  });
});

describe("runSignup 입력·인증 검증 (기존 응답 유지)", () => {
  test("필수값 누락·이메일 형식·짧은 비밀번호는 400", async () => {
    const { client, calls } = fakeAdmin();
    assert.equal((await runSignup({ ...hqBody(), role: "admin" }, { admin: client, log })).status, 400);
    assert.equal((await runSignup(hqBody({ email: "not-an-email" }), { admin: client, log })).status, 400);
    assert.equal((await runSignup(hqBody({ password: "short" }), { admin: client, log })).status, 400);
    assert.deepEqual(calls.createUser, []);
  });

  test("이메일 미인증은 400 + 고정 detail", async () => {
    const { client, calls } = fakeAdmin({ verification: null });
    const result = await runSignup(hqBody(), { admin: client, log });

    assert.deepEqual(result, {
      status: 400,
      body: { error: "Email verification is required.", detail: "No email verification record was found." },
    });
    assert.deepEqual(calls.createUser, []);
  });
});

describe("기본 로거(logSafeAuthError) 사용 시 서버 로그에도 상세가 남지 않는다", () => {
  const original = console.error;
  let output: string[] = [];

  beforeEach(() => {
    output = [];
    console.error = (...args: unknown[]) => {
      output.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    };
  });
  afterEach(() => {
    console.error = original;
  });

  test("profiles INSERT 실패 + 정리 실패", async () => {
    const { client } = fakeAdmin({ profileInsertError: DB_NOT_NULL_ERROR, deleteUserError: { status: 500, message: EMAIL } });
    await runSignup(hqBody(), { admin: client });

    const joined = output.join("\n");
    assert.match(joined, /SIGNUP_PROFILE_INSERT_FAILED/);
    assert.match(joined, /SIGNUP_ROLLBACK_DELETE_USER_FAILED/);
    for (const leak of [EMAIL, PHONE, NAME, USER_ID, "Failing row"]) {
      assert.equal(joined.includes(leak), false, `log leaks ${leak}`);
    }
  });
});
