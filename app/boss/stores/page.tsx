"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Plus, RefreshCw, Store as StoreIcon } from "lucide-react";

import {
  ApprovedStoreRow,
  PendingStoreRow,
  StoreMembershipList,
} from "@/components/stores/StoreMembershipList";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";

import OwnerHeader from "@/components/owner/OwnerHeader";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import { resolveOwnerCurrentStore, type OwnerPendingStore, type OwnerStore } from "@/lib/owner/current-store";
import { createClient } from "@/lib/supabase/client";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; approved: OwnerStore[]; pending: OwnerPendingStore[]; currentId: string | null };

// 운영 중 = approved owner membership, 승인 대기 = pending owner membership (점주 공통 resolver)
async function loadOwnerStores(): Promise<LoadState> {
  const resolution = await resolveOwnerCurrentStore();
  if (resolution.status === "error") return { status: "error" };
  return {
    status: "ready",
    approved: resolution.stores,
    pending: resolution.pending,
    currentId: resolution.current?.storeId ?? null,
  };
}

export default function OwnerStoresPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("점주");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    void loadOwnerStores().then(setState);
  }, []);

  useEffect(() => {
    let isCancelled = false;
    void createClient()
      .auth.getSession()
      .then(({ data }) => {
        const name = data.session?.user?.user_metadata?.name;
        if (!isCancelled && name) setUserName(name);
      });
    void loadOwnerStores().then((result) => {
      if (!isCancelled) setState(result);
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  const cancelRequest = async (request: OwnerPendingStore) => {
    if (cancelingId) return;
    if (!window.confirm(`${formatStoreDisplayName(request.storeName)} 운영 신청을 취소할까요?`)) return;

    setCancelingId(request.membershipId);
    setNotice(null);
    try {
      const response = await fetch(`/api/boss/stores/requests/${encodeURIComponent(request.membershipId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const result = (await response.json()) as { success?: boolean; code?: string };
      if (response.ok && result.success) {
        setNotice({ type: "success", message: "운영 신청을 취소했습니다." });
      } else if (result.code === "NOT_PENDING") {
        setNotice({ type: "error", message: "이미 처리된 신청이라 취소할 수 없습니다. 목록을 새로 불러왔습니다." });
      } else {
        setNotice({ type: "error", message: "신청을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요." });
      }
    } catch {
      setNotice({ type: "error", message: "신청을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    } finally {
      setCancelingId(null);
      reload();
    }
  };

  const handleLogout = async () => {
    try {
      await createClient().auth.signOut();
    } finally {
      router.push("/");
    }
  };

  const currentStoreName =
    state.status === "ready" ? state.approved.find((store) => store.storeId === state.currentId)?.storeName ?? "" : "";

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex">
      <OwnerSidebar activeMenu="stores" onLogout={handleLogout} />

      <div className="flex-1 min-w-0 flex flex-col lg:ml-[240px]">
        <OwnerHeader userName={userName} storeName={currentStoreName} onLogout={handleLogout} />

        <main className="flex-1 overflow-y-auto">
          <div className="p-6 lg:p-8 max-w-7xl mx-auto">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">운영 매장</h1>
                <p className="text-base text-[var(--color-text-secondary)]">
                  운영 중인 매장과 승인 대기 중인 신청을 관리할 수 있습니다.
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
                  현재 운영 매장 변경은 상단의 현재 운영 매장 선택에서 할 수 있습니다.
                </p>
              </div>
              <Link
                href="/boss/stores/add"
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 self-start rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 sm:self-auto"
              >
                <Plus size={18} aria-hidden="true" /> 운영 매장 추가
              </Link>
            </div>

            {notice && (
              <p
                role={notice.type === "error" ? "alert" : "status"}
                className={`mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
                  notice.type === "error"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-[var(--color-primary)]/30 bg-[var(--color-primary-light)]/30 text-[var(--color-primary)]"
                }`}
              >
                {notice.type === "error" ? (
                  <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                )}
                {notice.message}
              </p>
            )}

            {state.status === "loading" ? (
              <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
                <p className="text-base text-[var(--color-text-secondary)]" role="status">운영 매장을 불러오는 중...</p>
              </div>
            ) : state.status === "error" ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
                <AlertCircle size={20} className="shrink-0 text-red-700" aria-hidden="true" />
                <p className="flex-1 text-sm text-red-700">운영 매장 정보를 불러오지 못했습니다.</p>
                <button
                  type="button"
                  onClick={reload}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <RefreshCw size={16} aria-hidden="true" /> 다시 시도
                </button>
              </div>
            ) : (
              <div className="space-y-10">
                <div className="flex flex-wrap gap-2" aria-label="운영 매장 요약">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary-light)]/40 px-3 py-1 text-sm font-semibold text-[var(--color-primary)]">
                    운영 중 {state.approved.length}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">
                    승인 대기 {state.pending.length}
                  </span>
                </div>

                {state.approved.length === 0 && state.pending.length === 0 ? (
                  <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
                    <StoreIcon size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                    <p className="text-base font-semibold text-[var(--color-text-primary)]">아직 운영 매장이 없습니다.</p>
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">운영할 매장을 추가 신청하면 본사 승인 후 운영 매장으로 선택할 수 있습니다.</p>
                    <Link
                      href="/boss/stores/add"
                      className="mt-5 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
                    >
                      <Plus size={18} aria-hidden="true" /> 운영 매장 추가
                    </Link>
                  </div>
                ) : (
                  <>
                    <section aria-labelledby="approved-heading">
                      <h2 id="approved-heading" className="mb-3 text-lg font-bold text-[var(--color-text-primary)]">
                        운영 중
                      </h2>
                      {state.approved.length === 0 ? (
                        <p className="rounded-xl border border-[var(--color-border)] bg-white px-5 py-4 text-sm text-[var(--color-text-secondary)]">
                          현재 운영 중인 매장이 없습니다.
                        </p>
                      ) : (
                        <StoreMembershipList label="운영 중 매장">
                          {state.approved.map((store) => (
                            <ApprovedStoreRow
                              key={store.storeId}
                              storeId={store.storeId}
                              storeName={store.storeName}
                              isCurrent={store.storeId === state.currentId}
                            />
                          ))}
                        </StoreMembershipList>
                      )}
                    </section>

                    <section aria-labelledby="pending-heading">
                      <h2 id="pending-heading" className="mb-3 text-lg font-bold text-[var(--color-text-primary)]">
                        승인 대기
                      </h2>
                      {state.pending.length === 0 ? (
                        <p className="text-sm text-[var(--color-text-secondary)]">승인 대기 중인 신청이 없습니다.</p>
                      ) : (
                        <StoreMembershipList label="승인 대기 신청">
                          {state.pending.map((request) => (
                            <PendingStoreRow
                              key={request.membershipId}
                              storeName={request.storeName}
                              waitingLabel="본사 승인 대기"
                              requestedAt={request.requestedAt}
                              onCancelStart={() => cancelRequest(request)}
                            />
                          ))}
                        </StoreMembershipList>
                      )}
                    </section>
                  </>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
