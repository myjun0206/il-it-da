"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useStaffShell } from "@/components/staff/StaffShellContext";
import StoreRequestFlow, {
  type StoreRequestCopy,
  type StoreRequestOutcome,
} from "@/components/stores/StoreRequestFlow";
import type { Store } from "@/lib/types/store";

interface StaffMembership {
  membershipId: string;
  storeId: string;
  storeName: string;
  role: string;
  status: string;
}

const STAFF_COPY: StoreRequestCopy = {
  backHref: "/staff/stores",
  backLabel: "근무 매장으로 돌아가기",
  title: "매장 추가",
  description: "근무할 매장을 검색하고 신청하세요. 해당 매장 점주가 승인하면 근무 매장에 추가됩니다.",
  successTitle: "근무 신청이 완료되었습니다.",
  pendingLabel: "점주 승인 대기",
  successGuide: "점주가 승인하면 근무 매장으로 사용할 수 있습니다.",
  statusHref: "/staff/stores/requests",
  searchIdleText: "근무할 매장을 검색해 주세요.",
  activeBadge: "근무 중",
  selectedLabel: "선택한 근무 매장",
  applyLabel: "근무 신청하기",
  duplicateApproved: "이미 근무 중인 매장입니다.",
  duplicatePending: "이미 승인 대기 중인 매장입니다.",
  duplicateRejected: "이전 신청이 거절된 매장입니다. 점주에게 문의해 주세요.",
};

export default function StaffAddStorePage() {
  const router = useRouter();
  const { reloadStores } = useStaffShell();
  const [memberships, setMemberships] = useState<StaffMembership[]>([]);

  // 본인 staff membership: 헤더 매장명 + 중복 신청 안내. (신청 가능 여부의 최종 판단은 서버가 한다)
  const loadMemberships = async () => {
    const response = await fetch("/api/signup/store-membership", { credentials: "include" });
    if (response.status === 401) {
      router.push("/");
      return [];
    }
    const result = (await response.json()) as { success?: boolean; data?: StaffMembership[] };
    return response.ok && result.success && Array.isArray(result.data)
      ? result.data.filter((membership) => membership.role === "staff")
      : [];
  };

  useEffect(() => {
    let isCancelled = false;

    const loadInitial = async () => {
      const staffMemberships = await loadMemberships();
      if (!isCancelled) setMemberships(staffMemberships);
    };

    void loadInitial();
    return () => {
      isCancelled = true;
    };
    // loadMemberships는 router만 사용하므로 최초 1회만 실행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 직원 신청: 기존 가입 신청 API. 서버가 로그인 사용자/역할을 검증하고 pending membership만 만든다.
  const submitRequest = async (store: Store): Promise<StoreRequestOutcome> => {
    try {
      const response = await fetch("/api/signup/store-membership", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: store.id, storeName: store.name, role: "staff" }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        membershipId?: string;
        created?: boolean;
        membershipStatus?: string;
        code?: string;
      };

      if (response.status === 401 || response.status === 403) {
        return { kind: "error", message: "로그인 정보를 확인할 수 없습니다. 다시 로그인한 뒤 신청해 주세요." };
      }
      if (result.code === "STORE_NO_OWNER") {
        return { kind: "error", message: "아직 점주가 등록되지 않은 매장이라 근무 신청을 할 수 없습니다. 점주가 등록된 뒤 다시 신청해 주세요." };
      }
      if (response.status === 404 || result.code === "STORE_NOT_FOUND") {
        return { kind: "error", message: "일잇다에 등록된 매장이 아니라 신청할 수 없습니다. 매장 이름을 다시 확인해 주세요." };
      }
      if (!response.ok || !result.success || !result.membershipId) {
        return { kind: "error", message: "일시적인 서버 오류로 신청하지 못했습니다. 잠시 후 다시 시도해 주세요." };
      }

      const refreshed = await loadMemberships();
      setMemberships(refreshed);
      // Header/근무 매장 목록의 승인 대기 수도 함께 갱신한다.
      reloadStores();

      // 서버가 기존 membership을 돌려준 경우(중복)는 새 row 없이 현재 상태만 안내한다.
      if (result.created === false) {
        return {
          kind: "error",
          message:
            result.membershipStatus === "approved"
              ? STAFF_COPY.duplicateApproved
              : result.membershipStatus === "pending"
                ? STAFF_COPY.duplicatePending
                : "이전에 거절된 신청이 있는 매장입니다. 점주에게 문의해 주세요.",
        };
      }

      const created = refreshed.find((membership) => membership.membershipId === result.membershipId);
      return { kind: "created", storeName: created?.storeName ?? store.name };
    } catch {
      return { kind: "error", message: "근무 신청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
  };

  return (
    <div className="p-6 lg:p-8">
      {/* 지도 기반 작업 화면이라 일반 페이지(max-w-7xl)보다 조금 넓게 쓴다. (점주 운영 매장 추가와 동일) */}
      <div className="max-w-[1440px] mx-auto">
        <StoreRequestFlow copy={STAFF_COPY} memberships={memberships} onSubmit={submitRequest} />
      </div>
    </div>
  );
}
