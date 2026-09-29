"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Plus, RefreshCw, Store as StoreIcon } from "lucide-react";

import {
  ApprovedStoreRow,
  PendingStoreRow,
  StoreMembershipList,
} from "@/components/stores/StoreMembershipList";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";

import { useStaffShell, type StaffPendingStore } from "@/components/staff/StaffShellContext";

type PendingRequest = StaffPendingStore;

export default function StaffStoresPage() {
  // 승인된 매장(/api/staff/stores)·승인 대기 신청·기본 매장은 직원 공통 상태를 그대로 쓴다.
  const { stores, pendingStores, selectedStore, isStoresLoading, storesError, reloadStores, selectStore } = useStaffShell();
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // 근무 매장 해제 dialog
  const [removeDialog, setRemoveDialog] = useState<{
    isOpen: boolean;
    storeId: string | null;
    storeName: string;
    isCurrent: boolean;
  }>({ isOpen: false, storeId: null, storeName: "", isCurrent: false });
  const [isRemoving, setIsRemoving] = useState(false);

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

  const openRemoveDialog = (storeId: string, storeName: string) => {
    const store = stores.find((s) => s.id === storeId);
    const isCurrent = storeId === currentStoreId;

    // 기본 매장인 경우, 다른 매장이 있으면 경고
    if (isCurrent && stores.length > 1) {
      setNotice({
        type: "error",
        message: "다른 매장을 기본 매장으로 지정한 후 근무를 종료해 주세요.",
      });
      return;
    }

    setRemoveDialog({ isOpen: true, storeId, storeName, isCurrent });
  };

  const closeRemoveDialog = () => {
    setRemoveDialog({ isOpen: false, storeId: null, storeName: "", isCurrent: false });
  };

  const removeStore = async () => {
    if (!removeDialog.storeId) return;
    if (isRemoving) return;

    setIsRemoving(true);
    setNotice(null);

    try {
      const store = stores.find((s) => s.id === removeDialog.storeId);
      if (!store) {
        setNotice({ type: "error", message: "매장 정보를 찾을 수 없습니다." });
        setIsRemoving(false);
        return;
      }

      // membership ID 사용
      const membershipId = store.membershipId ?? store.id;

      const response = await fetch(`/api/staff/memberships/${encodeURIComponent(membershipId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const result = (await response.json()) as { success?: boolean; code?: string };

      if (response.ok && result.success) {
        setNotice({ type: "success", message: `${formatStoreDisplayName(removeDialog.storeName)}의 근무를 종료했습니다.` });
        closeRemoveDialog();

        // 현재 선택된 매장이 방금 제거된 매장인 경우 처리
        if (currentStoreId === removeDialog.storeId) {
          // 남은 승인 매장 중 첫 번째를 새로운 기본 매장으로 선택
          const remainingStores = stores.filter((s) => s.id !== removeDialog.storeId);
          if (remainingStores.length > 0) {
            selectStore(remainingStores[0].id);
          }
        }

        // 목록 새로고침
        reload();
      } else if (result.code === "NOT_FOUND") {
        setNotice({ type: "error", message: "이 근무 매장을 찾을 수 없습니다." });
      } else if (result.code === "INVALID_STATUS") {
        setNotice({ type: "error", message: "이 근무 매장을 더 이상 종료할 수 없습니다." });
      } else {
        setNotice({ type: "error", message: "근무를 종료하지 못했습니다. 잠시 후 다시 시도해 주세요." });
      }
    } catch (error) {
      console.error("Remove store error:", error);
      setNotice({ type: "error", message: "근무를 종료하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">근무 매장</h1>
                <p className="text-base text-[var(--color-text-secondary)]">
                  승인된 근무 매장을 관리하고 서비스에서 우선 사용할 기본 매장을 설정할 수 있습니다.
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
                    근무 매장 {state.approved.length}곳
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">
                    승인 대기 {state.pending.length}건
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
                        승인된 근무 매장
                      </h2>
                      {state.approved.length === 0 ? (
                        <p className="rounded-xl border border-[var(--color-border)] bg-white px-5 py-4 text-sm text-[var(--color-text-secondary)]">
                          승인된 근무 매장이 없습니다.
                        </p>
                      ) : (
                        <StoreMembershipList label="승인된 근무 매장">
                          {state.approved.map((store) => (
                            <ApprovedStoreRow
                              key={store.id}
                              storeId={store.id}
                              storeName={store.name}
                              isCurrent={store.id === currentStoreId}
                              onSetAsDefault={() => selectStore(store.id)}
                              onRemoveStart={() => openRemoveDialog(store.id, store.name)}
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

            {/* 근무 매장 근무 종료 확인 dialog */}
            <ConfirmDialog
              isOpen={removeDialog.isOpen}
              title="근무를 종료하시겠어요?"
              description={
                <>
                  <p>
                    "<strong>{formatStoreDisplayName(removeDialog.storeName)}</strong>"의 근무 연결이 해제됩니다.
                  </p>
                  <p className="mt-2 text-[var(--color-text-tertiary)]">
                    종료 후에는 해당 매장의 지점 매뉴얼과 매장 기준 기능을 이용할 수 없습니다.
                  </p>
                </>
              }
              cancelText="취소"
              confirmText="근무 종료"
              isDangerous
              isLoading={isRemoving}
              onCancel={closeRemoveDialog}
              onConfirm={removeStore}
            />
          </div>
    </div>
  );
}
