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

// 직원 복수 매장 선택은 app/staff/page.tsx의 React state 배선에 달려 있어 Next 런타임 밖에서
// 실행할 수 없다. 회귀(설정 누락으로 선택 목록이 영구히 비는 문제)만 소스 계약으로 고정한다.
describe("app/staff/page.tsx 근무 매장 선택 배선", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/staff/page.tsx"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  test("StaffShellContext에서 근무 매장 목록을 받아 StoreSwitcher에 전달한다", () => {
    assert.match(source, /const \{\s*stores,/);
    assert.match(source, /useStaffShell\(\)/);
    assert.match(source, /stores={stores}/);
  });

  test("StoreSwitcher와 selectStore 함수를 통해 매장을 선택할 수 있다", () => {
    assert.match(source, /onSelect={selectStore}/);
    assert.match(source, /function selectStore/);
  });

  test("서버가 재검증하도록 선택한 매장 id를 질문 요청에 담아 보낸다", () => {
    assert.match(source, /storeId: selectedStore\.id/);
  });

  test("선택 매장이 바뀔 때 이전 매장의 대화·입력·오류를 초기화한다", () => {
    assert.match(source, /function selectStore\(storeId: string\)/);
    assert.match(source, /resetConversation/);
    assert.match(source, /applyStore\(store\)/);
  });

  test("같은 매장을 다시 선택하면 대화를 보존한다", () => {
    assert.match(
      source,
      /if \(!store \|\| \(selectedStore\?\.id === store\.id && readOnlyStoreName === null\)\) return;/,
    );
  });

  test("StoreSwitcher가 매장 로딩 상태를 표시한다", () => {
    assert.match(source, /isLoading={isStoresLoading}/);
    assert.match(source, /selectedStoreId={selectedStore\?\.id \?\? null}/);
  });

  test("목록 조회 실패와 매장 없음을 구분해서 안내한다", () => {
    // storesError가 있으면 에러 메시지 표시
    assert.match(source, /\{storesError && \(/);
    // 매장이 없으면 '승인된 근무 매장이 없습니다' 표시
    assert.match(source, /"승인된 근무 매장이 없습니다/);
    // 두 조건이 분리되어 있음을 확인
    assert.match(source, /!isStoresLoading && !storesError && stores\.length === 0/);
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
