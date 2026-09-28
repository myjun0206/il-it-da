"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Plus, RefreshCw, Store as StoreIcon } from "lucide-react";

import {
  ApprovedStoreRow,
  PendingStoreRow,
  StoreMembershipList,
} from "@/components/stores/StoreMembershipList";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";

import { useStaffShell, type StaffPendingStore } from "@/components/staff/StaffShellContext";

type PendingRequest = StaffPendingStore;

export default function StaffStoresPage() {
  // 승인된 매장(/api/staff/stores)·승인 대기 신청·현재 근무 매장은 직원 공통 상태를 그대로 쓴다.
  const { stores, pendingStores, selectedStore, isStoresLoading, storesError, reloadStores } = useStaffShell();
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const currentStoreId = selectedStore?.id ?? null;
  const state = isStoresLoading
    ? ({ status: "loading" } as const)
    : storesError
      ? ({ status: "error" } as const)
      : ({ status: "ready", approved: stores, pending: pendingStores } as const);
  const reload = reloadStores;

  const cancelRequest = async (request: PendingRequest) => {
    if (cancelingId) return;
    if (!window.confirm(`${formatStoreDisplayName(request.storeName)} 근무 신청을 취소할까요?`)) return;

    setCancelingId(request.membershipId);
    setNotice(null);
    try {
      const response = await fetch(`/api/staff/memberships/${encodeURIComponent(request.membershipId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const result = (await response.json()) as { success?: boolean; code?: string };
      if (response.ok && result.success) {
        setNotice({ type: "success", message: "근무 신청을 취소했습니다." });
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

  return (
    <div className="p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">근무 매장</h1>
                <p className="text-base text-[var(--color-text-secondary)]">
                  근무 중인 매장과 승인 대기 중인 신청을 관리할 수 있습니다.
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
                  현재 근무 매장 변경은 AI 챗봇 상단의 근무 매장 선택에서 할 수 있습니다.
                </p>
              </div>
              <Link
                href="/staff/stores/add"
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 self-start rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 sm:self-auto"
              >
                <Plus size={18} aria-hidden="true" /> 근무 매장 추가
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
                <p className="text-base text-[var(--color-text-secondary)]" role="status">근무 매장을 불러오는 중...</p>
              </div>
            ) : state.status === "error" ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
                <AlertCircle size={20} className="shrink-0 text-red-700" aria-hidden="true" />
                <p className="flex-1 text-sm text-red-700">근무 매장 정보를 불러오지 못했습니다.</p>
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
                <div className="flex flex-wrap gap-2" aria-label="근무 매장 요약">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary-light)]/40 px-3 py-1 text-sm font-semibold text-[var(--color-primary)]">
                    근무 중 {state.approved.length}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">
                    승인 대기 {state.pending.length}
                  </span>
                </div>

                {state.approved.length === 0 && state.pending.length === 0 ? (
                  <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
                    <StoreIcon size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                    <p className="text-base font-semibold text-[var(--color-text-primary)]">아직 근무 매장이 없습니다.</p>
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">근무할 매장을 추가 신청하면 점주 승인 후 근무 매장으로 선택할 수 있습니다.</p>
                    <Link
                      href="/staff/stores/add"
                      className="mt-5 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
                    >
                      <Plus size={18} aria-hidden="true" /> 근무 매장 추가
                    </Link>
                  </div>
                ) : (
                  <>
                    <section aria-labelledby="approved-heading">
                      <h2 id="approved-heading" className="mb-3 text-lg font-bold text-[var(--color-text-primary)]">
                        근무 중
                      </h2>
                      {state.approved.length === 0 ? (
                        <p className="rounded-xl border border-[var(--color-border)] bg-white px-5 py-4 text-sm text-[var(--color-text-secondary)]">
                          현재 근무 중인 매장이 없습니다.
                        </p>
                      ) : (
                        <StoreMembershipList label="근무 중 매장">
                          {state.approved.map((store) => (
                            <ApprovedStoreRow
                              key={store.id}
                              storeName={store.name}
                              approvedLabel="승인 완료"
                              isCurrent={store.id === currentStoreId}
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
                              waitingLabel="점주 승인 대기"
                              requestedAt={request.requestedAt}
                              isCanceling={cancelingId === request.membershipId}
                              cancelDisabled={cancelingId !== null}
                              onCancel={() => cancelRequest(request)}
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
    </div>
  );
}
