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

  test("/api/staff/stores 응답을 매장 목록 state에 반영한다", () => {
    assert.match(source, /setStores\(availableStores\)/);
  });

  test("매장 목록 state를 빈 배열로만 채우고 끝내지 않는다", () => {
    const assignments = source.match(/setStores\([^)]*\)/g) ?? [];
    assert.ok(assignments.length > 0);
    assert.ok(assignments.some((call) => call !== "setStores([])"));
  });

  test("서버가 재검증하도록 선택한 매장 id를 질문 요청에 담아 보낸다", () => {
    assert.match(source, /storeId: selectedStore\.id/);
  });

  test("매장이 하나면 자동 선택하고 여러 개면 직원이 직접 고르게 둔다", () => {
    assert.match(
      source,
      /const nextStore = restoredStore \?\? \(availableStores\.length === 1 \? availableStores\[0\] : null\)/,
    );
  });

  test("선택 매장이 바뀔 때만 이전 매장의 대화·입력·오류를 초기화한다", () => {
    assert.match(
      source,
      /function resetConversationOnStoreChange\(nextStoreId: string \| null\) \{\s*if \(lastConversationStoreIdRef\.current === nextStoreId\) return;\s*lastConversationStoreIdRef\.current = nextStoreId;\s*setMessages\(INITIAL_MESSAGES\);\s*setInput\(""\);\s*setErrorMessage\(""\);/,
    );
  });

  test("직접 선택과 목록 재조회 두 경로 모두 같은 초기화를 거친다", () => {
    assert.equal((source.match(/resetConversationOnStoreChange\(/g) ?? []).length, 3);
    assert.match(source, /resetConversationOnStoreChange\(store\?\.id \?\? null\);\s*\n\s*setSelectedStore\(store\)/);
    assert.match(source, /resetConversationOnStoreChange\(nextStore\?\.id \?\? null\);\s*\n\s*setSelectedStore\(nextStore\)/);
  });

  test("effect 클로저의 낡은 selectedStore 대신 ref로 직전 매장을 비교한다", () => {
    assert.match(source, /const lastConversationStoreIdRef = useRef<string \| null>\(null\)/);
  });

  test("목록 조회 실패를 '승인 매장 없음'으로 잘못 안내하지 않는다", () => {
    assert.match(
      source,
      /: storesError\s*\n\s*\? "매장 정보를 불러오지 못했습니다"\s*\n\s*: stores\.length > 0/,
    );
  });
});
