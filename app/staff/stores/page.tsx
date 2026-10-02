"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock3, Pencil, Plus, RefreshCw, Store as StoreIcon } from "lucide-react";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import SortableStoreList from "@/components/staff/SortableStoreList";
import { useStaffShell, type StaffPendingStore } from "@/components/staff/StaffShellContext";
import { StoreMembershipList, StoreStatusBadge, formatRequestDate } from "@/components/stores/StoreMembershipList";
import type { StaffStore } from "@/lib/staff/approved-stores";
import { applyStoreOrder } from "@/lib/staff/store-preferences";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";

// 근무 매장 = "소속 매장과 신청 상태 관리" 화면.
// - 기본 매장: 사용자가 지정한 대표 매장 (계정에 저장, 로그인 직후 활성 매장의 초깃값)
// - 활성 매장: 지금 AI 챗봇·지점 매뉴얼에 적용되는 매장 (StaffShell의 selectedStore)
// 승인 완료 매장·승인 대기 신청·기본/활성 매장은 모두 직원 공통 상태(StaffShell)에서 읽는다.

type PendingRequest = StaffPendingStore;

/** 편집 중인(아직 저장하지 않은) 기본 매장/순서. 매장 추가 화면에 다녀와도 유지되도록 탭 저장소에 남긴다. */
interface EditDraft {
  order: string[];
  defaultStoreId: string | null;
}

const EDIT_DRAFT_KEY = "staffStoreEditDraft";

function readEditDraft(): EditDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(EDIT_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EditDraft> | null;
    if (!parsed || !Array.isArray(parsed.order)) return null;
    return {
      order: parsed.order.filter((id): id is string => typeof id === "string"),
      defaultStoreId: typeof parsed.defaultStoreId === "string" ? parsed.defaultStoreId : null,
    };
  } catch {
    return null;
  }
}

