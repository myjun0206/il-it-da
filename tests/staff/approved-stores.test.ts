import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  failedStaffStoresResult,
  filterApprovedStaffMemberships,
  successfulStaffStoresResult,
  toStaffStores,
  unauthorizedStaffStoresResult,
} from "../../lib/staff/approved-stores.ts";

const CURRENT_USER_ID = "current-user";

function membership(overrides: Record<string, unknown> = {}) {
  return {
    user_id: CURRENT_USER_ID,
    store_id: "store-a",
    role: "staff",
    status: "approved",
    ...overrides,
  };
}

describe("filterApprovedStaffMemberships", () => {
  test("keeps only the current user's approved staff memberships", () => {
    const storeIds = filterApprovedStaffMemberships([
      membership(),
      membership({ status: "pending", store_id: "pending-store" }),
      membership({ status: "rejected", store_id: "rejected-store" }),
      membership({ role: "owner", store_id: "owner-store" }),
      membership({ user_id: "other-user", store_id: "other-user-store" }),
    ], CURRENT_USER_ID);

    assert.deepEqual(storeIds, ["store-a"]);
  });

  test("deduplicates repeated approved memberships for the same store", () => {
    const storeIds = filterApprovedStaffMemberships([
      membership(),
      membership(),
    ], CURRENT_USER_ID);

    assert.deepEqual(storeIds, ["store-a"]);
  });

  test("returns an empty list when no membership is eligible", () => {
    const storeIds = filterApprovedStaffMemberships([
      membership({ status: "pending" }),
      membership({ role: "owner" }),
    ], CURRENT_USER_ID);

    assert.deepEqual(storeIds, []);
  });
});

describe("toStaffStores", () => {
  test("returns only id and name for stores referenced by approved memberships", () => {
    const stores = toStaffStores(
      ["store-a", "store-b"],
      [
        { id: "store-a", store_name: "Store A", boss_id: "internal" },
        { id: "store-b", store_name: "Store B", user_id: "internal" },
        { id: "unapproved-store", store_name: "Do Not Return" },
      ],
    );

    assert.deepEqual(stores, [
      { id: "store-a", name: "Store A" },
      { id: "store-b", name: "Store B" },
    ]);
    const serialized = JSON.stringify(stores);
    assert.equal(serialized.includes("boss_id"), false);
    assert.equal(serialized.includes("user_id"), false);
    assert.equal(serialized.includes("membership"), false);
  });

  test("omits missing or invalid store rows", () => {
    const stores = toStaffStores(
      ["store-a", "missing-store"],
      [{ id: "store-a", store_name: "Store A" }, { id: "missing-store", store_name: "" }],
    );

    assert.deepEqual(stores, [{ id: "store-a", name: "Store A" }]);
  });
});

describe("staff stores API results", () => {
  test("uses a fixed 401 response for unauthenticated users", () => {
    assert.deepEqual(unauthorizedStaffStoresResult(), {
      status: 401,
      body: { error: "Unauthorized." },
    });
  });

  test("returns a 200 empty stores array for users without approved staff membership", () => {
    assert.deepEqual(successfulStaffStoresResult([]), {
      status: 200,
      body: { stores: [] },
    });
  });

  test("uses a fixed 500 response without raw database details", () => {
    assert.deepEqual(failedStaffStoresResult(), {
      status: 500,
      body: { error: "Unable to load approved stores." },
    });
  });
});

