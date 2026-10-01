import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  MEMBERSHIP_PENDING_STATUSES,
  buildMasterApprovalUpdate,
  expectedMasterApprovalStatus,
  groupMembershipStatusesByUser,
  needsApprovalCompletion,
} from "../../lib/signup/approval-recovery.ts";

const USER_A = "user-a";
const USER_B = "user-b";

const COMPLETE = {
  membershipStatus: "approved",
  hasBrandProfile: true,
  masterApprovalStatus: "approved",
  expectedMasterStatus: "approved" as const,
};

describe("buildMasterApprovalUpdate (실제 함수 실행)", () => {
  const FIXED_NOW = () => "2026-10-01T00:00:00.000Z";

  test("승인이 하나라도 있으면 그 승인 정보를 그대로 쓴다", () => {
    assert.deepEqual(
      buildMasterApprovalUpdate(
        [
          { status: "rejected", approved_at: null, approved_by: null },
          { status: "approved", approved_at: "2026-09-30T10:00:00.000Z", approved_by: "hq-user" },
        ],
        FIXED_NOW,
      ),
      {
        approval_status: "approved",
        approved_at: "2026-09-30T10:00:00.000Z",
        approved_by: "hq-user",
      },
    );
  });

  test("approved + requested 조합도 approved다", () => {
    assert.equal(
      buildMasterApprovalUpdate([{ status: "approved" }, { status: "requested" }], FIXED_NOW).approval_status,
      "approved",
    );
  });

  test("승인 시각이 없으면 현재 시각으로 채운다", () => {
    const update = buildMasterApprovalUpdate([{ status: "approved" }], FIXED_NOW);
    assert.equal(update.approved_at, FIXED_NOW());
    assert.equal(update.approved_by, null);
  });

  test("pending·requested만 있으면 승인 정보를 비운다", () => {
    for (const status of ["pending", "requested"]) {
      assert.deepEqual(buildMasterApprovalUpdate([{ status }], FIXED_NOW), {
        approval_status: "pending",
        approved_at: null,
        approved_by: null,
      });
    }
  });

  test("거절만 있거나 멤버십이 0건이면 기존 정책대로 rejected다", () => {
    for (const memberships of [[{ status: "rejected" }], []]) {
      assert.deepEqual(buildMasterApprovalUpdate(memberships, FIXED_NOW), {
        approval_status: "rejected",
        approved_at: null,
        approved_by: null,
      });
    }
  });

  test("알 수 없는 상태를 승인으로 해석하지 않는다", () => {
    assert.equal(buildMasterApprovalUpdate([{ status: "archived" }], FIXED_NOW).approval_status, "rejected");
  });

  test("복수 브랜드·owner/staff 혼합에서도 승인이 있으면 approved다", () => {
    const update = buildMasterApprovalUpdate(
      [
        { status: "approved", approved_at: "2026-09-01T00:00:00.000Z", approved_by: "hq-a" },
        { status: "pending" },
        { status: "approved", approved_at: "2026-09-20T00:00:00.000Z", approved_by: "owner-b" },
      ],
      FIXED_NOW,
    );

    assert.equal(update.approval_status, "approved");
    assert.equal(update.approved_at, "2026-09-01T00:00:00.000Z");
  });

  test("갱신 payload는 approval_status·approved_at·approved_by만 담는다", () => {
    assert.deepEqual(
      Object.keys(buildMasterApprovalUpdate([{ status: "approved" }], FIXED_NOW)).sort(),
      ["approval_status", "approved_at", "approved_by"],
    );
  });

  test("복구 판정과 실제 갱신이 같은 상태를 쓴다", () => {
    const memberships = [{ status: "approved" }, { status: "requested" }];
    const written = buildMasterApprovalUpdate(memberships, FIXED_NOW).approval_status;
    const expected = expectedMasterApprovalStatus(memberships);

    assert.equal(written, expected);
    assert.equal(
      needsApprovalCompletion({
        membershipStatus: "approved",
        hasBrandProfile: true,
        masterApprovalStatus: written,
        expectedMasterStatus: expected,
      }),
      false,
    );
  });
});