function writeEditDraft(draft: EditDraft | null): void {
  try {
    if (draft) sessionStorage.setItem(EDIT_DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(EDIT_DRAFT_KEY);
  } catch {
    // 탭 저장소를 쓸 수 없으면 "매장 추가에 다녀와도 유지"만 생략한다.
  }
}

const sectionTitleClass = "mb-4 text-lg font-bold text-[var(--color-text-primary)]";
// 매장 행 공통 레이아웃: 왼쪽(아이콘 + 매장 정보)은 남는 폭을 쓰고, 오른쪽 문구는 카드 세로 중앙·같은 오른쪽 여백(px-5)에 맞춘다.
// 좁은 화면에서도 가로 배치를 유지하며 매장명만 줄바꿈된다(오른쪽 문구는 줄바꿈하지 않아 겹치지 않는다).
const storeRowClass = "flex items-center gap-3 px-5";
const storeRowMainClass = "flex min-w-0 flex-1 items-start gap-3";
const storeRowAsideClass = "flex shrink-0 items-center justify-end gap-2 whitespace-nowrap";
const textActionClass =
  "inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-medium text-[var(--color-text-secondary)] underline-offset-2 transition-colors hover:text-[var(--color-text-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60";
const primaryTextActionClass =
  "inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-semibold text-[var(--color-primary)] underline-offset-2 transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60";
const primaryButtonClass =
  "inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-4 text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60";

export default function StaffStoresPage() {
  const {
    stores,
    pendingStores,
    defaultStoreId,
    isStoresLoading,
    storesError,
    reloadStores,
    saveStorePreferences,
  } = useStaffShell();

  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  // 편집 모드 = draft가 있는 상태
  const [draft, setDraft] = useState<EditDraft | null>(readEditDraft);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PendingRequest | null>(null);
  const [isCanceling, setIsCanceling] = useState(false);

  const isReady = !isStoresLoading && !storesError;
  const hasAnyStore = stores.length > 0 || pendingStores.length > 0;
  const isEditing = draft !== null && isReady && hasAnyStore;
  const savedOrder = stores.map((store) => store.id);

  // 편집 중 값은 항상 "지금 승인된 매장" 범위로 정리해서 쓴다. (제외/승인 변동이 있어도 안전)
  const editStores = draft ? applyStoreOrder(stores, draft.order) : stores;
  const editOrder = editStores.map((store) => store.id);
  // 편집 모드: 1순위 매장이 기본 매장 (드래그로 자동 변경)
  const editDefaultId = editOrder[0] ?? null;
  // isDirty: 순서만 비교 (기본 매장은 1순위로 자동 결정)
  const isDirty = isEditing && editOrder.join(",") !== savedOrder.join(",");

  const defaultStore = stores.find((store) => store.id === defaultStoreId) ?? null;
  const otherStores = stores.filter((store) => store.id !== defaultStoreId);

  const updateDraft = (next: EditDraft | null) => {
    setDraft(next);
    writeEditDraft(next);
  };

  const startEditing = () => {
    setNotice(null);
    setSaveFailed(false);
    updateDraft({ order: savedOrder, defaultStoreId: savedOrder[0] ?? null });
  };

  const exitEditing = () => {
    setSaveFailed(false);
    setShowDiscardDialog(false);
    updateDraft(null);
  };

  // 저장하지 않은 변경이 있을 때 페이지를 벗어나면 안내한다. (매장 추가 화면은 편집 내용을 유지한 채 다녀올 수 있어 제외)
  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const handleLinkClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
      const href = anchor?.getAttribute("href") ?? "";
      if (!anchor || !href.startsWith("/") || href.startsWith("/staff/stores")) return;
      if (!window.confirm("저장하지 않은 변경 사항이 있습니다. 이 화면을 벗어날까요?\n(돌아오면 편집 중이던 내용을 이어서 저장할 수 있습니다.)")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleLinkClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleLinkClick, true);
    };
  }, [isDirty]);

  // 일반 화면: 기본 매장으로 설정 (계정에 바로 저장, 활성 매장도 함께 전환)
  const setAsDefault = async (store: StaffStore) => {
    if (isSettingDefault) return;
    setIsSettingDefault(true);
    setNotice(null);
    const ok = await saveStorePreferences({ defaultStoreId: store.id, order: savedOrder });
    setIsSettingDefault(false);
    setNotice(
      ok
        ? {
            type: "success",
            message: `${formatStoreDisplayName(store.name)}을(를) 기본 매장으로 설정했습니다. AI 챗봇과 지점 매뉴얼이 이 매장 기준으로 표시됩니다.`,
          }
        : { type: "error", message: "기본 매장을 변경하지 못했습니다. 잠시 후 다시 시도해 주세요." },
    );
  };

  // 편집 완료: 순서 + 기본 매장을 한 번에 저장
  const finishEditing = async () => {
    if (isSaving) return;
    if (!isDirty) {
      exitEditing();
      return;
    }
    setIsSaving(true);
    setNotice(null);
    const ok = await saveStorePreferences({ defaultStoreId: editDefaultId, order: editOrder });
    setIsSaving(false);
    if (ok) {
      exitEditing();
      setNotice({ type: "success", message: "근무 매장 설정을 저장했습니다." });
    } else {
      // 편집 내용은 그대로 둔다 → 다시 시도하거나 되돌릴 수 있다.
      setSaveFailed(true);
      setNotice({ type: "error", message: "변경 사항을 저장하지 못했습니다. 다시 시도하거나 변경 사항을 되돌려 주세요." });
    }
  };

  const revertDraft = () => {
    setSaveFailed(false);
    setNotice(null);
    updateDraft({ order: savedOrder, defaultStoreId: savedOrder[0] ?? null });
  };

  const cancelRequest = async () => {
    if (!cancelTarget || isCanceling) return;
    setIsCanceling(true);
    try {
      // 이 신청(pending membership) 하나만 취소한다. 다른 신청·승인 완료 매장에는 영향이 없다.
      const response = await fetch(`/api/staff/memberships/${encodeURIComponent(cancelTarget.membershipId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const result = (await response.json()) as { success?: boolean; code?: string };
      if (response.ok && result.success) {
        setNotice({ type: "success", message: `${formatStoreDisplayName(cancelTarget.storeName)} 근무 신청을 취소했습니다.` });
      } else if (result.code === "NOT_FOUND" || result.code === "NOT_PENDING") {
        setNotice({ type: "error", message: "이미 처리된 신청이라 취소할 수 없습니다. 목록을 새로 불러왔습니다." });
      } else {
        setNotice({ type: "error", message: "신청을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요." });
      }
    } catch {
      setNotice({ type: "error", message: "신청을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    } finally {
      setIsCanceling(false);
      setCancelTarget(null);
      reloadStores();
    }
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-3">
              근무 매장{isEditing && <span className="ml-2 text-base font-semibold text-[var(--color-primary)]">편집 중</span>}
            </h1>
            <p className="text-base text-[var(--color-text-secondary)]">
              {isEditing
                ? "드래그하여 매장 순서를 변경하세요. 첫 번째 매장이 기본 매장으로 설정됩니다."
                : "근무 중인 매장과 새로운 근무 신청을 관리할 수 있습니다."}
            </p>
          </div>
          {isReady && (
            <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
              {isEditing ? (
                <></>
              ) : (
                <>
                  {hasAnyStore && (
                    <button type="button" onClick={startEditing} className={secondaryButtonClass}>
                      <Pencil size={16} aria-hidden="true" /> 편집
                    </button>
                  )}
                  <Link href="/staff/stores/add" className={primaryButtonClass}>
                    <Plus size={18} aria-hidden="true" /> 매장 추가
                  </Link>
                </>
              )}
            </div>
          )}
        </div>

        {notice && (
          <div
            role={notice.type === "error" ? "alert" : "status"}
            className={`mb-6 flex flex-wrap items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
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
            <span className="min-w-0 flex-1">{notice.message}</span>
            {saveFailed && isEditing && (
              <span className="flex w-full flex-wrap gap-3 pl-6 sm:w-auto sm:pl-0">
                <button type="button" onClick={() => void finishEditing()} disabled={isSaving} className="font-semibold underline underline-offset-2">
                  다시 시도
                </button>
                <button type="button" onClick={revertDraft} disabled={isSaving} className="font-semibold underline underline-offset-2">
                  변경 사항 되돌리기
                </button>
              </span>
            )}
          </div>
        )}

        {isStoresLoading ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
            <p className="text-base text-[var(--color-text-secondary)]" role="status">근무 매장을 불러오는 중...</p>
          </div>
        ) : storesError ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
            <AlertCircle size={20} className="shrink-0 text-red-700" aria-hidden="true" />
            <p className="flex-1 text-sm text-red-700">근무 매장 정보를 불러오지 못했습니다.</p>
            <button
              type="button"
              onClick={reloadStores}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <RefreshCw size={16} aria-hidden="true" /> 다시 시도
            </button>
          </div>
        ) : !hasAnyStore ? (
          // 매장 미소속 상태 (마지막 근무 매장을 제외했거나 아직 신청 전)
          <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
            <StoreIcon size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <p className="text-base font-semibold text-[var(--color-text-primary)]">근무 중인 매장이 없습니다.</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              근무할 매장을 추가하고 점주의 승인을 받아보세요. 승인 전에는 AI 챗봇과 매뉴얼을 이용할 수 없습니다.
            </p>
            <Link href="/staff/stores/add" className={`mt-5 ${primaryButtonClass}`}>
              <Plus size={18} aria-hidden="true" /> 매장 추가
            </Link>
          </div>
        ) : isEditing ? (
          // ── 편집 모드 ─────────────────────────────────
          <div className="space-y-8">
            <section aria-labelledby="edit-approved-heading">
              <h2 id="edit-approved-heading" className={sectionTitleClass}>
                매장 순서
              </h2>
              {editStores.length === 0 ? (
                <p className="rounded-xl border border-[var(--color-border)] bg-white px-5 py-4 text-sm text-[var(--color-text-secondary)]">
                  승인 완료된 근무 매장이 없습니다.
                </p>
              ) : (
                <>
                  <SortableStoreList
                    items={editStores}
                    label="매장 순서 (순서 변경 가능)"
                    getItemLabel={(store) => formatStoreDisplayName(store.name)}
                    disabled={isSaving || editStores.length === 1}
                    onReorder={(order) => updateDraft({ order, defaultStoreId: order[0] ?? null })}
                    renderItem={(store) => {
                      const name = formatStoreDisplayName(store.name);
                      const isDefault = store.id === editOrder[0];
                      return (
                        <div className="flex items-center h-full w-full gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-base font-semibold text-[var(--color-text-primary)] break-keep">{name}</p>
                          </div>
                          {isDefault && (
                            <div className="flex shrink-0">
                              <StoreStatusBadge tone="current">기본 매장</StoreStatusBadge>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  {editStores.length === 1 && (
                    <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
                      현재 순서를 변경할 다른 근무 매장이 없습니다.
                    </p>
                  )}
                </>
              )}
            </section>



            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-5">
              <button type="button" onClick={() => (isDirty ? setShowDiscardDialog(true) : exitEditing())} disabled={isSaving} className={secondaryButtonClass}>
                취소
              </button>
              <button type="button" onClick={() => void finishEditing()} disabled={isSaving || !isDirty} className={`${primaryButtonClass} sm:min-w-[140px]`}>
                {isSaving ? "저장 중..." : "변경 저장"}
              </button>
            </div>
          </div>
        ) : (
          // ── 일반 화면 ─────────────────────────────────
          <div className="space-y-8">
            <section aria-labelledby="default-store-heading">
              <h2 id="default-store-heading" className={sectionTitleClass}>
                기본 매장
              </h2>
              {defaultStore ? (
                <div className={`${storeRowClass} rounded-xl border border-[var(--color-primary)]/40 bg-[var(--color-primary-light)]/15 py-5`}>
                  <div className={storeRowMainClass}>
                    <StoreIcon size={22} className="mt-0.5 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-lg font-bold text-[var(--color-text-primary)] break-keep">
                        {formatStoreDisplayName(defaultStore.name)}
                      </p>
                      <p className="mt-3 text-sm text-[var(--color-text-secondary)] break-keep">
                        AI 챗봇, 지점 매뉴얼, 공지사항의 기본 기준 매장입니다.
                      </p>
                    </div>
                  </div>
                  <div className={storeRowAsideClass}>
                    <p className="text-base font-bold text-[var(--color-primary)]">기본 매장</p>
                  </div>
                </div>
              ) : (
                <p className="rounded-xl border border-[var(--color-border)] bg-white px-5 py-4 text-sm text-[var(--color-text-secondary)]">
                  승인 완료된 근무 매장이 없습니다. 점주가 신청을 승인하면 기본 매장으로 지정할 수 있습니다.
                </p>
              )}
            </section>

            {otherStores.length > 0 && (
              <section aria-labelledby="other-stores-heading">
                <h2 id="other-stores-heading" className={sectionTitleClass}>
                  다른 근무 매장
                </h2>
                <StoreMembershipList label="다른 근무 매장">
                  {otherStores.map((store) => {
                    return (
                      <li key={store.id} className={`${storeRowClass} py-4`}>
                        <div className={storeRowMainClass}>
                          <StoreIcon size={20} className="mt-0.5 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
                          <div className="min-w-0">
                            <p className="text-base font-semibold text-[var(--color-text-primary)] break-keep">
                              {formatStoreDisplayName(store.name)}
                            </p>
                          </div>
                        </div>
                        {/* 기본 매장으로 설정 = 기본 매장 저장 + 활성 매장 전환 (AI 챗봇·지점 매뉴얼·상단 프로필이 함께 바뀐다) */}
                        {/* 버튼의 좌우 패딩(px-2)만큼 당겨서 글자 오른쪽 끝을 다른 카드 문구와 같은 선에 맞춘다. */}
                        <div className={`${storeRowAsideClass} -mr-2`}>
                          <button type="button" onClick={() => void setAsDefault(store)} disabled={isSettingDefault} className={primaryTextActionClass}>
                            기본 설정
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </StoreMembershipList>
              </section>
            )}

            {pendingStores.length > 0 && (
              <section aria-labelledby="pending-heading">
                <h2 id="pending-heading" className={sectionTitleClass}>
                  근무 신청
                </h2>
                <StoreMembershipList label="근무 신청">
                  {/* Pending 신청을 먼저 표시 */}
                  {pendingStores
                    .filter((request) => request.status === "pending")
                    .map((request) => (
                      <PendingRow key={request.membershipId} request={request} asideClassName="-mr-2 flex-wrap">
                        <span className="text-sm font-semibold text-amber-800">승인 대기</span>
                        <button type="button" onClick={() => setCancelTarget(request)} disabled={isSaving} className={textActionClass}>
                          신청 취소
                        </button>
                      </PendingRow>
                    ))}
                  {/* Rejected 신청을 그 다음 표시 */}
                  {pendingStores
                    .filter((request) => request.status === "rejected")
                    .map((request) => (
                      <PendingRow key={request.membershipId} request={request} asideClassName="-mr-2">
                        <span className="text-sm font-semibold text-red-700">승인 거절</span>
                      </PendingRow>
                    ))}
                </StoreMembershipList>
                <p className="mt-2 text-sm text-[var(--color-text-tertiary)]">
                  승인 전에는 해당 매장으로 전환할 수 없습니다.
                </p>
              </section>
            )}
          </div>
        )}

        {/* 승인 신청 취소 확인 */}
        <ConfirmDialog
          isOpen={cancelTarget !== null}
          title={`${cancelTarget ? formatStoreDisplayName(cancelTarget.storeName) : ""} 근무 신청을 취소할까요?`}
          description={<p>이 매장의 승인 신청만 취소됩니다. 취소한 뒤에도 매장 추가에서 다시 신청할 수 있습니다.</p>}
          cancelText="닫기"
          confirmText="신청 취소"
          isDangerous
          isLoading={isCanceling}
          onCancel={() => setCancelTarget(null)}
          onConfirm={() => void cancelRequest()}
        />

        {/* 저장하지 않고 편집 종료 확인 */}
        <ConfirmDialog
          isOpen={showDiscardDialog}
          title="편집을 취소할까요?"
          description={<p>저장하지 않은 순서·기본 매장 변경 사항이 사라집니다.</p>}
          cancelText="계속 편집"
          confirmText="변경 사항 버리기"
          isDangerous
          onCancel={() => setShowDiscardDialog(false)}
          onConfirm={exitEditing}
        />
      </div>
    </div>
  );
}

/** 승인 대기/거절 행: 매장명 + 신청일, 오른쪽에 상태 또는 액션 */
function PendingRow({
  request,
  children,
  asideClassName = "",
}: {
  request: PendingRequest;
  children: React.ReactNode;
  /** 오른쪽 끝 요소가 패딩 있는 버튼일 때 글자 끝을 맞추기 위한 보정 (예: "-mr-2") */
  asideClassName?: string;
}) {
  const requestedDate = formatRequestDate(request.requestedAt);
  const isPending = request.status === "pending";
  
  return (
    <li className={`${storeRowClass} py-4`}>
      <div className={storeRowMainClass}>
        {isPending ? (
          <Clock3 size={20} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
        ) : (
          <AlertCircle size={20} className="mt-0.5 shrink-0 text-red-700" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="text-base font-semibold text-[var(--color-text-primary)] break-keep">{formatStoreDisplayName(request.storeName)}</p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{requestedDate ? `${requestedDate} 신청` : "신청 접수"}</p>
        </div>
      </div>
      <div className={`${storeRowAsideClass} ${asideClassName}`}>{children}</div>
    </li>
  );
}