describe("app/staff/page.tsx 근무 매장 선택 배선", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
  const source = read("app/staff/page.tsx");
  const shell = read("components/staff/StaffShellContext.tsx");
  const header = read("components/staff/StaffHeader.tsx");
  const menu = read("components/common/ProfileMenu.tsx");

  test("StaffShellContext의 승인 매장 목록을 Header의 ProfileMenu에 전달한다", () => {
    assert.match(source, /const \{\s*stores,/);
    assert.match(source, /useStaffShell\(\)/);
    assert.match(shell, /fetch\("\/api\/staff\/stores"/);
    assert.match(header, /useStaffShell\(\)/);
    assert.match(header, /<ProfileMenu[\s\S]*?stores={stores}/);
    assert.match(menu, /approvedStores\.map\(\(store\) =>/);
  });

  test("ProfileMenu의 기본 매장 선택을 공통 상태의 활성 매장에 반영한다", () => {
    assert.match(header, /onSetDefaultStore={handleSetDefaultStore}/);
    assert.match(header, /await saveStorePreferences\(\{ defaultStoreId: storeId, order: stores\.map/);
    assert.match(menu, /onClick={\(\) => void handleSelectStore\(store\.id\)}/);
    assert.match(menu, /await onSetDefaultStore\(storeId\)/);
    assert.match(shell, /selectedStore = stores\.find\(\(store\) => store\.id === defaultStoreId\)/);
  });

  test("서버가 재검증하도록 선택한 매장 id를 질문 요청에 담아 보낸다", () => {
    assert.match(source, /storeId: selectedStore\.id/);
  });

  test("선택 매장이 바뀔 때 이전 매장의 대화·입력·오류를 초기화한다", () => {
    assert.match(source, /useEffectEvent\(\(\) => resetConversation\(\)\)/);
    assert.match(source, /previousStoreId !== null && previousStoreId !== nextStoreId\) \{\s*resetForStoreChange\(\)/);
    const reset = source.slice(source.indexOf("function resetConversation("), source.indexOf("const resetForStoreChange"));
    for (const assertion of [/setMessages\(messagesToUse\)/, /setConversationId\(null\)/, /writeStaffConversationId\(null\)/, /setInput\(""\)/, /setErrorMessage\(""\)/]) {
      assert.match(reset, assertion);
    }
  });

  test("같은 매장을 다시 선택하면 대화를 보존한다", () => {
    assert.match(source, /previousStoreId !== null && previousStoreId !== nextStoreId/);
    assert.match(shell, /defaultStoreId !== current\.defaultStoreId && defaultStoreId !== selectedStore\?\.id/);
    assert.match(source, /function applyStore\(store: StaffStore\) \{[\s\S]*?previousStoreIdRef\.current = store\.id;\s*selectShellStore\(store\.id\)/);
  });

  test("ProfileMenu가 매장 로딩 상태를 표시하고 로딩 중 선택과 질문 전송을 차단한다", () => {
    assert.match(header, /isStoresLoading={isStoresLoading}/);
    assert.match(header, /defaultStoreId={defaultStoreId}/);
    assert.match(menu, /approvedStores\.length > 0 \|\| isStoresLoading/);
    assert.match(menu, /isStoresLoading \? "근무 매장을 불러오는 중/);
    assert.match(menu, /if \(!onSetDefaultStore \|\| isSettingDefault \|\| isStoresLoading\) return/);
    assert.match(menu, /disabled={isStoresLoading \|\| isSettingDefault \|\| !hasMultipleStores}/);
    assert.match(menu, /disabled={isStoresLoading \|\| isSettingDefault}/);
    assert.match(source, /const isBusy = isLoading \|\| isStoresLoading \|\| isConversationLoading/);
    assert.match(source, /const canAsk = !isBusy && Boolean\(selectedStore\)/);
    assert.match(source, /if \(!question \|\| isBusy\) return/);
    assert.match(source, /<input[\s\S]*?disabled={!canAsk}/);
    assert.match(source, /type="submit"\s+disabled={!canAsk \|\| !input\.trim\(\)}/);
    assert.match(source, /<QuickQuestionsScroller[^>]*canAsk={canAsk}/);
  });

  test("목록 조회 실패와 매장 없음을 구분해서 안내한다", () => {
    // storesError가 있으면 에러 메시지 표시
    assert.match(source, /\{storesError && \(/);
    // 매장이 없으면 '승인된 근무 매장이 없습니다' 표시
    assert.match(source, /"승인된 근무 매장이 없습니다/);
    // 두 조건이 분리되어 있음을 확인
    assert.match(source, /!isStoresLoading && !storesError && stores\.length === 0/);
    assert.match(shell, /if \(!approvedResponse\.ok \|\| !Array\.isArray\(approvedPayload\.stores\)\) throw/);
    assert.match(shell, /catch \{[\s\S]*?selectedStore: null,[\s\S]*?isStoresLoading: false,[\s\S]*?storesError: "승인된 근무 매장을 불러오지 못했습니다/);
  });

  test("권한 해제 시 기존 대화를 비우고 재조회 동안 질문을 차단하며 유효한 매장으로 갱신한다", () => {
    assert.match(source, /payload\.code === "STORE_FORBIDDEN"\) \{[\s\S]*?resetConversation\(\);[\s\S]*?reloadStores\(\);\s*return/);
    assert.match(shell, /const reloadStores[\s\S]*?isStoresLoading: true, storesError: ""[\s\S]*?setReloadToken/);
    assert.match(shell, /stores\.find\(\(store\) => store\.id === storedStoreId\) \?\?[\s\S]*?stores\[0\] \?\?\s*null/);
    assert.match(source, /if \(previousStoreIdRef\.current !== selectedStore\.id\) return/);
    assert.match(source, /if \(controller\.signal\.aborted\) return;\s*restoreCheckedRef\.current = true/);
  });
});

describe("직원 공통 매뉴얼 접근 범위", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const manualsRoute = readFileSync(path.join(repoRoot, "app/api/staff/manuals/route.ts"), "utf8").replace(/\r\n/g, "\n");
  const migration = readFileSync(
    path.join(repoRoot, "supabase/migrations/029_staff_hq_manual_read_access.sql"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  test("공통 매뉴얼은 검증된 지점의 franchise_id와 store_id NULL 기준으로 조회하고 승인된 행만 반환한다", () => {
    assert.match(manualsRoute, /\.eq\("franchise_id", franchise\.franchiseId\)\.is\("store_id", null\)/);
    assert.match(manualsRoute, /\.eq\("status", "approved"\)/);
  });

  test("구형 HQ 공통 매뉴얼의 franchise_id를 유일하게 일치하는 브랜드명으로 보정한다", () => {
    assert.match(migration, /m\.franchise_id is null\s+and m\.store_id is null/);
    assert.match(migration, /select count\(\*[\s\S]*?\) = 1/i);
    assert.match(migration, /lower\(btrim\(m\.brand_name\)\)/i);
  });

  test("RLS는 승인된 staff에게 같은 franchise의 승인 HQ 공통 매뉴얼만 허용한다", () => {
    assert.match(migration, /create policy manuals_select_approved_staff_common/);
    assert.match(migration, /membership\.role = 'staff'/);
    assert.match(migration, /membership\.status = 'approved'/);
    assert.match(migration, /status = 'approved'/);
    assert.match(migration, /membership\.franchise_id = manuals\.franchise_id/);
    assert.match(migration, /store_id is null/);
  });

  test("상세 조회 로그는 명시적으로 활성화했을 때만 원본 매뉴얼 행을 기록한다", () => {
    assert.match(manualsRoute, /process\.env\.MANUAL_LOOKUP_DEBUG === "1"/);
    assert.match(manualsRoute, /store_id: storeId/);
    assert.match(manualsRoute, /franchise_id: franchise\.franchiseId/);
    assert.match(manualsRoute, /raw_rows: data/);
    assert.match(manualsRoute, /raw_rows: franchiseRows/);
    assert.match(manualsRoute, /raw_rows: legacyRows/);
    assert.match(manualsRoute, /rls_bypassed_by_service_role: true/);
  });
});
