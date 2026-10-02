import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";

import {
  createPasswordVerificationClient,
  verifyPasswordWithIsolatedClient,
} from "../../lib/auth/verify-password.ts";
import { getStaffConversationDetail, listStaffConversations } from "../../lib/staff/conversations.ts";
import {
  withdrawStaffMembership,
  deleteStaffAccount,
  hasPasswordLogin,
  clearStaffSessionKeys,
} from "../../lib/staff/staff-membership-service.ts";
import { submitStoreMembershipRequest } from "../../lib/signup/store-membership-service.ts";
import { removeStaffMembershipByOwner } from "../../lib/owner/remove-staff-membership.ts";
import { buildMasterApprovalUpdate } from "../../lib/signup/approval-recovery.ts";

const STAFF_USER_A = "11111111-1111-4111-8111-111111111111";
const STAFF_USER_B = "22222222-2222-4222-8222-222222222222";
const OWNER_USER = "33333333-3333-4333-8333-333333333333";
const HQ_USER = "44444444-4444-4444-8444-444444444444";

const STORE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BRAND_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Row = Record<string, unknown>;

function createFakeSupabase(initialState: {
  profiles?: Row[];
  store_memberships?: Row[];
  conversations?: Row[];
  conversation_messages?: Row[];
  notifications?: Row[];
  manuals?: Row[];
  stores?: Row[];
  franchises?: Row[];
  question_logs?: Row[];
  storageFiles?: string[];
  storageListError?: { message: string } | null;
  storageRemoveError?: { message: string } | null;
  failSelectTables?: string[];
  authDeleteError?: { message: string } | null;
  failProfileUpdate?: boolean;
  /** 035 미적용(PGRST202)을 흉낸다. */
  missingRemoveRpc?: boolean;
  /** RPC 호출 자체가 돌려주는 오류(네트워크·DB 오류). */
  removeRpcError?: { code?: string; message: string } | null;
  /** 가짜 RPC 트랜잭션 안에서 삭제 직후 실행. throw하면 롤백을 흉낸다. */
  duringRemoveTransaction?: (tables: Record<string, Row[]>) => void;
}) {
  const tables: Record<string, Row[]> = {
    profiles: (initialState.profiles ?? []).map((r) => ({ ...r })),
    store_memberships: (initialState.store_memberships ?? []).map((r) => ({ ...r })),
    conversations: (initialState.conversations ?? []).map((r) => ({ ...r })),
    conversation_messages: (initialState.conversation_messages ?? []).map((r) => ({ ...r })),
    notifications: (initialState.notifications ?? []).map((r) => ({ ...r })),
    manuals: (initialState.manuals ?? []).map((r) => ({ ...r })),
    stores: (initialState.stores ?? []).map((r) => ({ ...r })),
    franchises: (initialState.franchises ?? []).map((r) => ({ ...r })),
    question_logs: (initialState.question_logs ?? []).map((r) => ({ ...r })),
  };

  const storageFiles: string[] = [...(initialState.storageFiles ?? [])];
  const storageRemoved: string[] = [];
  const storageListCalls: { prefix: string; limit: number; offset: number }[] = [];
  const deletedAuthUserIds: string[] = [];
  const actionOrder: string[] = [];
  let failProfileUpdate = Boolean(initialState.failProfileUpdate);
  const rpcCalls: string[] = [];

  /**
   * 035 remove_staff_membership_by_owner의 가짜 모델. 실패하면 스냅샷으로 되돌려 트랜잭션 롤백을 흉낸다.
   * 실제 SQL을 실행하는 것이 아니므로 SQL 자체는 별도 정적 검사로만 확인한다.
   */
  const removeStaffRpcModel = (params: Row): { data: unknown; error: unknown } => {
    const snapshot = {
      store_memberships: tables.store_memberships.map((r) => ({ ...r })),
      profiles: tables.profiles.map((r) => ({ ...r })),
    };
    const rollback = (message: string, code = "P0001") => {
      tables.store_memberships = snapshot.store_memberships;
      tables.profiles = snapshot.profiles;
      return { data: null, error: { code, message } };
    };

    const owner = tables.store_memberships.find(
      (m) => m.user_id === params.p_owner_user_id && m.store_id === params.p_store_id && m.role === "owner" && m.status === "approved",
    );
    if (!owner) return { data: "forbidden", error: null };
    const target = tables.store_memberships.find((m) => m.id === params.p_membership_id && m.store_id === params.p_store_id);
    if (!target) return { data: "already_removed", error: null };
    if (target.role !== "staff") return { data: "not_staff", error: null };
    if (target.user_id === params.p_owner_user_id) return { data: "self_removal", error: null };
    if (target.status !== "approved") return { data: "not_approved", error: null };
    const profile = tables.profiles.find((p) => p.id === target.user_id);
    if (!profile) return rollback("STAFF_PROFILE_MISSING");

    tables.store_memberships = tables.store_memberships.filter((m) => m.id !== target.id);
    try {
      initialState.duringRemoveTransaction?.(tables);
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      return rollback(e instanceof Error ? e.message : "ERROR", typeof code === "string" ? code : "P0001");
    }
    if (failProfileUpdate) return rollback("STAFF_PROFILE_UPDATE_FAILED");

    Object.assign(profile, buildMasterApprovalUpdate(tables.store_memberships.filter((m) => m.user_id === target.user_id)));
    return { data: "removed", error: null };
  };

  const matches = (row: Row, filters: Row) =>
    Object.entries(filters).every(([k, v]) => row[k] === v);

  const client = {
    rpc: async (name: string, params: Row) => {
      rpcCalls.push(name);
      await Promise.resolve();
      if (name !== "remove_staff_membership_by_owner" || initialState.missingRemoveRpc) {
        return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      }
      if (initialState.removeRpcError) return { data: null, error: initialState.removeRpcError };
      return removeStaffRpcModel(params);
    },
    auth: {
      admin: {
        deleteUser: async (userId: string) => {
          actionOrder.push("auth.admin.deleteUser");
          if (initialState.authDeleteError) {
            return { error: initialState.authDeleteError };
          }
          deletedAuthUserIds.push(userId);
          // DB FK ON DELETE CASCADE 모사
          tables.profiles = tables.profiles.filter((p) => p.id !== userId && p.user_id !== userId);
          tables.store_memberships = tables.store_memberships.filter((m) => m.user_id !== userId);
          tables.notifications = tables.notifications.filter((n) => n.recipient_user_id !== userId);
          const userConvIds = tables.conversations.filter((c) => c.user_id === userId).map((c) => c.id);
          tables.conversations = tables.conversations.filter((c) => c.user_id !== userId);
          tables.conversation_messages = tables.conversation_messages.filter(
            (cm) => !userConvIds.includes(cm.conversation_id),
          );
          return { error: null };
        },
      },
    },
    storage: {
      from: () => ({
        list: async (prefix: string, options?: { limit?: number; offset?: number }) => {
          // 실제 storage-js처럼 limit 미지정 시 100개만 반환한다.
          const limit = options?.limit ?? 100;
          const offset = options?.offset ?? 0;
          storageListCalls.push({ prefix, limit, offset });
          if (initialState.storageListError) return { data: null, error: initialState.storageListError };
          const files = storageFiles
            .filter((f) => f.startsWith(`${prefix}/`))
            .sort()
            .slice(offset, offset + limit)
            .map((f) => ({ name: f.replace(`${prefix}/`, "") }));
          return { data: files, error: null };
        },
        remove: async (paths: string[]) => {
          actionOrder.push("storage.remove");
          if (initialState.storageRemoveError) return { data: null, error: initialState.storageRemoveError };
          storageRemoved.push(...paths);
          for (const p of paths) {
            const idx = storageFiles.indexOf(p);
            if (idx >= 0) storageFiles.splice(idx, 1);
          }
          return { data: paths, error: null };
        },
      }),
    },
    from: (table: string) => {
      if (!tables[table]) throw new Error(`Unexpected table: ${table}`);

      return {
        select: () => {
          const filters: Row = {};
          const inFilters: Record<string, unknown[]> = {};
          const selectError = initialState.failSelectTables?.includes(table)
            ? { code: "XX000", message: `select ${table} failed` }
            : null;
          const filtered = () =>
            tables[table].filter((r) => {
              if (!matches(r, filters)) return false;
              for (const [k, vals] of Object.entries(inFilters)) {
                if (!vals.includes(r[k])) return false;
              }
              return true;
            });
          const query = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return query;
            },
            in(col: string, vals: unknown[]) {
              inFilters[col] = vals;
              return query;
            },
            order: () => query,
            limit: (count: number) => {
              if (selectError) return Promise.resolve({ data: null, error: selectError });
              return Promise.resolve({ data: filtered().slice(0, count).map((r) => ({ ...r })), error: null });
            },
            maybeSingle: async () => {
              if (selectError) return { data: null, error: selectError };
              const found = filtered()[0];
              return { data: found ? { ...found } : null, error: null };
            },
            single: async () => {
              const found = tables[table].find((r) => matches(r, filters));
              return found ? { data: { ...found }, error: null } : { data: null, error: { code: "PGRST116" } };
            },
            then: (resolve: (v: unknown) => unknown) => {
              if (selectError) return Promise.resolve({ data: null, error: selectError }).then(resolve);
              return Promise.resolve({ data: filtered().map((r) => ({ ...r })), error: null }).then(resolve);
            },
          };
          return query;
        },
        update: (payload: Row) => {
          const filters: Row = {};
          const query = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return query;
            },
            then: (resolve: (v: unknown) => unknown) => {
              if (table === "profiles" && failProfileUpdate) {
                return Promise.resolve({ error: { message: "Profile update failed" } }).then(resolve);
              }
              for (const row of tables[table]) {
                if (matches(row, filters)) {
                  Object.assign(row, payload);
                }
              }
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return query;
        },
        insert: (payload: Row) => {
          const inserted = { id: `${table}-${Math.random().toString(36).slice(2, 8)}`, ...payload };
          tables[table].push(inserted);
          return {
            select: () => ({ single: () => Promise.resolve({ data: { ...inserted }, error: null }) }),
            then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
          };
        },
        delete: () => {
          const filters: Row = {};
          const inFilters: Record<string, unknown[]> = {};
          const query = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return query;
            },
            in(col: string, vals: unknown[]) {
              inFilters[col] = vals;
              return query;
            },
            select: () => {
              const deleted: Row[] = [];
              tables[table] = tables[table].filter((r) => {
                const match =
                  matches(r, filters) &&
                  Object.entries(inFilters).every(([k, vals]) => vals.includes(r[k]));
                if (match) {
                  deleted.push({ ...r });
                  return false;
                }
                return true;
              });
              return Promise.resolve({ data: deleted, error: null });
            },
          };
          return query;
        },
      };
    },
  } as unknown as SupabaseClient;

  return {
    client,
    tables,
    storageFiles,
    storageRemoved,
    storageListCalls,
    deletedAuthUserIds,
    actionOrder,
    setFailProfileUpdate: (val: boolean) => {
      failProfileUpdate = val;
    },
    rpcCalls,
  };
}