describe("expectedMasterApprovalStatus (실제 함수 실행)", () => {
  test("하나라도 승인돼 있으면 approved다", () => {
    assert.equal(
      expectedMasterApprovalStatus([{ status: "approved" }, { status: "pending" }]),
      "approved",
    );
  });

  test("대기만 있으면 pending이다", () => {
    assert.equal(expectedMasterApprovalStatus([{ status: "pending" }]), "pending");
    assert.equal(expectedMasterApprovalStatus([{ status: "requested" }]), "pending");
  });

  test("pending과 requested를 모두 대기로 센다", () => {
    assert.deepEqual([...MEMBERSHIP_PENDING_STATUSES], ["pending", "requested"]);
    assert.equal(
      expectedMasterApprovalStatus([{ status: "requested" }, { status: "rejected" }]),
      "pending",
    );
  });

  test("거절만 있거나 목록이 비면 rejected다", () => {
    assert.equal(expectedMasterApprovalStatus([{ status: "rejected" }]), "rejected");
    assert.equal(expectedMasterApprovalStatus([]), "rejected");
  });

  test("형식이 깨진 행은 상태 없음으로 취급한다", () => {
    assert.equal(expectedMasterApprovalStatus([{ status: null }, { status: 1 }]), "rejected");
    assert.equal(expectedMasterApprovalStatus([{}, { status: "approved" }]), "approved");
  });
});

describe("needsApprovalCompletion (실제 함수 실행)", () => {
  test("브랜드 행이 없으면 복구가 필요하다", () => {
    assert.equal(needsApprovalCompletion({ ...COMPLETE, hasBrandProfile: false }), true);
  });

  test("브랜드 행은 있지만 마스터 상태만 다르면 복구가 필요하다", () => {
    assert.equal(
      needsApprovalCompletion({ ...COMPLETE, masterApprovalStatus: "pending" }),
      true,
    );
    assert.equal(needsApprovalCompletion({ ...COMPLETE, masterApprovalStatus: null }), true);
  });

  test("모두 정상이면 복구가 필요 없다", () => {
    assert.equal(needsApprovalCompletion(COMPLETE), false);
  });

  test("승인되지 않은 요청은 복구 대상이 아니다", () => {
    for (const membershipStatus of ["pending", "requested", "rejected"]) {
      assert.equal(
        needsApprovalCompletion({ ...COMPLETE, membershipStatus, hasBrandProfile: false }),
        false,
        membershipStatus,
      );
    }
  });

  test("매장 브랜드를 모르면 브랜드 조건은 판정에서 빼고 상태만 본다", () => {
    assert.equal(needsApprovalCompletion({ ...COMPLETE, hasBrandProfile: null }), false);
    assert.equal(
      needsApprovalCompletion({ ...COMPLETE, hasBrandProfile: null, masterApprovalStatus: "pending" }),
      true,
    );
  });
});

describe("정상 복수 매장·역할 계정은 복구 대상이 아니다", () => {
  test("한 매장 승인 + 다른 매장 대기여도 approved가 기대값이다", () => {
    const memberships = [{ status: "approved" }, { status: "pending" }];
    const expected = expectedMasterApprovalStatus(memberships);

    assert.equal(expected, "approved");
    assert.equal(
      needsApprovalCompletion({
        membershipStatus: "approved",
        hasBrandProfile: true,
        masterApprovalStatus: "approved",
        expectedMasterStatus: expected,
      }),
      false,
    );
  });

  test("여러 브랜드에 승인된 계정도 복구 대상이 아니다", () => {
    const expected = expectedMasterApprovalStatus([
      { status: "approved" },
      { status: "approved" },
      { status: "rejected" },
    ]);

    assert.equal(expected, "approved");
    assert.equal(
      needsApprovalCompletion({ ...COMPLETE, expectedMasterStatus: expected }),
      false,
    );
  });

  test("거절만 남은 계정은 rejected가 기대값이고 승인 행이 없으므로 대상이 아니다", () => {
    const expected = expectedMasterApprovalStatus([{ status: "rejected" }]);
    assert.equal(
      needsApprovalCompletion({
        membershipStatus: "rejected",
        hasBrandProfile: false,
        masterApprovalStatus: "rejected",
        expectedMasterStatus: expected,
      }),
      false,
    );
  });

  test("재시도로 두 조건이 채워지면 복구 표시가 해제된다", () => {
    const before = needsApprovalCompletion({
      ...COMPLETE,
      hasBrandProfile: false,
      masterApprovalStatus: "pending",
    });
    const after = needsApprovalCompletion(COMPLETE);

    assert.equal(before, true);
    assert.equal(after, false);
  });
});

describe("groupMembershipStatusesByUser (실제 함수 실행)", () => {
  test("사용자별로 상태를 모은다", () => {
    const grouped = groupMembershipStatusesByUser([
      { user_id: USER_A, status: "approved" },
      { user_id: USER_A, status: "pending" },
      { user_id: USER_B, status: "rejected" },
    ]);

    assert.deepEqual(grouped.get(USER_A), [{ status: "approved" }, { status: "pending" }]);
    assert.deepEqual(grouped.get(USER_B), [{ status: "rejected" }]);
  });

  test("user_id가 없는 행은 버린다", () => {
    const grouped = groupMembershipStatusesByUser([{ status: "approved" }, { user_id: "", status: "approved" }]);
    assert.equal(grouped.size, 0);
  });

  test("조회 결과가 비면 빈 목록이고 기대값은 rejected다", () => {
    const grouped = groupMembershipStatusesByUser([]);
    assert.equal(expectedMasterApprovalStatus(grouped.get(USER_A) ?? []), "rejected");
  });
});

