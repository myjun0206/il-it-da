"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import OwnerHeader from "@/components/owner/OwnerHeader";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import StoreRequestFlow, {
  type StoreRequestCopy,
  type StoreRequestMembership,
  type StoreRequestOutcome,
} from "@/components/stores/StoreRequestFlow";
import { resolveOwnerCurrentStore } from "@/lib/owner/current-store";
import { createClient } from "@/lib/supabase/client";
import type { Store } from "@/lib/types/store";

const OWNER_COPY: StoreRequestCopy = {
  backHref: "/boss/stores",
  backLabel: "운영 매장으로 돌아가기",
  title: "운영 매장 추가",
  description: "새로 운영할 매장을 검색하고 신청하세요. 본사가 승인하면 운영 매장에 추가됩니다.",
  successTitle: "운영 신청이 완료되었습니다.",
  pendingLabel: "본사 승인 대기",
  successGuide: "본사에서 승인하면 운영 매장으로 선택할 수 있습니다.",
  statusHref: "/boss/stores",
  searchIdleText: "운영할 매장을 검색해 주세요.",
  activeBadge: "운영 중",
  selectedLabel: "선택한 운영 매장",
  applyLabel: "운영 신청하기",
  duplicateApproved: "이미 운영 중인 매장입니다.",
  duplicatePending: "이미 본사 승인 대기 중인 매장입니다.",
  duplicateRejected: "이전 신청이 거절된 매장입니다. 본사에 문의해 주세요.",
};

// 본인 owner membership (검색 결과 배지·중복 안내용). 최종 판단은 서버가 한다.
async function loadOwnerMemberships(): Promise<{ list: StoreRequestMembership[]; currentName: string }> {
  const resolution = await resolveOwnerCurrentStore();
  if (resolution.status === "error") return { list: [], currentName: "" };
  return {
    list: [
      ...resolution.stores.map((store) => ({ storeName: store.storeName, status: "approved" })),
      ...resolution.pending.map((store) => ({ storeName: store.storeName, status: "pending" })),
    ],
    currentName: resolution.current?.storeName ?? "",
  };
}

export default function OwnerAddStorePage() {
  const router = useRouter();
  const [userName, setUserName] = useState("점주");
  const [headerStoreName, setHeaderStoreName] = useState("");
  const [memberships, setMemberships] = useState<StoreRequestMembership[]>([]);

  useEffect(() => {
    let isCancelled = false;
    void createClient()
      .auth.getSession()
      .then(({ data }) => {
        const name = data.session?.user?.user_metadata?.name;
        if (!isCancelled && name) setUserName(name);
      });
    void loadOwnerMemberships().then(({ list, currentName }) => {
      if (isCancelled) return;
      setMemberships(list);
      setHeaderStoreName(currentName);
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  // 점주 신청: 전용 API(브랜드 일치 검증 + owner pending membership). 승인은 기존 HQ 승인 화면에서만 한다.
  const submitRequest = async (store: Store): Promise<StoreRequestOutcome> => {
    try {
      const response = await fetch("/api/boss/stores/requests", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: store.id, storeName: store.name }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        membershipId?: string;
        created?: boolean;
        membershipStatus?: string;
        code?: string;
        requestId?: string;
        error?: string;
      };

      if (response.status === 401) {
        return { kind: "error", message: "로그인 정보를 확인할 수 없습니다. 다시 로그인한 뒤 신청해 주세요." };
      }
      if (result.code === "STORE_BRAND_UNKNOWN") {
        return {
          kind: "error",
          message: "이 매장의 브랜드 정보가 연결되어 있지 않아 신청할 수 없습니다. 본사에 문의해 주세요.",
        };
      }
      if (response.status === 403) {
        return { kind: "error", message: "운영 매장을 추가할 권한이 없습니다." };
      }
      if (!response.ok || !result.success || !result.membershipId) {
        const requestReference = result.requestId ? ` (문의 ID: ${result.requestId})` : "";
        return {
          kind: "error",
          message: `일시적인 서버 오류로 신청하지 못했습니다. 잠시 후 다시 시도해 주세요.${requestReference}`,
        };
      }

      const refreshed = await loadOwnerMemberships();
      setMemberships(refreshed.list);

      // 서버가 기존 membership을 돌려준 경우(중복)는 새 row 없이 현재 상태만 안내한다.
      if (result.created === false) {
        return {
          kind: "error",
          message:
            result.membershipStatus === "approved"
              ? OWNER_COPY.duplicateApproved
              : result.membershipStatus === "pending"
                ? OWNER_COPY.duplicatePending
                : OWNER_COPY.duplicateRejected,
        };
      }

      return { kind: "created", storeName: store.name };
    } catch {
      return { kind: "error", message: "운영 신청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
  };

  const handleLogout = async () => {
    try {
      await createClient().auth.signOut();
    } finally {
      router.push("/");
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex">
      <OwnerSidebar activeMenu="stores" onLogout={handleLogout} />

      <div className="flex-1 flex flex-col lg:ml-[240px]">
        <OwnerHeader userName={userName} storeName={headerStoreName} onLogout={handleLogout} />

        <main className="flex-1 p-6 lg:p-8">
          {/* 지도 기반 작업 화면이라 일반 페이지(max-w-7xl)보다 조금 넓게 쓴다. */}
          <div className="max-w-[1440px] mx-auto">
            <StoreRequestFlow copy={OWNER_COPY} memberships={memberships} onSubmit={submitRequest} />
          </div>
        </main>
      </div>
    </div>
  );
}
