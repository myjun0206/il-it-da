"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, CheckCircle2, ClipboardList, Plus, RefreshCw } from "lucide-react";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { RequestStatusBadge, isRequestStatus, type RequestStatus } from "@/components/common/ResultPanel";
import { useStaffShell } from "@/components/staff/StaffShellContext";
import { StoreMembershipList, formatRequestDate } from "@/components/stores/StoreMembershipList";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";

// 직원 근무 신청 현황: 본인이 신청한 매장별 승인 상태(승인 대기 / 승인 완료 / 신청 반려)를 한 곳에서 확인한다.
// 데이터는 본인 membership 목록(/api/signup/store-membership, 서버가 로그인 사용자 기준으로 조회)이고,
// 신청 취소·기본 매장 설정은 근무 매장 관리와 같은 API/공통 상태를 쓴다.

interface StaffRequest {
  membershipId: string;
  storeId: string;
  storeName: string;
  status: RequestStatus;
  requestedAt?: string;
}

type LoadResult =
  | { key: number; status: "ready"; requests: StaffRequest[] }
  | { key: number; status: "error" };

const STATUS_ORDER: Record<RequestStatus, number> = { pending: 0, approved: 1, rejected: 2 };

const textActionClass =
  "inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-medium text-[var(--color-text-secondary)] underline-offset-2 transition-colors hover:text-[var(--color-text-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60";
const primaryTextActionClass =
  "inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-semibold text-[var(--color-primary)] underline-offset-2 transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60";