// 아래는 라우트·화면 소스 계약 검사다(HTTP 요청을 실행하지 않는다).
describe("목록 API 계약", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const read = (relativePath: string) =>
    readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
  const hqRoute = read("app/api/hq/approvals/route.ts");
  const employeesRoute = read("app/api/boss/employees/route.ts");
  const hqPage = read("app/hq/approvals/page.tsx");
  const employeesPage = read("app/boss/employees/page.tsx");

  test("두 목록 API가 같은 판정 함수를 쓴다", () => {
    for (const source of [hqRoute, employeesRoute]) {
      assert.match(source, /needsApprovalCompletion\(\{/);
      assert.match(source, /expectedMasterApprovalStatus\(/);
      assert.match(source, /groupMembershipStatusesByUser\(/);
    }
  });

  test("각 경로가 자기 승인 규칙의 대기 상태 집합을 쓴다", () => {
    // 두 경로 모두 공통 기본값을 쓰므로 경로별 상수를 넘기지 않는다.
    assert.equal(/HQ_PENDING_STATUSES|STAFF_PENDING_STATUSES/.test(hqRoute), false);
    assert.equal(/HQ_PENDING_STATUSES|STAFF_PENDING_STATUSES/.test(employeesRoute), false);
  });

  test("마스터 승인 상태를 조회해 비교한다", () => {
    assert.match(hqRoute, /\.select\("id, full_name, email, approval_status"\)/);
    assert.match(employeesRoute, /\.select\("user_id, full_name, email, approval_status"\)/);
  });

  test("상태 조회 실패를 복구 불필요로 위장하지 않는다", () => {
    assert.match(hqRoute, /if \(allMembershipError\) \{[\s\S]{0,160}status: 500/);
    assert.match(hqRoute, /if \(brandProfileError\) \{[\s\S]{0,160}status: 500/);
    assert.match(employeesRoute, /if \(allStaffMembershipError\) \{[\s\S]{0,300}status: 500/);
    assert.match(employeesRoute, /if \(brandProfileError\) \{[\s\S]{0,300}status: 500/);
    assert.match(employeesRoute, /if \(storeRowError\) \{[\s\S]{0,300}status: 500/);
  });

  test("오류 응답·로그에 DB 원문을 넣지 않는다", () => {
    // MembershipAuthNotReadyError.message는 우리가 정한 고정 안내 문구라 대상이 아니다.
    for (const dbError of [
      "brandProfileError",
      "allMembershipError",
      "allStaffMembershipError",
      "storeRowError",
      "profileError",
    ]) {
      for (const source of [hqRoute, employeesRoute]) {
        assert.equal(source.includes(`error: ${dbError}.message`), false, dbError);
        assert.equal(source.includes(`, ${dbError})`), false, dbError);
      }
    }
    assert.match(employeesRoute, /code: brandProfileError\.code/);
    assert.match(employeesRoute, /code: allStaffMembershipError\.code/);
  });

  test("복구 버튼과 안내가 두 화면에 남아 있다", () => {
    assert.match(hqPage, /membership\.needs_brand_profile_recovery \?/);
    assert.match(employeesPage, /staff\.needsBrandProfileRecovery \?/);
    for (const page of [hqPage, employeesPage]) {
      assert.match(page, /승인 마무리/);
      assert.match(page, /승인 후처리가 끝나지 않았어요\./);
    }
  });

  test("두 승인 경로가 같은 공통 갱신 함수를 쓴다", () => {
    const staffApprovalRoute = read("app/api/boss/employees/[id]/route.ts");
    for (const source of [hqRoute, staffApprovalRoute]) {
      assert.match(source, /\.update\(buildMasterApprovalUpdate\(memberships \?\? \[\]\)\)/);
      assert.match(source, /\.eq\("id", userId\)/);
      // 조회 실패는 빈 목록으로 바꾸지 않고 그대로 던진다.
      assert.match(source, /if \(error\) \{\s*\n\s*throw error;/);
    }
    assert.equal(/hasPending|hasApproved/.test(staffApprovalRoute), false);
    assert.equal(/hasPending|hasApproved/.test(hqRoute), false);
  });

  test("기존 권한 검사와 중복 알림 방지는 그대로다", () => {
    assert.match(hqRoute, /isMembershipInHqFranchise\(/);
    assert.match(hqRoute, /if \(!alreadyApproved\) \{\s*\n\s*createNotification\(/);
  });
});