describe("직원 매장 탈퇴 (withdrawStaffMembership - 실제 함수 실행)", () => {
  test("시나리오 A: 두 매장 직원이 한 매장 탈퇴 -> 해당 매장만 삭제되고 다른 매장은 유지된다", async () => {
    const mem1 = {
      id: "mem-1",
      user_id: STAFF_USER_A,
      store_id: STORE_1,
      role: "staff",
      status: "approved",
    };
    const mem2 = {
      id: "mem-2",
      user_id: STAFF_USER_A,
      store_id: STORE_2,
      role: "staff",
      status: "approved",
    };
    const profile = {
      id: STAFF_USER_A,
      user_id: STAFF_USER_A,
      role: "staff",
      approval_status: "approved",
    };

    const { client, tables } = createFakeSupabase({
      profiles: [profile],
      store_memberships: [mem1, mem2],
    });

    // STORE_1 탈퇴 실행 (membershipId로 전달)
    const result = await withdrawStaffMembership(client, {
      userId: STAFF_USER_A,
      identifier: "mem-1",
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 200);

    // STORE_1 멤버십만 삭제됨
    assert.equal(tables.store_memberships.some((m) => m.id === "mem-1"), false);
    // STORE_2 멤버십은 그대로 유지
    const remaining = tables.store_memberships.find((m) => m.id === "mem-2");
    assert.ok(remaining);
    assert.equal(remaining.status, "approved");

    // 남은 승인 매장이 있으므로 마스터 프로필의 approval_status는 여전히 approved 유지
    const masterProfile = tables.profiles.find((p) => p.id === STAFF_USER_A);
    assert.equal(masterProfile?.approval_status, "approved");
  });

  test("시나리오 A-2: storeId로 요청해도 정상적으로 탈퇴된다 (식별자 호환성)", async () => {
    const mem1 = {
      id: "mem-1",
      user_id: STAFF_USER_A,
      store_id: STORE_1,
      role: "staff",
      status: "approved",
    };
    const { client, tables } = createFakeSupabase({
      profiles: [{ id: STAFF_USER_A, user_id: STAFF_USER_A, role: "staff", approval_status: "approved" }],
      store_memberships: [mem1],
    });

    const result = await withdrawStaffMembership(client, {
      userId: STAFF_USER_A,
      identifier: STORE_1, // storeId 전달
    });

    assert.equal(result.success, true);
    assert.equal(tables.store_memberships.length, 0);
  });

  test("시나리오 B: 마지막 승인 매장 탈퇴 -> 계정은 유지되고 마스터 approval_status는 rejected(미소속)로 동기화된다", async () => {
    const mem1 = {
      id: "mem-1",
      user_id: STAFF_USER_A,
      store_id: STORE_1,
      role: "staff",
      status: "approved",
    };
    const profile = {
      id: STAFF_USER_A,
      user_id: STAFF_USER_A,
      role: "staff",
      approval_status: "approved",
    };

    const { client, tables } = createFakeSupabase({
      profiles: [profile],
      store_memberships: [mem1],
    });

    const result = await withdrawStaffMembership(client, {
      userId: STAFF_USER_A,
      identifier: "mem-1",
    });

    assert.equal(result.success, true);
    // 멤버십은 0건
    assert.equal(tables.store_memberships.length, 0);
    // 계정(profiles)은 삭제되지 않고 존재
    const p = tables.profiles.find((row) => row.id === STAFF_USER_A);
    assert.ok(p, "계정 프로필은 유지되어야 한다");
    // 남은 멤버십이 0건이므로 마스터 approval_status는 rejected(미소속)
    assert.equal(p.approval_status, "rejected");
  });

  test("시나리오 C: 다른 사용자의 멤버십 탈퇴 시도 -> 404 차단", async () => {
    const memOfB = {
      id: "mem-b",
      user_id: STAFF_USER_B,
      store_id: STORE_1,
      role: "staff",
      status: "approved",
    };

    const { client, tables } = createFakeSupabase({
      store_memberships: [memOfB],
    });

    const result = await withdrawStaffMembership(client, {
      userId: STAFF_USER_A, // USER_A가 USER_B의 멤버십 삭제 시도
      identifier: "mem-b",
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 404);
    assert.equal(result.code, "NOT_FOUND");
    // 삭제되지 않고 유지됨
    assert.equal(tables.store_memberships.length, 1);
  });

  test("시나리오 C-2: 점주(owner) 역할의 멤버십 탈퇴 시도 -> 404 차단 (직원 전용)", async () => {
    const ownerMem = {
      id: "mem-owner",
      user_id: OWNER_USER,
      store_id: STORE_1,
      role: "owner",
      status: "approved",
    };

    const { client, tables } = createFakeSupabase({
      store_memberships: [ownerMem],
    });

    const result = await withdrawStaffMembership(client, {
      userId: OWNER_USER,
      identifier: "mem-owner",
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 404);
    assert.equal(tables.store_memberships.length, 1);
  });

  test("시나리오 E: 중복 탈퇴 또는 이미 탈퇴한 멤버십 재요청 -> 404 NOT_FOUND", async () => {
    const mem1 = {
      id: "mem-1",
      user_id: STAFF_USER_A,
      store_id: STORE_1,
      role: "staff",
      status: "approved",
    };
    const { client } = createFakeSupabase({
      store_memberships: [mem1],
    });

    // 첫 탈퇴
    const first = await withdrawStaffMembership(client, {
      userId: STAFF_USER_A,
      identifier: "mem-1",
    });
    assert.equal(first.success, true);

    // 중복 재요청
    const second = await withdrawStaffMembership(client, {
      userId: STAFF_USER_A,
      identifier: "mem-1",
    });
    assert.equal(second.success, false);
    assert.equal(second.status, 404);
    assert.equal(second.code, "NOT_FOUND");
  });

  test("중복 탈퇴 시 다른 매장 멤버십을 절대 삭제하지 않는다", async () => {
    const mem1 = { id: "mem-1", user_id: STAFF_USER_A, store_id: STORE_1, role: "staff", status: "approved" };
    const mem2 = { id: "mem-2", user_id: STAFF_USER_A, store_id: STORE_2, role: "staff", status: "approved" };
    const { client, tables } = createFakeSupabase({
      store_memberships: [mem1, mem2],
    });

    // STORE_1 탈퇴
    await withdrawStaffMembership(client, { userId: STAFF_USER_A, identifier: "mem-1" });
    // STORE_1 중복 탈퇴 재요청
    const second = await withdrawStaffMembership(client, { userId: STAFF_USER_A, identifier: "mem-1" });
    assert.equal(second.status, 404);

    // STORE_2 멤버십은 손상 없이 온전히 유지된다
    assert.equal(tables.store_memberships.length, 1);
    assert.equal(tables.store_memberships[0].id, "mem-2");
  });

  test("멤버십 삭제 후 마스터 상태 동기화가 실패한 경우, 재요청으로 프로필 상태를 복구한다", async () => {
    const mem1 = { id: "mem-1", user_id: STAFF_USER_A, store_id: STORE_1, role: "staff", status: "approved" };
    const profile = { id: STAFF_USER_A, user_id: STAFF_USER_A, role: "staff", approval_status: "approved" };

    // 1차 시도: 프로필 업데이트 실패 시뮬레이션
    const { client, tables, setFailProfileUpdate } = createFakeSupabase({
      profiles: [profile],
      store_memberships: [mem1],
      failProfileUpdate: true,
    });

    const firstResult = await withdrawStaffMembership(client, {
      userId: STAFF_USER_A,
      identifier: "mem-1",
    });

    // 멤버십은 이미 삭제되었으나 프로필 동기화는 실패하여 500 반환
    assert.equal(firstResult.success, false);
    assert.equal(firstResult.status, 500);
    assert.equal(tables.store_memberships.length, 0); // 멤버십 삭제됨
    assert.equal(tables.profiles[0].approval_status, "approved"); // 프로필 동기화 아직 안 됨

    // 2차 시도 (재요청): 이제 DB 프로필 업데이트 정상 작동
    setFailProfileUpdate(false);
    const secondResult = await withdrawStaffMembership(client, {
      userId: STAFF_USER_A,
      identifier: "mem-1",
    });

    // 멤버십이 이미 없으므로 404 반환하지만, 잔존 멤버십(0건)을 기준으로 마스터 프로필을 동기화하여 rejected로 복구한다
    assert.equal(secondResult.status, 404);
    assert.equal(secondResult.code, "NOT_FOUND");
    assert.equal(tables.profiles[0].approval_status, "rejected");
  });

  test("storeId와 membershipId 호환 조회가 다른 매장이나 다른 대상을 잘못 선택하지 않는다", async () => {
    const memA1 = { id: "mem-a1", user_id: STAFF_USER_A, store_id: STORE_1, role: "staff", status: "approved" };
    const memA2 = { id: "mem-a2", user_id: STAFF_USER_A, store_id: STORE_2, role: "staff", status: "approved" };
    const memB1 = { id: "mem-b1", user_id: STAFF_USER_B, store_id: STORE_1, role: "staff", status: "approved" };

    const { client, tables } = createFakeSupabase({
      store_memberships: [memA1, memA2, memB1],
    });

    // USER_A가 STORE_1의 storeId로 탈퇴 시 mem-a1만 정확히 삭제되고, mem-a2와 mem-b1은 남아야 한다
    const res = await withdrawStaffMembership(client, {
      userId: STAFF_USER_A,
      identifier: STORE_1,
    });
    assert.equal(res.success, true);
    assert.equal(res.deletedMembershipId, "mem-a1");
    assert.equal(tables.store_memberships.some((m) => m.id === "mem-a1"), false);
    assert.equal(tables.store_memberships.some((m) => m.id === "mem-a2"), true);
    assert.equal(tables.store_memberships.some((m) => m.id === "mem-b1"), true);
  });
});

describe("직원 회원 탈퇴 (deleteStaffAccount - 실제 함수 실행)", () => {
  test("시나리오 F: 회원 탈퇴 성공 -> auth.users 및 profiles/memberships/conversations/messages/notifications가 CASCADE 정리된다", async () => {
    const profile = {
      id: STAFF_USER_A,
      user_id: STAFF_USER_A,
      role: "staff",
      avatar_url: `https://example.com/storage/avatars/${STAFF_USER_A}/avatar-123.jpg`,
    };
    const mem = {
      id: "mem-1",
      user_id: STAFF_USER_A,
      store_id: STORE_1,
      role: "staff",
      status: "approved",
    };
    const conv = {
      id: "conv-1",
      user_id: STAFF_USER_A,
      store_id: STORE_1,
      title: "대화",
    };
    const msg = {
      id: "msg-1",
      conversation_id: "conv-1",
      role: "user",
      content: "질문",
    };
    const notif = {
      id: "notif-1",
      recipient_user_id: STAFF_USER_A,
      title: "알림",
    };

    const { client, tables, storageRemoved, deletedAuthUserIds } = createFakeSupabase({
      profiles: [profile],
      store_memberships: [mem],
      conversations: [conv],
      conversation_messages: [msg],
      notifications: [notif],
      storageFiles: [`${STAFF_USER_A}/avatar-123.jpg`],
    });

    const result = await deleteStaffAccount(client, { userId: STAFF_USER_A });

    assert.equal(result.success, true);
    assert.equal(result.status, 200);

    // Auth delete 호출됨
    assert.deepEqual(deletedAuthUserIds, [STAFF_USER_A]);

    // 연관 DB 행 모두 CASCADE 정리됨
    assert.equal(tables.profiles.length, 0);
    assert.equal(tables.store_memberships.length, 0);
    assert.equal(tables.conversations.length, 0);
    assert.equal(tables.conversation_messages.length, 0);
    assert.equal(tables.notifications.length, 0);

    // Storage 아바타 정리됨
    assert.deepEqual(storageRemoved, [`${STAFF_USER_A}/avatar-123.jpg`]);
  });

  test("시나리오 J: 회원 탈퇴 후에도 공유 데이터(매뉴얼, 매장, 프랜차이즈, 질문로그)는 안전하게 보존된다", async () => {
    const profile = { id: STAFF_USER_A, user_id: STAFF_USER_A, role: "staff" };
    const manual = { id: "manual-1", title: "공통 매뉴얼", franchise_id: BRAND_1 };
    const store = { id: STORE_1, store_name: "가맹점 1", franchise_id: BRAND_1 };
    const franchise = { id: BRAND_1, name: "브랜드 1" };
    const questionLog = {
      id: "qlog-1",
      store_id: STORE_1,
      question: "질문",
      status: "insufficient",
    };

    const { client, tables } = createFakeSupabase({
      profiles: [profile],
      manuals: [manual],
      stores: [store],
      franchises: [franchise],
      question_logs: [questionLog],
    });

    const result = await deleteStaffAccount(client, { userId: STAFF_USER_A });
    assert.equal(result.success, true);

    // 공유 데이터 완전 보존
    assert.equal(tables.manuals.length, 1);
    assert.equal(tables.stores.length, 1);
    assert.equal(tables.franchises.length, 1);
    assert.equal(tables.question_logs.length, 1);
    assert.equal(tables.question_logs[0].id, "qlog-1");
  });

  test("시나리오 G: Auth 삭제 실패 시 성공 응답을 내지 않고 500 에러를 반환한다", async () => {
    const profile = { id: STAFF_USER_A, user_id: STAFF_USER_A, role: "staff" };
    const mem = { id: "mem-1", user_id: STAFF_USER_A, store_id: STORE_1, role: "staff" };

    const { client, tables } = createFakeSupabase({
      profiles: [profile],
      store_memberships: [mem],
      authDeleteError: { message: "Internal Auth Service Error" },
    });

    const result = await deleteStaffAccount(client, { userId: STAFF_USER_A });

    assert.equal(result.success, false);
    assert.equal(result.status, 500);
    assert.equal(result.code, "DELETE_FAILED");

    // 아무것도 지워지지 않고 원본 상태 유지
    assert.equal(tables.profiles.length, 1);
    assert.equal(tables.store_memberships.length, 1);
  });

  test("Storage 객체 정리는 Auth 삭제보다 먼저 실행된다 (FK 의존성 방지)", async () => {
    const profile = {
      id: STAFF_USER_A,
      user_id: STAFF_USER_A,
      role: "staff",
      avatar_url: `https://example.com/storage/avatars/${STAFF_USER_A}/avatar.jpg`,
    };
    const { client, actionOrder, storageRemoved } = createFakeSupabase({
      profiles: [profile],
      storageFiles: [`${STAFF_USER_A}/avatar.jpg`],
    });

    const res = await deleteStaffAccount(client, { userId: STAFF_USER_A });
    assert.equal(res.success, true);

    // storage.remove가 auth.admin.deleteUser보다 먼저 호출됨을 확인
    assert.deepEqual(actionOrder, ["storage.remove", "auth.admin.deleteUser"]);
    assert.deepEqual(storageRemoved, [`${STAFF_USER_A}/avatar.jpg`]);
  });

  test("Storage 삭제 성공 후 Auth 삭제 실패 시 계정은 보존되고 재시도 가능한 에러가 반환된다", async () => {
    const profile = {
      id: STAFF_USER_A,
      user_id: STAFF_USER_A,
      role: "staff",
      avatar_url: `https://example.com/storage/avatars/${STAFF_USER_A}/avatar.jpg`,
    };
    const { client, tables, actionOrder } = createFakeSupabase({
      profiles: [profile],
      storageFiles: [`${STAFF_USER_A}/avatar.jpg`],
      authDeleteError: { message: "Auth service temporary error" },
    });

    const res = await deleteStaffAccount(client, { userId: STAFF_USER_A });
    assert.equal(res.success, false);
    assert.equal(res.status, 500);
    assert.equal(res.code, "DELETE_FAILED");
    assert.match(res.error, /프로필 파일은 정리되었으니/);

    // 계정과 프로필은 여전히 보존되어 재시도 가능
    assert.equal(tables.profiles.length, 1);
    assert.deepEqual(actionOrder, ["storage.remove", "auth.admin.deleteUser"]);
  });

  test("타 사용자의 Storage 경로나 .. 디렉터리 탐색 파일은 절대 삭제하지 않는다", async () => {
    const profile = {
      id: STAFF_USER_A,
      user_id: STAFF_USER_A,
      role: "staff",
      avatar_url: "https://example.com/storage/avatars/other-user/avatar.jpg",
    };
    const { client, storageRemoved } = createFakeSupabase({
      profiles: [profile],
      storageFiles: [
        `${STAFF_USER_B}/avatar.jpg`, // 타 사용자 파일
        `${STAFF_USER_A}/avatar.jpg`, // 본인 파일
        `${STAFF_USER_A}/../other.jpg`, // 악의적 경로 탐색
      ],
    });

    await deleteStaffAccount(client, { userId: STAFF_USER_A });

    // 본인 userId 폴더 내 안전한 파일만 삭제되고 타 사용자 경로는 삭제 목록에 포함되지 않는다
    assert.equal(storageRemoved.includes(`${STAFF_USER_B}/avatar.jpg`), false);
    assert.equal(storageRemoved.includes(`${STAFF_USER_A}/../other.jpg`), false);
    assert.deepEqual(storageRemoved, [`${STAFF_USER_A}/avatar.jpg`]);
  });

  test("시나리오 H: 직원이 아닌 점주(owner) 또는 본사(hq) 계정 삭제 시도 시 403 차단", async () => {
    const ownerProfile = { id: OWNER_USER, user_id: OWNER_USER, role: "owner" };
    const hqProfile = { id: HQ_USER, user_id: HQ_USER, role: "hq" };

    const { client } = createFakeSupabase({
      profiles: [ownerProfile, hqProfile],
    });

    const ownerRes = await deleteStaffAccount(client, { userId: OWNER_USER });
    assert.equal(ownerRes.status, 403);
    assert.equal(ownerRes.code, "FORBIDDEN");

    const hqRes = await deleteStaffAccount(client, { userId: HQ_USER });
    assert.equal(hqRes.status, 403);
    assert.equal(hqRes.code, "FORBIDDEN");
  });

  test("존재하지 않는 사용자 ID 삭제 시도 시 404 NOT_FOUND", async () => {
    const { client } = createFakeSupabase({ profiles: [] });
    const result = await deleteStaffAccount(client, { userId: "non-existent" });
    assert.equal(result.status, 404);
    assert.equal(result.code, "NOT_FOUND");
  });
});

describe("계약 및 소스 검증 (시나리오 D, I, 프론트엔드 연결)", () => {
  const repoRoot = process.cwd();
  const read = (relPath: string) => readFileSync(path.join(repoRoot, relPath), "utf8");

  test("시나리오 D: 탈퇴한 매장(멤버십 없음)의 RAG/챗봇/공지 API는 approved staff 검사로 403 차단된다", () => {
    const ragAccessSource = read("lib/rag/authorize-rag-store-access.ts");
    assert.match(ragAccessSource, /\.eq\("role", "staff"\)/);
    assert.match(ragAccessSource, /\.eq\("status", "approved"\)/);

    const chatSource = read("app/api/staff/chat/route.ts");
    assert.match(chatSource, /code: ragResponse\.status === 403 \? "STORE_FORBIDDEN" : undefined/);

    const noticesSource = read("app/api/staff/notices/route.ts");
    assert.match(noticesSource, /\.eq\("role", "staff"\)/);
    assert.match(noticesSource, /\.eq\("status", "approved"\)/);
  });

  test("시나리오 I: 회원 탈퇴 다이얼로그와 설정 화면이 OAuth(소셜 로그인) 계정을 지원한다", () => {
    const dialogSource = read("components/common/AccountDeleteConfirmDialog.tsx");
    assert.match(dialogSource, /isOAuthUser/);
    assert.match(dialogSource, /isAuthenticated \|\| isOAuthUser/);

    const settingsSource = read("app/staff/settings/page.tsx");
    assert.match(settingsSource, /isOAuthUser/);
    assert.match(settingsSource, /setIsOAuthUser/);
  });

  test("회원 탈퇴 성공 시 세션 로그아웃과 로컬 스토리지를 정리한다", () => {
    const settingsSource = read("app/staff/settings/page.tsx");
    assert.match(settingsSource, /supabase\.auth\.signOut\(\)/);
    assert.match(settingsSource, /writeSelectedStaffStoreId\(null\)/);
    assert.match(settingsSource, /writeStaffConversationId\(null\)/);
  });

  test("매장 탈퇴 API는 membershipId와 storeId 둘 다 조회 및 삭제를 지원한다", () => {
    const serviceSource = read("lib/staff/staff-membership-service.ts");
    assert.match(serviceSource, /\.eq\("id", trimmedId\)/);
    assert.match(serviceSource, /\.eq\("store_id", trimmedId\)/);
    assert.match(serviceSource, /buildMasterApprovalUpdate/);
  });

  test("설정 화면은 매장 탈퇴 시 membershipId만 전달하고 storeId로 대체하지 않는다", () => {
    const settingsSource = read("app/staff/settings/page.tsx");
    assert.match(settingsSource, /\/api\/staff\/memberships\/\$\{encodeURIComponent\(store\.membershipId\)\}/);
    assert.doesNotMatch(settingsSource, /membershipId \|\| storeId/);
  });

  test("서버 회원탈퇴 API는 쿠키 세션과 분리된 client로 비밀번호를 검증한다", () => {
    const deleteRoute = read("app/api/staff/delete-account/route.ts");
    assert.match(deleteRoute, /hasPasswordLogin\(user\)/);
    assert.match(deleteRoute, /verifyPasswordWithIsolatedClient\(/);
    assert.doesNotMatch(deleteRoute, /serverClient\.auth\.signInWithPassword/);
    assert.match(deleteRoute, /deleteStaffAccount\(adminClient/);

    const validateRoute = read("app/api/staff/validate-password/route.ts");
    assert.match(validateRoute, /verifyPasswordWithIsolatedClient\(/);
    assert.doesNotMatch(validateRoute, /signInWithPassword/);

    // 브라우저 client로 재로그인하면 현재 세션이 교체되므로 설정 화면에서는 호출하지 않는다.
    const settingsSource = read("app/staff/settings/page.tsx");
    assert.doesNotMatch(settingsSource, /signInWithPassword/);
  });
});

describe("로그인 제공자 판별 및 로컬 스토리지 정리 (hasPasswordLogin, clearStaffSessionKeys)", () => {
  test("이메일/비밀번호 가입자는 hasPasswordLogin이 true다", () => {
    assert.equal(
      hasPasswordLogin({
        identities: [{ provider: "email" }],
        app_metadata: { provider: "email", providers: ["email"] },
      }),
      true,
    );
  });

  test("순수 소셜(OAuth) 가입자는 hasPasswordLogin이 false다", () => {
    assert.equal(
      hasPasswordLogin({
        identities: [{ provider: "google" }],
        app_metadata: { provider: "google", providers: ["google"] },
      }),
      false,
    );
    assert.equal(
      hasPasswordLogin({
        identities: [{ provider: "kakao" }],
        app_metadata: { provider: "kakao" },
      }),
      false,
    );
  });

  test("소셜 로그인과 이메일이 연동된 복수 제공자 계정은 hasPasswordLogin이 true다", () => {
    assert.equal(
      hasPasswordLogin({
        identities: [{ provider: "google" }, { provider: "email" }],
        app_metadata: { providers: ["google", "email"] },
      }),
      true,
    );
  });

  test("clearStaffSessionKeys는 직원의 6개 세션 키만 삭제하고 다른 키는 보존한다", () => {
    const store = new Map<string, string>([
      ["staffSelectedStoreId", "store-1"],
      ["staffConversationId", "conv-1"],
      ["staffStoreEditDraft", "{}"],
      ["signupStoreApprovals", "[]"],
      ["pendingStores", "[]"],
      [`ilitda.escalationPopupSeen:${STAFF_USER_A}`, "[]"],
      ["unrelatedKey", "keep-me"],
      ["anotherUserTab", "important"],
    ]);

    // Mock global sessionStorage
    const originalSessionStorage = globalThis.sessionStorage;
    (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
      removeItem: (k: string) => store.delete(k),
    };

    try {
      clearStaffSessionKeys(STAFF_USER_A);

      // 직원 관련 6개 키는 모두 삭제됨
      assert.equal(store.has("staffSelectedStoreId"), false);
      assert.equal(store.has("staffConversationId"), false);
      assert.equal(store.has("staffStoreEditDraft"), false);
      assert.equal(store.has("signupStoreApprovals"), false);
      assert.equal(store.has("pendingStores"), false);
      assert.equal(store.has(`ilitda.escalationPopupSeen:${STAFF_USER_A}`), false);

      // 무관한 키는 안전하게 보존됨
      assert.equal(store.get("unrelatedKey"), "keep-me");
      assert.equal(store.get("anotherUserTab"), "important");
    } finally {
      (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = originalSessionStorage;
    }
  });

  test("마지막 매장 탈퇴 후 approval_status가 rejected 상태인 직원도 새 매장 신청이 정상 접수된다", async () => {
    // 승인된 점주가 있는 STORE_1
    const approvedOwnerMem = {
      id: "mem-owner",
      user_id: OWNER_USER,
      store_id: STORE_1,
      role: "owner",
      status: "approved",
      franchise_id: BRAND_1,
    };
    const store1 = { id: STORE_1, store_name: "지점 1", franchise_id: BRAND_1 };
    const { client } = createFakeSupabase({
      stores: [store1],
      store_memberships: [approvedOwnerMem],
      franchises: [{ id: BRAND_1 }],
    });

    // rejected 상태의 직원이 신규 매장 신청
    const req = await submitStoreMembershipRequest(client, {
      userId: STAFF_USER_A,
      userName: "김직원",
      role: "staff",
      storeId: STORE_1,
      storeName: "지점 1",
      currentApprovalStatus: "rejected",
    });

    assert.equal(req.success, true);
    assert.equal(req.created, true);
    assert.equal(req.membershipStatus, "pending");
  });
});

describe("탈퇴한 매장의 과거 대화 접근 차단 (listStaffConversations / getStaffConversationDetail)", () => {
  const baseState = () => ({
    stores: [
      { id: STORE_1, store_name: "지점 1" },
      { id: STORE_2, store_name: "지점 2" },
    ],
    store_memberships: [
      { id: "mem-1", user_id: STAFF_USER_A, store_id: STORE_1, role: "staff", status: "approved" },
      { id: "mem-2", user_id: STAFF_USER_A, store_id: STORE_2, role: "staff", status: "approved" },
      { id: "mem-b2", user_id: STAFF_USER_B, store_id: STORE_2, role: "staff", status: "approved" },
    ],
    profiles: [{ id: STAFF_USER_A, role: "staff", approval_status: "approved" }],
    conversations: [
      { id: "conv-1", user_id: STAFF_USER_A, store_id: STORE_1, title: "지점1 대화", updated_at: "2026-09-01T00:00:00Z" },
      { id: "conv-2", user_id: STAFF_USER_A, store_id: STORE_2, title: "지점2 대화", updated_at: "2026-09-02T00:00:00Z" },
      { id: "conv-b", user_id: STAFF_USER_B, store_id: STORE_2, title: "B 대화", updated_at: "2026-09-03T00:00:00Z" },
    ],
    conversation_messages: [
      { id: "m-1", conversation_id: "conv-1", role: "user", content: "지점1 비밀 질문", created_at: "2026-09-01T00:00:00Z" },
      { id: "m-2", conversation_id: "conv-2", role: "user", content: "지점2 질문", created_at: "2026-09-02T00:00:00Z" },
    ],
  });

  test("매장 탈퇴 후 목록에서 탈퇴 매장 대화는 빠지고 다른 승인 매장 대화는 유지된다", async () => {
    const { client } = createFakeSupabase(baseState());

    const before = await listStaffConversations(client, STAFF_USER_A);
    assert.equal(before.ok, true);
    assert.deepEqual(before.ok && before.conversations.map((c) => c.id).sort(), ["conv-1", "conv-2"]);

    const withdrawn = await withdrawStaffMembership(client, { userId: STAFF_USER_A, identifier: "mem-1" });
    assert.equal(withdrawn.success, true);

    const after = await listStaffConversations(client, STAFF_USER_A);
    assert.equal(after.ok, true);
    assert.deepEqual(after.ok && after.conversations.map((c) => c.id), ["conv-2"]);
    assert.equal(after.ok && after.conversations[0].storeName, "지점 2");
  });

  test("매장 탈퇴 후 상세 API는 탈퇴 매장 대화를 404로 막고 메시지를 반환하지 않는다", async () => {
    const { client } = createFakeSupabase(baseState());
    await withdrawStaffMembership(client, { userId: STAFF_USER_A, identifier: "mem-1" });

    const blocked = await getStaffConversationDetail(client, STAFF_USER_A, "conv-1");
    assert.equal(blocked.ok, false);
    assert.equal(!blocked.ok && blocked.status, 404);
    assert.equal(JSON.stringify(blocked).includes("지점1 비밀 질문"), false);

    const kept = await getStaffConversationDetail(client, STAFF_USER_A, "conv-2");
    assert.equal(kept.ok, true);
    assert.equal(kept.ok && kept.conversation.canContinue, true);
    assert.deepEqual(kept.ok && kept.messages.map((m) => m.content), ["지점2 질문"]);
  });

  test("pending/rejected 멤버십 매장의 대화와 다른 사용자의 대화도 열 수 없다", async () => {
    const state = baseState();
    state.store_memberships[0].status = "pending";
    const { client } = createFakeSupabase(state);

    const list = await listStaffConversations(client, STAFF_USER_A);
    assert.deepEqual(list.ok && list.conversations.map((c) => c.id), ["conv-2"]);

    const pending = await getStaffConversationDetail(client, STAFF_USER_A, "conv-1");
    assert.equal(!pending.ok && pending.status, 404);

    const otherUser = await getStaffConversationDetail(client, STAFF_USER_A, "conv-b");
    assert.equal(!otherUser.ok && otherUser.status, 404);
  });

  test("승인 매장이 하나도 없으면 빈 목록을 반환한다", async () => {
    const state = baseState();
    state.store_memberships = state.store_memberships.filter((m) => m.user_id !== STAFF_USER_A);
    const { client } = createFakeSupabase(state);

    const list = await listStaffConversations(client, STAFF_USER_A);
    assert.deepEqual(list, { ok: true, conversations: [], historyAvailable: true });
  });

  test("멤버십 조회 실패 시 대화를 노출하지 않고 500을 반환한다 (fail-closed)", async () => {
    const { client } = createFakeSupabase({ ...baseState(), failSelectTables: ["store_memberships"] });

    const list = await listStaffConversations(client, STAFF_USER_A);
    assert.equal(!list.ok && list.status, 500);

    const detail = await getStaffConversationDetail(client, STAFF_USER_A, "conv-2");
    assert.equal(!detail.ok && detail.status, 500);
  });
});

describe("membershipId/storeId 호환 조회의 모호성 거절", () => {
  const MEMBERSHIP_X = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  test("identifier가 한 행의 id이면서 다른 행의 store_id이면 400으로 거절하고 아무것도 삭제하지 않는다", async () => {
    // 같은 사용자: 행 X의 id === 행 Y의 store_id (STORE_2)
    const rowX = { id: STORE_2, user_id: STAFF_USER_A, store_id: STORE_1, role: "staff", status: "approved" };
    const rowY = { id: MEMBERSHIP_X, user_id: STAFF_USER_A, store_id: STORE_2, role: "staff", status: "approved" };
    const { client, tables } = createFakeSupabase({
      profiles: [{ id: STAFF_USER_A, role: "staff", approval_status: "approved" }],
      store_memberships: [rowX, rowY],
    });

    const result = await withdrawStaffMembership(client, { userId: STAFF_USER_A, identifier: STORE_2 });

    assert.equal(result.success, false);
    assert.equal(result.status, 400);
    assert.equal(!result.success && result.code, "AMBIGUOUS_IDENTIFIER");
    assert.deepEqual(tables.store_memberships.map((m) => m.id).sort(), [MEMBERSHIP_X, STORE_2].sort());
    assert.equal(tables.profiles[0].approval_status, "approved");
  });

  test("모호하지 않은 membershipId 요청은 해당 행만 삭제한다", async () => {
    const rowX = { id: STORE_2, user_id: STAFF_USER_A, store_id: STORE_1, role: "staff", status: "approved" };
    const rowY = { id: MEMBERSHIP_X, user_id: STAFF_USER_A, store_id: STORE_2, role: "staff", status: "approved" };
    const { client, tables } = createFakeSupabase({ store_memberships: [rowX, rowY] });

    const result = await withdrawStaffMembership(client, { userId: STAFF_USER_A, identifier: MEMBERSHIP_X });

    assert.equal(result.success, true);
    assert.equal(result.success && result.deletedMembershipId, MEMBERSHIP_X);
    assert.deepEqual(tables.store_memberships.map((m) => m.id), [STORE_2]);
  });

  test("다른 사용자의 행 id와 겹치는 storeId는 모호하지 않으며 본인 행만 삭제한다", async () => {
    const otherUsersRow = { id: STORE_1, user_id: STAFF_USER_B, store_id: STORE_2, role: "staff", status: "approved" };
    const mine = { id: "mem-a1", user_id: STAFF_USER_A, store_id: STORE_1, role: "staff", status: "approved" };
    const { client, tables } = createFakeSupabase({ store_memberships: [otherUsersRow, mine] });

    const result = await withdrawStaffMembership(client, { userId: STAFF_USER_A, identifier: STORE_1 });

    assert.equal(result.success, true);
    assert.equal(result.success && result.deletedMembershipId, "mem-a1");
    assert.deepEqual(tables.store_memberships.map((m) => m.id), [STORE_1]);
  });
});

describe("회원 탈퇴 Storage 정리 정책 (페이지 조회, 실패 시 계정 보존)", () => {
  const profile = { id: STAFF_USER_A, role: "staff", avatar_url: null };

  test("기본 list 제한(100개)을 넘는 파일도 모두 삭제한 뒤 계정을 삭제한다", async () => {
    const files = Array.from({ length: 2345 }, (_, i) => `${STAFF_USER_A}/avatar-${String(i).padStart(5, "0")}.jpg`);
    const otherUserFile = `${STAFF_USER_B}/avatar.jpg`;
    const { client, storageFiles, storageRemoved, storageListCalls, deletedAuthUserIds } = createFakeSupabase({
      profiles: [profile],
      storageFiles: [...files, otherUserFile],
    });

    const result = await deleteStaffAccount(client, { userId: STAFF_USER_A });

    assert.equal(result.success, true);
    assert.equal(storageRemoved.length, files.length);
    assert.deepEqual(storageFiles, [otherUserFile]);
    assert.ok(storageListCalls.length >= 3);
    assert.ok(storageListCalls.every((call) => call.prefix === STAFF_USER_A && call.limit > 100));
    assert.deepEqual(deletedAuthUserIds, [STAFF_USER_A]);
  });

  test("Storage 조회 실패 시 계정을 삭제하지 않고 재시도 가능한 오류를 반환한다", async () => {
    const { client, tables, deletedAuthUserIds, actionOrder } = createFakeSupabase({
      profiles: [profile],
      storageFiles: [`${STAFF_USER_A}/avatar.jpg`],
      storageListError: { message: "storage list failed" },
    });

    const result = await deleteStaffAccount(client, { userId: STAFF_USER_A });

    assert.equal(result.success, false);
    assert.equal(result.status, 500);
    assert.equal(!result.success && result.code, "STORAGE_CLEANUP_FAILED");
    assert.deepEqual(deletedAuthUserIds, []);
    assert.equal(actionOrder.includes("auth.admin.deleteUser"), false);
    assert.equal(tables.profiles.length, 1);
  });

  test("Storage 삭제 실패 시 계정을 삭제하지 않는다", async () => {
    const { client, deletedAuthUserIds, actionOrder } = createFakeSupabase({
      profiles: [profile],
      storageFiles: [`${STAFF_USER_A}/avatar.jpg`],
      storageRemoveError: { message: "storage remove failed" },
    });

    const result = await deleteStaffAccount(client, { userId: STAFF_USER_A });

    assert.equal(!result.success && result.code, "STORAGE_CLEANUP_FAILED");
    assert.deepEqual(deletedAuthUserIds, []);
    assert.deepEqual(actionOrder, ["storage.remove"]);
  });

  test("파일이 없으면 Storage 삭제 없이 계정을 삭제한다", async () => {
    const { client, actionOrder } = createFakeSupabase({ profiles: [profile] });

    const result = await deleteStaffAccount(client, { userId: STAFF_USER_A });

    assert.equal(result.success, true);
    assert.deepEqual(actionOrder, ["auth.admin.deleteUser"]);
  });
});

describe("Auth 세션 처리 (실제 supabase-js client + 가짜 fetch, 네트워크 호출 없음)", () => {
  const SUPABASE_URL = "http://auth-test.invalid";
  const ANON_KEY = "test-anon-key";

  type FetchCall = { url: string; method: string; authorization: string | null };

  function installFakeFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
    const calls: FetchCall[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const call = { url: String(input), method: init?.method ?? "GET", authorization: headers.get("Authorization") };
      calls.push(call);
      return handler(call);
    }) as typeof fetch;
    return { calls, restore: () => (globalThis.fetch = originalFetch) };
  }

  const sessionBody = (accessToken: string) => ({
    access_token: accessToken,
    refresh_token: `${accessToken}-refresh`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: STAFF_USER_A, aud: "authenticated", role: "authenticated", email: "a@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  });

  test("비밀번호 검증 client는 세션을 저장·갱신하지 않고, 검증 세션을 즉시 local 로그아웃한다", async () => {
    const fake = installFakeFetch(({ url }) =>
      url.includes("/token?grant_type=password")
        ? Response.json(sessionBody("verification-token"))
        : new Response(null, { status: 204 }),
    );
    try {
      const client = createPasswordVerificationClient(SUPABASE_URL, ANON_KEY);
      const valid = await verifyPasswordWithIsolatedClient(client, "a@example.com", "pw");

      assert.equal(valid, true);
      const logout = fake.calls.find((c) => c.url.includes("/logout"));
      assert.ok(logout, "검증 세션 폐기 호출이 있어야 한다");
      assert.match(logout.url, /scope=local/);
      assert.equal(logout.authorization, "Bearer verification-token");
      assert.equal(fake.calls.some((c) => c.url.includes("grant_type=refresh_token")), false);
      const { data } = await client.auth.getSession();
      assert.equal(data.session, null);
    } finally {
      fake.restore();
    }
  });

  test("비밀번호가 틀리면 false를 반환하고 로그아웃 호출을 하지 않는다", async () => {
    const fake = installFakeFetch(() =>
      Response.json({ code: "invalid_credentials", error_code: "invalid_credentials", msg: "Invalid login credentials" }, { status: 400 }),
    );
    try {
      const client = createPasswordVerificationClient(SUPABASE_URL, ANON_KEY);
      assert.equal(await verifyPasswordWithIsolatedClient(client, "a@example.com", "wrong"), false);
      assert.equal(fake.calls.some((c) => c.url.includes("/logout")), false);
    } finally {
      fake.restore();
    }
  });

  for (const [label, logoutResponse] of [
    ["네트워크 오류", () => Promise.reject(new TypeError("fetch failed"))],
    ["서버 500", () => Response.json({ msg: "boom" }, { status: 500 })],
    ["탈퇴 후 user_not_found 403", () => Response.json({ code: "user_not_found", msg: "User not found" }, { status: 403 })],
  ] as const) {
    test(`signOut() 서버 로그아웃이 실패해도(${label}) 로컬 Auth 세션 저장소는 비워진다`, async () => {
      const storageKey = "sb-test-auth-token";
      const storage = new Map<string, string>([[storageKey, JSON.stringify(sessionBody("user-token"))]]);
      const fake = installFakeFetch(() => logoutResponse());
      try {
        const client = createSupabaseJsClient(SUPABASE_URL, ANON_KEY, {
          auth: {
            storageKey,
            persistSession: true,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storage: {
              getItem: (key: string) => storage.get(key) ?? null,
              setItem: (key: string, value: string) => void storage.set(key, value),
              removeItem: (key: string) => void storage.delete(key),
            },
          },
        });

        await client.auth.signOut();

        assert.ok(fake.calls.some((c) => c.url.includes("/logout")));
        assert.equal(storage.has(storageKey), false);
      } finally {
        fake.restore();
      }
    });
  }
});

describe("점주의 직원 소속 해제 (removeStaffMembershipByOwner - 가짜 client로 실제 함수 실행)", () => {
  const OWNER_2 = "55555555-5555-4555-8555-555555555555";
  const PENDING_OWNER = "66666666-6666-4666-8666-666666666666";

  const baseState = () => ({
    profiles: [
      { id: STAFF_USER_A, role: "staff", approval_status: "approved" },
      { id: STAFF_USER_B, role: "staff", approval_status: "approved" },
      { id: OWNER_USER, role: "owner", approval_status: "approved" },
      { id: OWNER_2, role: "owner", approval_status: "approved" },
      { id: HQ_USER, role: "hq", approval_status: "approved" },
    ],
    store_memberships: [
      { id: "own-1", user_id: OWNER_USER, store_id: STORE_1, role: "owner", status: "approved" },
      { id: "own-2", user_id: OWNER_2, store_id: STORE_2, role: "owner", status: "approved" },
      { id: "own-p", user_id: PENDING_OWNER, store_id: STORE_1, role: "owner", status: "pending" },
      { id: "mem-a1", user_id: STAFF_USER_A, store_id: STORE_1, role: "staff", status: "approved" },
      { id: "mem-a2", user_id: STAFF_USER_A, store_id: STORE_2, role: "staff", status: "approved" },
      { id: "mem-b1", user_id: STAFF_USER_B, store_id: STORE_1, role: "staff", status: "approved" },
      { id: "mem-b2-pending", user_id: STAFF_USER_B, store_id: STORE_2, role: "staff", status: "pending" },
    ],
    stores: [
      { id: STORE_1, store_name: "지점 1", franchise_id: BRAND_1 },
      { id: STORE_2, store_name: "지점 2", franchise_id: BRAND_1 },
    ],
    franchises: [{ id: BRAND_1, name: "브랜드" }],
    manuals: [{ id: "manual-1", store_id: STORE_1, title: "매장 매뉴얼" }],
    conversations: [
      { id: "conv-a1", user_id: STAFF_USER_A, store_id: STORE_1, title: "지점1 대화", updated_at: "2026-09-01T00:00:00Z" },
      { id: "conv-a2", user_id: STAFF_USER_A, store_id: STORE_2, title: "지점2 대화", updated_at: "2026-09-02T00:00:00Z" },
    ],
    conversation_messages: [
      { id: "m-a1", conversation_id: "conv-a1", role: "user", content: "지점1 질문", created_at: "2026-09-01T00:00:00Z" },
    ],
  });

  // staffUserId는 구 클라이언트가 보내던 값을 흉내 내는 용도다. 현재 입력 타입에는 없고 무시돼야 한다.
  const remove = (client: SupabaseClient, ownerUserId: string, membershipId: string, storeId: string, staffUserId?: string) =>
    removeStaffMembershipByOwner(client, { ownerUserId, membershipId, storeId, ...(staffUserId ? { staffUserId } : {}) } as Parameters<typeof removeStaffMembershipByOwner>[1]);

  test("점주가 자기 매장의 승인 직원을 해제하면 그 매장 멤버십만 지워지고 계정·다른 매장·공유 데이터는 유지된다", async () => {
    const { client, tables, deletedAuthUserIds, storageRemoved } = createFakeSupabase(baseState());

    const result = await remove(client, OWNER_USER, "mem-a1", STORE_1);

    assert.deepEqual(result, { status: 200, body: { success: true, alreadyRemoved: false } });
    assert.equal(tables.store_memberships.some((m) => m.id === "mem-a1"), false);
    assert.ok(tables.store_memberships.some((m) => m.id === "mem-a2"), "다른 매장 소속 유지");
    assert.ok(tables.store_memberships.some((m) => m.id === "mem-b1"), "같은 매장 다른 직원 유지");
    assert.equal(tables.profiles.find((p) => p.id === STAFF_USER_A)?.approval_status, "approved");
    assert.deepEqual(deletedAuthUserIds, []);
    assert.deepEqual(storageRemoved, []);
    assert.equal(tables.stores.length, 2);
    assert.equal(tables.manuals.length, 1);
    assert.equal(tables.conversations.length, 2, "과거 대화 행은 보존된다");

    // 해제된 매장의 과거 대화는 현재 승인 멤버십 검사로 막히고, 다른 매장 대화는 유지된다.
    const list = await listStaffConversations(client, STAFF_USER_A);
    assert.deepEqual(list.ok && list.conversations.map((c) => c.id), ["conv-a2"]);
    const detail = await getStaffConversationDetail(client, STAFF_USER_A, "conv-a1");
    assert.equal(!detail.ok && detail.status, 404);
  });

  test("다른 매장 직원은 해제할 수 없고 존재 여부도 드러내지 않는다", async () => {
    const { client, tables } = createFakeSupabase(baseState());

    // 자기 매장 범위로 요청하면 타 매장 멤버십은 "없음"과 같다(삭제 없음, 정보 노출 없음).
    const scoped = await remove(client, OWNER_USER, "mem-a2", STORE_1);
    assert.deepEqual(scoped.body, { success: true, alreadyRemoved: true });
    // 타 매장 storeId를 직접 넣으면 점주 권한 검사에서 막힌다.
    const foreign = await remove(client, OWNER_USER, "mem-a2", STORE_2);
    assert.equal(foreign.status, 403);
    assert.ok(tables.store_memberships.some((m) => m.id === "mem-a2"));
  });

  test("직원·본사·미승인 점주의 요청은 403으로 막힌다", async () => {
    const { client, tables } = createFakeSupabase(baseState());
    for (const requester of [STAFF_USER_B, HQ_USER, PENDING_OWNER]) {
      const result = await remove(client, requester, "mem-a1", STORE_1);
      assert.equal(result.status, 403, requester);
    }
    assert.ok(tables.store_memberships.some((m) => m.id === "mem-a1"));
  });

  test("점주 멤버십과 승인 대기 직원은 이 API로 해제할 수 없다", async () => {
    const { client, tables } = createFakeSupabase(baseState());
    const ownerTarget = await remove(client, OWNER_USER, "own-1", STORE_1);
    assert.equal(ownerTarget.status, 400);
    assert.equal(!ownerTarget.body.success && ownerTarget.body.code, "NOT_STAFF");
    const pendingOwnerTarget = await remove(client, OWNER_USER, "own-p", STORE_1);
    assert.equal(!pendingOwnerTarget.body.success && pendingOwnerTarget.body.code, "NOT_STAFF");

    const pendingStaff = await remove(client, OWNER_2, "mem-b2-pending", STORE_2);
    assert.equal(pendingStaff.status, 409);
    assert.equal(tables.store_memberships.length, 7);
  });

  test("마지막 소속이 해제되면 미소속(rejected)으로 동기화되고, 재신청은 새 대기 멤버십으로 접수된다", async () => {
    const state = baseState();
    state.store_memberships = state.store_memberships.filter((m) => m.id !== "mem-a2");
    const { client, tables } = createFakeSupabase(state);

    const result = await remove(client, OWNER_USER, "mem-a1", STORE_1);
    assert.equal(result.status, 200);
    assert.equal(tables.profiles.find((p) => p.id === STAFF_USER_A)?.approval_status, "rejected");
    assert.ok(tables.profiles.some((p) => p.id === STAFF_USER_A), "계정 프로필 유지");

    const reapply = await submitStoreMembershipRequest(client, {
      userId: STAFF_USER_A,
      userName: "김직원",
      role: "staff",
      storeId: STORE_1,
      storeName: "지점 1",
      currentApprovalStatus: "rejected",
    });
    assert.equal(reapply.success, true);
    assert.equal(reapply.created, true);
    assert.equal(reapply.membershipStatus, "pending");

    // 재승인 전에는 대화 등 매장 데이터에 접근할 수 없다.
    const list = await listStaffConversations(client, STAFF_USER_A);
    assert.deepEqual(list.ok && list.conversations, []);
  });

  test("중복 클릭·재시도는 안전한 성공(alreadyRemoved)이며 다른 멤버십을 건드리지 않는다", async () => {
    const { client, tables } = createFakeSupabase(baseState());
    await remove(client, OWNER_USER, "mem-a1", STORE_1);
    const retry = await remove(client, OWNER_USER, "mem-a1", STORE_1);

    assert.deepEqual(retry.body, { success: true, alreadyRemoved: true });
    assert.deepEqual(tables.store_memberships.map((m) => m.id).sort(), ["mem-a2", "mem-b1", "mem-b2-pending", "own-1", "own-2", "own-p"]);
  });

  test("동시에 두 번 요청해도 한 번만 삭제되고 둘 다 성공으로 끝난다 (가짜 client — 실제 DB 동시성 검증 아님)", async () => {
    const { client, tables } = createFakeSupabase(baseState());
    const results = await Promise.all([
      remove(client, OWNER_USER, "mem-a1", STORE_1),
      remove(client, OWNER_USER, "mem-a1", STORE_1),
    ]);

    assert.ok(results.every((r) => r.status === 200));
    assert.equal(results.filter((r) => r.body.success && !r.body.alreadyRemoved).length, 1);
    assert.equal(tables.store_memberships.filter((m) => m.user_id === STAFF_USER_A).length, 1);
  });

  test("오래된 요청은 재신청·재승인된 새 멤버십을 해제하지 않는다", async () => {
    const { client, tables } = createFakeSupabase(baseState());
    await remove(client, OWNER_USER, "mem-a1", STORE_1);
    tables.store_memberships.push({ id: "mem-a1-new", user_id: STAFF_USER_A, store_id: STORE_1, role: "staff", status: "approved" });

    const stale = await remove(client, OWNER_USER, "mem-a1", STORE_1);
    assert.equal(stale.body.success && stale.body.alreadyRemoved, true);
    assert.ok(tables.store_memberships.some((m) => m.id === "mem-a1-new"));
  });

  test("프로필 갱신이 실패하면 트랜잭션 전체가 롤백돼 소속·승인 상태가 그대로이고, 같은 요청으로 재시도된다", async () => {
    const state = baseState();
    state.store_memberships = state.store_memberships.filter((m) => m.id !== "mem-a2");
    const { client, tables, setFailProfileUpdate } = createFakeSupabase({ ...state, failProfileUpdate: true });

    const first = await remove(client, OWNER_USER, "mem-a1", STORE_1);
    assert.equal(first.status, 500);
    assert.equal(!first.body.success && first.body.code, "PROFILE_MISSING");
    assert.equal(!first.body.success && first.body.removed, false);
    assert.ok(tables.store_memberships.some((m) => m.id === "mem-a1"), "소속은 그대로");
    assert.equal(tables.profiles.find((p) => p.id === STAFF_USER_A)?.approval_status, "approved");

    setFailProfileUpdate(false);
    const retried = await remove(client, OWNER_USER, "mem-a1", STORE_1);
    assert.deepEqual(retried.body, { success: true, alreadyRemoved: false });
    assert.equal(tables.profiles.find((p) => p.id === STAFF_USER_A)?.approval_status, "rejected");
  });

  test("마스터 프로필이 없으면 성공하지 않고 롤백한다", async () => {
    const state = baseState();
    state.profiles = state.profiles.filter((p) => p.id !== STAFF_USER_A);
    const { client, tables } = createFakeSupabase(state);

    const result = await remove(client, OWNER_USER, "mem-a1", STORE_1);
    assert.equal(result.status, 500);
    assert.equal(!result.body.success && result.body.code, "PROFILE_MISSING");
    assert.ok(tables.store_memberships.some((m) => m.id === "mem-a1"));
  });

  test("함수 내부 오류(교착 40P01 등 Postgres SQLSTATE)는 롤백으로 확정해 removed:false", async () => {
    for (const code of ["40P01", "40001", "23503", "P0001", "XX000"]) {
      const midFailure = createFakeSupabase({
        ...baseState(),
        duringRemoveTransaction: () => {
          throw Object.assign(new Error("mid-transaction failure"), { code });
        },
      });
      const rolledBack = await remove(midFailure.client, OWNER_USER, "mem-a1", STORE_1);
      assert.equal(rolledBack.status, 500, code);
      assert.equal(!rolledBack.body.success && rolledBack.body.code, "SERVER_ERROR", code);
      assert.equal(!rolledBack.body.success && rolledBack.body.removed, false, code);
      assert.ok(midFailure.tables.store_memberships.some((m) => m.id === "mem-a1"), code);
    }
  });

  test("커밋 여부를 확정할 수 없는 오류는 removed:null과 재조회·재시도 안내를 돌려준다", async () => {
    const uncertainErrors: Array<{ code?: string; message: string }> = [
      { code: "", message: "FetchError: fetch failed" }, // postgrest-js 네트워크 실패(status 0)
      { message: "<html>502 Bad Gateway</html>" }, // 게이트웨이 비JSON 응답
      { message: "upstream request timeout" }, // 코드 없는 JSON 응답
      { code: "PGRST001", message: "Database client error" },
      { code: "PGRST000", message: "Could not connect" },
      { code: "PGRST003", message: "Timed out acquiring connection" },
      { code: "08006", message: "connection failure" },
      { code: "57P01", message: "terminating connection due to administrator command" },
    ];
    for (const removeRpcError of uncertainErrors) {
      const { client } = createFakeSupabase({ ...baseState(), removeRpcError });
      const result = await remove(client, OWNER_USER, "mem-a1", STORE_1);
      assert.equal(result.status, 500, removeRpcError.message);
      assert.equal(!result.body.success && result.body.removed, null, removeRpcError.message);
      assert.match(!result.body.success ? result.body.error : "", /새로고침.*다시 시도/, removeRpcError.message);
    }

    const thrown = await removeStaffMembershipByOwner(
      { rpc: async () => { throw new TypeError("fetch failed"); } } as never,
      { ownerUserId: OWNER_USER, membershipId: "mem-a1", storeId: STORE_1 },
    );
    assert.equal(!thrown.body.success && thrown.body.removed, null);

    const unexpected = await removeStaffMembershipByOwner(
      { rpc: async () => ({ data: "???", error: null }) } as never,
      { ownerUserId: OWNER_USER, membershipId: "mem-a1", storeId: STORE_1 },
    );
    assert.equal(!unexpected.body.success && unexpected.body.removed, null);
  });

  test("035 미적용이면 503 기능 준비 중이며, 앱 코드로 직접 삭제·갱신하는 대체 경로를 타지 않는다", async () => {
    const { client, tables, rpcCalls } = createFakeSupabase({ ...baseState(), missingRemoveRpc: true });
    const before = JSON.stringify({ m: tables.store_memberships, p: tables.profiles });

    const result = await remove(client, OWNER_USER, "mem-a1", STORE_1);
    assert.equal(result.status, 503);
    assert.equal(!result.body.success && result.body.code, "FEATURE_UNAVAILABLE");
    assert.equal(!result.body.success && result.body.removed, false);
    assert.deepEqual(rpcCalls, ["remove_staff_membership_by_owner"]);
    assert.equal(JSON.stringify({ m: tables.store_memberships, p: tables.profiles }), before);
  });

  test("다른 매장 승인이 남으면 approved를 유지하고, 승인 시각은 가장 이른 승인 행을 따른다", async () => {
    const state = baseState();
    const memberships: Row[] = state.store_memberships.map((m) =>
      m.id === "mem-a2" ? { ...m, approved_at: "2026-09-10T00:00:00.000Z", approved_by: OWNER_2 } : m,
    );
    memberships.push({
      id: "mem-a3", user_id: STAFF_USER_A, store_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", role: "staff",
      status: "approved", approved_at: "2026-09-05T00:00:00.000Z", approved_by: OWNER_USER,
    });
    const { client, tables } = createFakeSupabase({ ...state, store_memberships: memberships });

    await remove(client, OWNER_USER, "mem-a1", STORE_1);
    const profile = tables.profiles.find((p) => p.id === STAFF_USER_A);
    assert.equal(profile?.approval_status, "approved");
    assert.equal(profile?.approved_at, "2026-09-05T00:00:00.000Z");
    assert.equal(profile?.approved_by, OWNER_USER);
  });

  test("대상이 없는 요청은 어떤 프로필도 쓰지 않고, 점주 권한은 매번 다시 검사한다", async () => {
    const { client, tables } = createFakeSupabase(baseState());
    const before = JSON.stringify(tables.profiles);

    for (const hint of [HQ_USER, STAFF_USER_A, STAFF_USER_B, undefined]) {
      const result = await remove(client, OWNER_USER, "gone", STORE_1, hint);
      assert.deepEqual(result.body, { success: true, alreadyRemoved: true });
    }
    assert.equal(JSON.stringify(tables.profiles), before);

    const forbidden = await remove(client, OWNER_2, "gone", STORE_1);
    assert.equal(forbidden.status, 403);
  });

  test("점주가 임의의 타 매장 직원 ID를 보내도 그 직원 프로필을 쓰지 않고 응답으로 구분할 수 없다", async () => {
    const OTHER_STAFF = "77777777-7777-4777-8777-777777777777";
    const state = baseState();
    // 타 매장(STORE_2)에만 소속된 직원. 마스터 상태를 일부러 실제와 다르게 둬 쓰기 여부를 드러낸다.
    state.profiles.push({ id: OTHER_STAFF, role: "staff", approval_status: "pending" });
    state.store_memberships.push({ id: "mem-o2", user_id: OTHER_STAFF, store_id: STORE_2, role: "staff", status: "approved" });
    const { client, tables } = createFakeSupabase(state);

    const probe = await remove(client, OWNER_USER, "random-id", STORE_1, OTHER_STAFF);
    const unknownUser = await remove(client, OWNER_USER, "random-id", STORE_1, "88888888-8888-4888-8888-888888888888");
    const noHint = await remove(client, OWNER_USER, "random-id", STORE_1);

    assert.equal(tables.profiles.find((p) => p.id === OTHER_STAFF)?.approval_status, "pending", "타 매장 직원 프로필에 쓰면 안 된다");
    assert.deepEqual(probe, noHint, "직원 계정 여부가 응답으로 드러나면 안 된다");
    assert.deepEqual(unknownUser, noHint);
  });
});

describe("035 remove_staff_membership_by_owner (SQL 정적 검사 — 실제 PostgreSQL 실행 아님)", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/035_remove_staff_membership_rpc.sql"), "utf8");
  const body = sql.slice(sql.indexOf("as $$"), sql.lastIndexOf("$$;"));

  test("최소 권한: search_path 고정, security invoker, service_role만 실행", () => {
    assert.match(sql, /security invoker/);
    assert.match(sql, /set search_path = ''/);
    assert.match(sql, /revoke all on function public\.remove_staff_membership_by_owner\(uuid, uuid, uuid\) from public, anon, authenticated;/);
    assert.match(sql, /grant execute on function public\.remove_staff_membership_by_owner\(uuid, uuid, uuid\) to service_role;/);
    assert.equal(/security definer/i.test(sql), false);
  });

  test("본문의 모든 테이블 참조는 public. 스키마를 명시한다", () => {
    const tableRefs = body.match(/\b(from|update|delete from|into)\s+([a-z_."]+)/gi) ?? [];
    for (const ref of tableRefs) {
      const target = ref.split(/\s+/).pop() ?? "";
      if (/^v_|^owner_m$|^m$|^p$/.test(target)) continue;
      assert.match(target, /^public\./, ref);
    }
  });

  test("잠금 순서: 점주 멤버십 FOR SHARE → 대상 FOR UPDATE → 마스터 프로필 FOR NO KEY UPDATE → 삭제 → 갱신", () => {
    const order = ["for share", "for update", "from public.profiles as p", "for no key update", "delete from public.store_memberships", "update public.profiles"]
      .map((token) => body.indexOf(token));
    assert.ok(order.every((index) => index > 0), JSON.stringify(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.equal(body.split("for update").length - 1, 1, "FOR UPDATE는 대상 멤버십에만 쓴다");
  });

  test("프로필이 없거나 갱신이 0건이면 예외로 롤백한다", () => {
    assert.match(body, /raise exception 'STAFF_PROFILE_MISSING'/);
    assert.match(body, /get diagnostics v_updated = row_count;\s*if v_updated <> 1 then\s*raise exception 'STAFF_PROFILE_UPDATE_FAILED'/);
  });

  test("상태값은 006 제약(pending/approved/rejected)만 쓰고 requested 같은 값을 만들지 않는다", () => {
    assert.equal(/requested/.test(body), false);
    const literals = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const status of literals.filter((value) => ["approved", "pending", "rejected"].includes(value) || /status/.test(value))) {
      assert.ok(["approved", "pending", "rejected"].includes(status), status);
    }
  });

  test("승인 상태는 사용자 전체 멤버십 기준이고, 대표 승인 행 규칙이 JS와 같다", () => {
    assert.match(body, /when bool_or\(m\.status = 'approved'\) then 'approved'/);
    assert.match(body, /when bool_or\(m\.status = 'pending'\) then 'pending'/);
    assert.match(body, /else 'rejected'/);
    assert.match(body, /order by m\.approved_at asc nulls last, m\.id asc/);
    // 역할로 거르지 않는다(JS syncStaffMasterApprovalStatus와 같은 범위).
    assert.equal(/where m\.user_id = v_target\.user_id\s+and m\.role/.test(body), false);

    // JS 쪽 동일 규칙: 가장 이른 approved_at, 같으면 id가 작은 행.
    const update = buildMasterApprovalUpdate([
      { id: "b", status: "approved", approved_at: "2026-09-05T00:00:00.000Z", approved_by: "late-id" },
      { id: "c", status: "approved", approved_at: "2026-09-10T00:00:00.000Z", approved_by: "later" },
      { id: "a", status: "approved", approved_at: "2026-09-05T00:00:00.000Z", approved_by: "early-id" },
      { id: "d", status: "pending" },
    ]);
    assert.equal(update.approved_by, "early-id");

    // nulls last: approved_at이 없는 행은 시각이 있는 행보다 뒤.
    const withNull = buildMasterApprovalUpdate([
      { id: "a", status: "approved", approved_at: null, approved_by: "null-time" },
      { id: "z", status: "approved", approved_at: "2026-09-20T00:00:00.000Z", approved_by: "has-time" },
    ]);
    assert.equal(withNull.approved_by, "has-time");

    // 둘 다 null이면 SQL처럼 id가 작은 행.
    const bothNull = buildMasterApprovalUpdate([
      { id: "b", status: "approved", approved_at: null, approved_by: "id-b" },
      { id: "a", status: "approved", approved_at: null, approved_by: "id-a" },
    ]);
    assert.equal(bothNull.approved_by, "id-a");

    // 같은 ms라도 마이크로초가 다르면 더 이른 시각(Postgres timestamptz 정밀도).
    const micro = buildMasterApprovalUpdate([
      { id: "a", status: "approved", approved_at: "2026-09-05T00:00:00.123456+00:00", approved_by: "later-micro" },
      { id: "b", status: "approved", approved_at: "2026-09-05T00:00:00.123001+00:00", approved_by: "earlier-micro" },
    ]);
    assert.equal(micro.approved_by, "earlier-micro");

    const differentOffsets = buildMasterApprovalUpdate([
      { id: "a", status: "approved", approved_at: "2026-09-05T00:00:00.000100+01:00", approved_by: "earlier-offset" },
      { id: "b", status: "approved", approved_at: "2026-09-04T23:00:00.000900+00:00", approved_by: "later-offset" },
    ]);
    assert.equal(differentOffsets.approved_by, "earlier-offset");
  });

  test("다른 승인 동기화 경로도 대표 행 동률 판정을 위해 id를 함께 조회한다", () => {
    for (const relPath of ["app/api/boss/employees/[id]/route.ts", "app/api/hq/approvals/route.ts"]) {
      const source = readFileSync(path.join(process.cwd(), relPath), "utf8");
      assert.match(source, /\.select\("id, status, approved_at, approved_by"\)/, relPath);
    }
  });
});

describe("점주 소속 해제 연결 (소스 문자열 검사)", () => {
  const read = (relPath: string) => readFileSync(path.join(process.cwd(), relPath), "utf8");

  test("DELETE 라우트는 세션 사용자만 점주 근거로 쓰고 서비스 함수에 위임한다", () => {
    const route = read("app/api/boss/employees/[id]/route.ts");
    assert.match(route, /export async function DELETE\(/);
    assert.match(route, /ownerUserId: user\.id,/);
    assert.match(route, /removeStaffMembershipByOwner\(adminClient, \{/);
  });

  test("직원 관리 화면은 확인창(취소 우선)과 안내 문구 후 DELETE를 보내고 목록을 갱신한다", () => {
    const page = read("app/boss/employees/page.tsx");
    assert.match(page, /method: "DELETE"/);
    assert.match(page, /이 직원의 \{storeName\} 소속을 해제할까요\?/);
    assert.match(page, /해당 매장의 챗봇·매뉴얼·공지·대화를 이용할 수 없게 됩니다\./);
    assert.match(page, /직원 계정과 다른 매장 소속은 유지됩니다\./);
    assert.match(page, /await refreshEmployees\(\);/);
    assert.match(page, /body: JSON\.stringify\(\{ storeId: selectedStoreId \}\)/);
    assert.doesNotMatch(page, /staffUserId/);
    assert.doesNotMatch(read("app/api/boss/employees/[id]/route.ts"), /staffUserId/);
    assert.match(read("components/common/ConfirmDialog.tsx"), /autoFocus=\{isDangerous\}/);
    assert.match(read("components/common/ConfirmDialog.tsx"), /document\.addEventListener\("keydown", handleKeyDown\)/);
    assert.match(read("components/common/ConfirmDialog.tsx"), /if \(e\.key !== "Tab"\) return;/);
    assert.match(page, /if \(removingRef\.current\) return;/);
  });

  test("직원 챗봇은 매장 권한 거부 시 승인 매장 목록을 다시 불러온다", () => {
    const page = read("app/staff/page.tsx");
    assert.match(page, /payload\.code === "STORE_FORBIDDEN"\) \{[\s\S]*?reloadStores\(\);/);
  });
});
