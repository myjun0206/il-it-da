"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Check, CircleCheck, Repeat2, RotateCcw } from "lucide-react";

import OwnerHeader from "@/components/owner/OwnerHeader";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import QuestionManualFollowup from "@/components/owner/QuestionManualFollowup";
import {
  type OwnerStore,
  persistSelectedStore,
  resolveOwnerCurrentStore,
} from "@/lib/owner/current-store";
import {
  buildBossQuestionsUrl,
  classifyPendingQuestionsResponse,
  pickQuestionsStore,
} from "@/lib/owner/boss-questions-view";
import type { PendingQuestion, QuestionResolutionStatus } from "@/lib/owner/pending-questions";
import { createClient } from "@/lib/supabase/client";

type DetailState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error" }
  | { kind: "not-found" }
  | {
      kind: "ready";
      store: OwnerStore;
      userName: string;
      question: PendingQuestion;
      resolutionFeatureAvailable: boolean;
    };

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function resolutionLabel(status: QuestionResolutionStatus): string {
  if (status === "in_progress") return "확인 중";
  if (status === "resolved") return "처리 완료";
  return "미처리";
}

export default function BossQuestionDetailView({
  questionId,
  requestedStoreId,
}: {
  questionId: string;
  requestedStoreId: string | null;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<DetailState>({ kind: "loading" });
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [{ data: sessionData }, stores] = await Promise.all([
          createClient().auth.getSession(),
          resolveOwnerCurrentStore(),
        ]);
        if (cancelled) return;

        if (stores.status === "error") {
          setDetail({ kind: "error" });
          return;
        }

        const choice = pickQuestionsStore(stores.stores, stores.current, requestedStoreId);
        if (!choice.store || choice.requestedStoreRejected) {
          setDetail({ kind: "forbidden" });
          return;
        }

        if (choice.store.storeId !== stores.current?.storeId) {
          persistSelectedStore(choice.store);
        }

        const params = new URLSearchParams({
          storeId: choice.store.storeId,
          limit: "20",
          resolutionStatus: "all",
          questionId,
        });
        const response = await fetch(`/api/boss/question-logs?${params.toString()}`, {
          credentials: "include",
        });
        const body: unknown = await response.json().catch(() => null);
        const result = classifyPendingQuestionsResponse(choice.store.storeId, response.status, body);

        if (cancelled) return;
        if (result.kind === "forbidden") {
          setDetail({ kind: "forbidden" });
          return;
        }
        if (result.kind !== "ready") {
          setDetail({ kind: "error" });
          return;
        }

        const question = result.questions.find((row) => row.id === questionId);
        if (!question) {
          setDetail({ kind: "not-found" });
          return;
        }

        setDetail({
          kind: "ready",
          store: choice.store,
          userName: sessionData.session?.user.user_metadata?.name || "점주",
          question,
          resolutionFeatureAvailable: result.resolutionFeatureAvailable,
        });
      } catch {
        if (!cancelled) setDetail({ kind: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [questionId, requestedStoreId]);

  const handleStatusChange = async (nextStatus: QuestionResolutionStatus) => {
    if (detail.kind !== "ready" || updating || !detail.resolutionFeatureAvailable) return;
    if (nextStatus === "resolved" && !window.confirm("답변과 근거 또는 직원 안내·개별 대응 결과를 확인했나요? 매뉴얼 저장만으로 질문이 해결된 것은 아닙니다.")) return;
    setUpdating(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/boss/question-logs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          questionLogId: detail.question.id,
          nextStatus,
          currentStatus: detail.question.resolutionStatus,
          currentRevision: detail.question.resolutionRevision,
        }),
      });
      const body = await response.json().catch(() => null) as {
        success?: boolean;
        error?: string;
        code?: string;
        data?: {
          resolutionStatus?: QuestionResolutionStatus;
          resolutionRevision?: number;
          resolutionUpdatedAt?: string | null;
          resolutionUpdatedBy?: string | null;
          resolvedAt?: string | null;
          resolvedBy?: string | null;
        };
      } | null;

      if (!response.ok || !body?.success || !body.data) {
        setError(body?.error || "처리 상태를 변경하지 못했습니다. 다시 시도해 주세요.");
        return;
      }

      setDetail((current) => current.kind !== "ready" ? current : {
        ...current,
        question: {
          ...current.question,
          resolutionStatus: body.data?.resolutionStatus ?? nextStatus,
          resolutionRevision: body.data?.resolutionRevision ?? current.question.resolutionRevision,
          resolutionUpdatedAt: body.data?.resolutionUpdatedAt ?? null,
          resolutionUpdatedBy: body.data?.resolutionUpdatedBy ?? null,
          resolvedAt: body.data?.resolvedAt ?? null,
          resolvedBy: body.data?.resolvedBy ?? null,
        },
      });
      setNotice(nextStatus === "resolved" ? "처리를 완료했습니다." : "확인 중으로 변경했습니다.");
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setUpdating(false);
    }
  };

  const handleLogout = async () => {
    try {
      await createClient().auth.signOut();
    } catch {
      setError("로그아웃하지 못했습니다.");
    }
    router.push("/");
  };

  const storeName = detail.kind === "ready" ? detail.store.storeName : "";
  const userName = detail.kind === "ready" ? detail.userName : "점주";

  return (
    <div className="h-dvh overflow-hidden bg-(--color-bg-default) flex">
      <OwnerSidebar activeMenu="questions" onLogout={handleLogout} />
      <div className="min-h-0 min-w-0 flex-1 ml-0 lg:ml-[240px] flex flex-col">
        {detail.kind === "loading" ? (
          <div className="sticky top-0 z-50 bg-white border-b border-(--color-border) h-16 shrink-0" />
        ) : (
          <OwnerHeader userName={userName} storeName={storeName} onLogout={handleLogout} />
        )}

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-5 sm:px-8 lg:px-12 xl:px-16 py-8 lg:py-12 max-w-5xl">
            <button
              type="button"
              onClick={() => router.push(detail.kind === "ready" ? buildBossQuestionsUrl(detail.store.storeId) : "/boss/questions")}
              className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-(--color-text-secondary) hover:text-(--color-text-primary) focus-visible:outline-2 focus-visible:outline-(--color-primary)"
            >
              <ArrowLeft size={16} aria-hidden="true" /> 보류 질문으로 돌아가기
            </button>

            {detail.kind === "loading" && <p role="status" className="text-sm text-(--color-text-secondary)">질문을 불러오는 중...</p>}
            {detail.kind === "forbidden" && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">이 매장의 질문을 볼 권한이 없습니다.</p>}
            {detail.kind === "error" && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">질문 정보를 불러오지 못했습니다. 다시 시도해 주세요.</p>}
            {detail.kind === "not-found" && <p role="status" className="rounded-md border border-(--color-border) bg-white p-4 text-sm text-(--color-text-secondary)">질문을 찾을 수 없습니다.</p>}

            {detail.kind === "ready" && (
              <article className="space-y-6">
                <header className="border-b border-(--color-border) pb-6">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-(--color-text-secondary)">
                    <span className="wrap-break-word font-semibold">{detail.store.storeName}</span>
                    <time dateTime={detail.question.createdAt}>접수 {formatDateTime(detail.question.createdAt)}</time>
                  </div>
                  <p className="mt-5 text-sm font-medium text-(--color-text-secondary)">직원 질문</p>
                  <h1 className="mt-2 whitespace-pre-wrap wrap-break-word text-xl font-semibold leading-8 text-(--color-text-primary)">
                    {detail.question.question}
                  </h1>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {detail.question.originReason === "frequent_question" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800">
                        <Repeat2 size={14} aria-hidden="true" /> 반복 질문 ({detail.question.repeatCount}회)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-900">
                        <BookOpen size={14} aria-hidden="true" /> 매뉴얼 근거 부족
                      </span>
                    )}
                    {detail.question.resolutionStatus && (
                      <span className="rounded-full border border-(--color-border) px-3 py-1.5 text-xs font-semibold text-(--color-text-primary)">
                        {resolutionLabel(detail.question.resolutionStatus)}
                      </span>
                    )}
                  </div>

                </header>

                <QuestionManualFollowup key={`${detail.store.storeId}:${detail.question.id}`} storeId={detail.store.storeId} storeName={detail.store.storeName} questionId={detail.question.id} question={detail.question.question} />

              </article>
            )}
          </div>
        </main>
        {detail.kind === "ready" && (
                <footer aria-label="질문 처리 상태 변경" className="shrink-0 space-y-3 border-t border-(--color-border) bg-(--color-bg-default) px-5 sm:px-8 lg:px-12 xl:px-16 max-w-5xl pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
                {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
                {notice && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}
                {!detail.resolutionFeatureAvailable && (
                  <p role="status" className="rounded-md border border-(--color-border) bg-white p-4 text-sm text-(--color-text-secondary)">
                    질문 처리 상태 관리 기능이 아직 준비 중입니다. 현재는 질문 열람만 가능합니다.
                  </p>
                )}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-(--color-text-secondary)">직원 안내 또는 재질문 결과를 확인한 뒤 완료하세요.</p>
                  <div className="flex flex-wrap items-center gap-2">
                  {detail.question.resolutionStatus === "open" && (
                    <button
                      type="button"
                      disabled={updating || !detail.resolutionFeatureAvailable}
                      onClick={() => void handleStatusChange("in_progress")}
                      className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-(--color-border) px-4 py-2.5 text-sm font-medium text-(--color-text-primary) hover:bg-(--color-bg-surface) focus-visible:outline-2 focus-visible:outline-(--color-primary) disabled:opacity-50 sm:flex-none"
                    >
                      <Check size={16} aria-hidden="true" /> 처리 시작
                    </button>
                  )}
                  {(detail.question.resolutionStatus === "open" || detail.question.resolutionStatus === "in_progress") && (
                    <button
                      type="button"
                      disabled={updating || !detail.resolutionFeatureAvailable}
                      onClick={() => void handleStatusChange("resolved")}
                      className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-(--color-primary) px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary) disabled:opacity-50 sm:flex-none"
                    >
                      <CircleCheck size={16} aria-hidden="true" /> {updating ? "처리 중..." : "처리 완료"}
                    </button>
                  )}
                  {detail.question.resolutionStatus === "resolved" && (
                    <button
                      type="button"
                      disabled={updating || !detail.resolutionFeatureAvailable}
                      onClick={() => void handleStatusChange("in_progress")}
                      className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-(--color-border) px-4 py-2.5 text-sm font-medium text-(--color-text-primary) hover:bg-(--color-bg-surface) focus-visible:outline-2 focus-visible:outline-(--color-primary) disabled:opacity-50 sm:flex-none"
                    >
                      <RotateCcw size={16} aria-hidden="true" /> 다시 처리하기
                    </button>
                  )}
                  </div>
                </div>
                </footer>
        )}
      </div>
    </div>
  );
}