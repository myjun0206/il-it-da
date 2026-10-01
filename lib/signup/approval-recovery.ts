/**
 * 승인 마무리(복구)가 필요한지 판정하는 순수 함수.
 *
 * syncProfileApprovalStatus가 마스터 profiles.approval_status를 계산하는 규칙을 그대로 옮겨,
 * 목록 API가 "브랜드 행 누락"뿐 아니라 "마스터 승인 상태 불일치"도 복구 대상으로 표시할 수 있게 한다.
 * 정상적인 복수 매장·복수 역할 계정(한 매장 승인 + 다른 매장 대기)은 기대 상태와 일치하므로 복구 대상이 아니다.
 */

export type MasterApprovalStatus = "approved" | "pending" | "rejected";

/**
 * 006의 store_memberships_status_check는 pending/approved/rejected만 허용하고,
 * 어떤 코드도 "requested"를 저장하지 않는다. 읽기 쪽 방어값으로만 남아 있어 대기로 함께 센다.
 */
export const MEMBERSHIP_PENDING_STATUSES = ["pending", "requested"] as const;

/**
 * 한 사용자의 모든 membership 상태에서 마스터 승인 상태를 계산한다.
 * 하나라도 승인돼 있으면 approved, 아니면 대기가 있으면 pending, 그 외에는 rejected.
 * 멤버십이 0건이거나 알 수 없는 상태만 있으면 기존 정책대로 rejected다(승인으로 해석하지 않는다).
 */
export function expectedMasterApprovalStatus(
  memberships: readonly { status?: unknown }[],
  pendingStatuses: readonly string[] = MEMBERSHIP_PENDING_STATUSES,
): MasterApprovalStatus {
  const statuses = memberships.map((membership) =>
    typeof membership.status === "string" ? membership.status : "",
  );

  if (statuses.includes("approved")) return "approved";
  if (statuses.some((status) => pendingStatuses.includes(status))) return "pending";
  return "rejected";
}

export type MasterApprovalRow = {
  status?: unknown;
  approved_at?: unknown;
  approved_by?: unknown;
};

export type MasterApprovalUpdate = {
  approval_status: MasterApprovalStatus;
  approved_at: string | null;
  approved_by: string | null;
};

/**
 * 마스터 profiles에 쓸 승인 상태 payload. 두 승인 경로가 같은 규칙을 쓰도록 계산만 공유하고,
 * 실제 DB 쓰기와 조회 실패 처리는 각 라우트에 남긴다(조회 실패를 빈 목록으로 바꾸지 않기 위함).
 */
export function buildMasterApprovalUpdate(
  memberships: readonly MasterApprovalRow[],
  now: () => string = () => new Date().toISOString(),
): MasterApprovalUpdate {
  const approvalStatus = expectedMasterApprovalStatus(memberships);
  const firstApproved = memberships.find((membership) => membership.status === "approved");

  if (approvalStatus !== "approved") {
    return { approval_status: approvalStatus, approved_at: null, approved_by: null };
  }

  return {
    approval_status: "approved",
    approved_at: typeof firstApproved?.approved_at === "string" ? firstApproved.approved_at : now(),
    approved_by: typeof firstApproved?.approved_by === "string" ? firstApproved.approved_by : null,
  };
}

export type ApprovalCompletionInput = {
  /** 이 요청(membership)의 현재 상태. approved가 아니면 복구 대상이 아니다. */
  membershipStatus: string;
  /** 승인된 매장 브랜드의 profiles 행이 있는지. 매장 브랜드를 모르면 null. */
  hasBrandProfile: boolean | null;
  /** 마스터 profiles.approval_status 현재 값. */
  masterApprovalStatus: string | null;
  /** 같은 사용자의 모든 membership 상태에서 계산한 기대 값. */
  expectedMasterStatus: MasterApprovalStatus;
};

/**
 * 승인은 됐지만 후속 단계가 끝나지 않아 "승인 마무리"가 필요한 상태인지.
 * 매장 브랜드를 확인할 수 없으면(hasBrandProfile = null) 브랜드 조건은 판정에서 제외한다.
 */
export function needsApprovalCompletion(input: ApprovalCompletionInput): boolean {
  if (input.membershipStatus !== "approved") {
    return false;
  }
  if (input.hasBrandProfile === false) {
    return true;
  }
  return input.masterApprovalStatus !== input.expectedMasterStatus;
}

/** user_id별 membership 상태 목록으로 묶는다. */
export function groupMembershipStatusesByUser(
  rows: readonly { user_id?: unknown; status?: unknown }[],
): Map<string, { status: string }[]> {
  const grouped = new Map<string, { status: string }[]>();

  for (const row of rows) {
    if (typeof row.user_id !== "string" || !row.user_id) continue;
    const status = typeof row.status === "string" ? row.status : "";
    const existing = grouped.get(row.user_id);
    if (existing) {
      existing.push({ status });
    } else {
      grouped.set(row.user_id, [{ status }]);
    }
  }

  return grouped;
}