export default function StaffStoreRequestsPage() {
  const router = useRouter();
  const { stores, defaultStoreId, reloadStores, saveStorePreferences } = useStaffShell();
  const [result, setResult] = useState<LoadResult | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<StaffRequest | null>(null);
  const [isCanceling, setIsCanceling] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/signup/store-membership", { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          router.push("/");
          return;
        }
        const payload = (await response.json()) as {
          success?: boolean;
          data?: Array<Omit<StaffRequest, "status"> & { role: string; status: string }>;
        };
        if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
          setResult({ key: reloadToken, status: "error" });
          return;
        }
        const requests = payload.data
          .filter((membership) => membership.role === "staff" && isRequestStatus(membership.status))
          .map(({ membershipId, storeId, storeName, status, requestedAt }) => ({
            membershipId,
            storeId,
            storeName,
            status: status as RequestStatus,
            requestedAt,
          }))
          .sort(
            (a, b) =>
              STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
              new Date(b.requestedAt ?? 0).getTime() - new Date(a.requestedAt ?? 0).getTime(),
          );
        setResult({ key: reloadToken, status: "ready", requests });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key: reloadToken, status: "error" });
      });

    return () => controller.abort();
  }, [reloadToken, router]);

  const currentResult = result && result.key === reloadToken ? result : null;
  const requests = currentResult?.status === "ready" ? currentResult.requests : [];
  const countOf = (status: RequestStatus) => requests.filter((request) => request.status === status).length;
  const reload = () => setReloadToken((value) => value + 1);

  const cancelRequest = async () => {
    if (!cancelTarget || isCanceling) return;
    setIsCanceling(true);
    try {
      // 이 신청(pending membership) 하나만 취소한다. 다른 신청·승인 완료 매장에는 영향이 없다.
      const response = await fetch(`/api/staff/memberships/${encodeURIComponent(cancelTarget.membershipId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = (await response.json()) as { success?: boolean };
      setNotice(
        response.ok && payload.success
          ? { type: "success", message: `${formatStoreDisplayName(cancelTarget.storeName)} 근무 신청을 취소했습니다.` }
          : { type: "error", message: "신청을 취소하지 못했습니다. 이미 처리된 신청일 수 있어 목록을 새로 불러왔습니다." },
      );
    } catch {
      setNotice({ type: "error", message: "신청을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    } finally {
      setIsCanceling(false);
      setCancelTarget(null);
      reload();
      reloadStores();
    }
  };

  // 승인 완료 매장 → 기본 매장으로 설정 (근무 매장 관리와 같은 저장 함수: 기본 매장 저장 + 활성 매장 전환)
  const setAsDefault = async (request: StaffRequest) => {
    if (isSettingDefault) return;
    setIsSettingDefault(true);
    setNotice(null);
    const ok = await saveStorePreferences({ defaultStoreId: request.storeId, order: stores.map((store) => store.id) });
    setIsSettingDefault(false);
    // 이 화면을 연 뒤에 승인된 매장이면 공통 상태에 아직 없으므로 근무 매장 목록을 다시 불러와 반영한다.
    if (ok && !stores.some((store) => store.id === request.storeId)) reloadStores();
    setNotice(
      ok
        ? {
            type: "success",
            message: `${formatStoreDisplayName(request.storeName)}을(를) 기본 매장으로 설정했습니다. AI 챗봇과 지점 매뉴얼이 이 매장 기준으로 표시됩니다.`,
          }
        : { type: "error", message: "기본 매장을 변경하지 못했습니다. 잠시 후 다시 시도해 주세요." },
    );
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <Link
          href="/staff/stores"
          className="-ml-2 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          근무 매장
        </Link>

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">신청 현황</h1>
            <p className="text-base text-[var(--color-text-secondary)]">신청한 매장별 승인 상태를 확인할 수 있습니다.</p>
            {currentResult?.status === "ready" && requests.length > 0 && (
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]" aria-label="신청 현황 요약">
                승인 대기 <span className="font-bold text-[var(--color-text-primary)]">{countOf("pending")}</span>
                <span className="mx-2 text-[var(--color-text-tertiary)]" aria-hidden="true">·</span>
                승인 완료 <span className="font-bold text-[var(--color-text-primary)]">{countOf("approved")}</span>
                <span className="mx-2 text-[var(--color-text-tertiary)]" aria-hidden="true">·</span>
                신청 반려 <span className="font-bold text-[var(--color-text-primary)]">{countOf("rejected")}</span>
              </p>
            )}
          </div>
          <Link
            href="/staff/stores/add"
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 self-start rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 sm:self-auto"
          >
            <Plus size={18} aria-hidden="true" /> 매장 추가
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

        {!currentResult ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
            <p className="text-base text-[var(--color-text-secondary)]" role="status">신청 현황을 불러오는 중...</p>
          </div>
        ) : currentResult.status === "error" ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
            <AlertCircle size={20} className="shrink-0 text-red-700" aria-hidden="true" />
            <p className="flex-1 text-sm text-red-700">신청 현황을 불러오지 못했습니다.</p>
            <button
              type="button"
              onClick={reload}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <RefreshCw size={16} aria-hidden="true" /> 다시 시도
            </button>
          </div>
        ) : requests.length === 0 ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
            <ClipboardList size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <p className="text-base font-semibold text-[var(--color-text-primary)]">신청한 매장이 없습니다.</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">근무할 매장을 추가하고 점주의 승인을 받아보세요.</p>
          </div>
        ) : (
          <StoreMembershipList label="매장별 신청 현황">
            {requests.map((request) => {
              const requestedDate = formatRequestDate(request.requestedAt);
              const isDefault = request.status === "approved" && request.storeId === defaultStoreId;
              return (
                <li key={request.membershipId} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-[var(--color-text-primary)] break-keep">
                      {formatStoreDisplayName(request.storeName)}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                      {requestedDate ? `${requestedDate} 신청` : "신청 접수"}
                      {request.status === "rejected" && " · 다시 신청하려면 해당 매장 점주에게 문의해 주세요."}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-x-2">
                    <RequestStatusBadge status={request.status} />
                    {request.status === "pending" && (
                      <button type="button" onClick={() => setCancelTarget(request)} className={textActionClass}>
                        신청 취소
                      </button>
                    )}
                    {request.status === "approved" &&
                      (isDefault ? (
                        <span className="px-2 text-sm font-bold text-[var(--color-primary)]">기본 매장</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void setAsDefault(request)}
                          disabled={isSettingDefault}
                          className={primaryTextActionClass}
                        >
                          기본 매장으로 설정
                        </button>
                      ))}
                  </div>
                </li>
              );
            })}
          </StoreMembershipList>
        )}

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
      </div>
    </div>
  );
}
