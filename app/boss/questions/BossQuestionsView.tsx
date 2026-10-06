"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, MessageCircleQuestionMark, RefreshCw, Repeat2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import {
  type OwnerStore,
  persistSelectedStore,
  resolveOwnerCurrentStore,
} from "@/lib/owner/current-store";
import {
  BOSS_QUESTIONS_PATH,
  buildBossQuestionDetailUrl,
  type QuestionsLoadState,
  classifyPendingQuestionsResponse,
  pickQuestionsStore,
  visibleQuestionsState,
} from "@/lib/owner/boss-questions-view";
import type {
  PendingQuestion,
  QuestionResolutionFilter,
  QuestionResolutionStatus,
} from "@/lib/owner/pending-questions";

interface BossQuestionsViewProps {
  requestedStoreId: string | null;
  highlightQuestionId: string | null;
}

type StoreState =
  | { status: "resolving" }
  | { status: "error" }
  | { status: "no-store" }
  | { status: "ready"; store: OwnerStore; requestedStoreRejected: boolean };

const QUESTION_LIMIT = 20;

const actionButtonClass =
  "inline-flex min-h-[36px] items-center justify-center rounded-lg px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50";

const RESOLUTION_FILTER_TABS: Array<{ id: QuestionResolutionFilter; label: string }> = [
  { id: "active", label: "확인 필요" },
  { id: "resolved", label: "처리 완료" },
  { id: "all", label: "전체" },
];

function ResolutionBadge({ status }: { status: QuestionResolutionStatus }) {
  if (status === "resolved") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        처리 완료
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
        확인 중
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
      미처리
    </span>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function Notice({ tone, children }: { tone: "info" | "error"; children: React.ReactNode }) {
  const toneClass = tone === "error"
    ? "bg-red-50 border-red-200 text-red-700"
    : "bg-white border-[var(--color-border)] text-[var(--color-text-secondary)]";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-5 py-4 text-sm ${toneClass}`}>
      {children}
    </div>
  );
}

export default function BossQuestionsView({
  requestedStoreId,
  highlightQuestionId,
}: BossQuestionsViewProps) {
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [storeState, setStoreState] = useState<StoreState>({ status: "resolving" });
  const [questionsState, setQuestionsState] = useState<QuestionsLoadState | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeFilter, setActiveFilter] = useState<QuestionResolutionFilter>("active");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<{ id: string; message: string } | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState<string | null>(null);
  const highlightRef = useRef<HTMLLIElement>(null);

  // 알림 링크의 storeId는 승인된 점주 매장 목록과 대조한 뒤에만 현재 매장으로 채택한다.
  // 헤더는 이 결정 뒤에 렌더링해 헤더와 목록이 같은 매장을 기준으로 삼게 한다.
  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      try {
        const { data } = await createClient().auth.getSession();
        if (!isCancelled) setUserName(data.session?.user.user_metadata?.name || "점주");
      } catch {
        // 이름 표시만 생략한다.
      }

      const resolution = await resolveOwnerCurrentStore();
      if (isCancelled) return;

      if (resolution.status === "error") {
        setStoreState({ status: "error" });
        return;
      }

      const choice = pickQuestionsStore(resolution.stores, resolution.current, requestedStoreId);
      if (!choice.store) {
        setStoreState({ status: "no-store" });
        return;
      }

      if (choice.store.storeId !== resolution.current?.storeId) {
        persistSelectedStore(choice.store);
      }

      // 헤더에서 매장을 바꾸면 화면을 새로고침하므로, URL의 storeId가 남아 선택을 되돌리지 않게 지운다.
      if (requestedStoreId || highlightQuestionId) {
        window.history.replaceState(null, "", BOSS_QUESTIONS_PATH);
      }

      setStoreState({ status: "ready", store: choice.store, requestedStoreRejected: choice.requestedStoreRejected });
    })();

    return () => {
      isCancelled = true;
    };
  }, [requestedStoreId, highlightQuestionId]);

  const selectedStoreId = storeState.status === "ready" ? storeState.store.storeId : "";
  const highlightForFetch =
    storeState.status === "ready" && !storeState.requestedStoreRejected ? highlightQuestionId : null;

  useEffect(() => {
    if (!selectedStoreId) return;

    const controller = new AbortController();

    void (async () => {
      let next: QuestionsLoadState;
      try {
        const queryParams = new URLSearchParams({
          storeId: selectedStoreId,
          limit: String(QUESTION_LIMIT),
          resolutionStatus: activeFilter,
        });
        // 완료됐거나 최근 목록 밖의 알림 질문도 서버가 같은 매장 범위에서 찾아 넣는다.
        if (highlightForFetch) queryParams.set("questionId", highlightForFetch);
        const response = await fetch(
          `/api/boss/question-logs?${queryParams.toString()}`,
          { credentials: "include", signal: controller.signal },
        );
        const body: unknown = await response.json().catch(() => null);
        next = classifyPendingQuestionsResponse(selectedStoreId, response.status, body);
      } catch {
        next = { kind: "error", storeId: selectedStoreId };
      }
      if (!controller.signal.aborted) setQuestionsState(next);
    })();

    return () => controller.abort();
  }, [selectedStoreId, activeFilter, reloadKey, highlightForFetch]);

  const visible = selectedStoreId ? visibleQuestionsState(questionsState, selectedStoreId) : null;
  const canHighlight = Boolean(
    highlightQuestionId && storeState.status === "ready" && !storeState.requestedStoreRejected,
  );
  const highlightFound = visible?.kind === "ready"
    && canHighlight
    && visible.questions.some((question) => question.id === highlightQuestionId);

  useEffect(() => {
    if (highlightFound) highlightRef.current?.scrollIntoView({ block: "center" });
  }, [highlightFound]);

  useEffect(() => {
    if (!updateSuccess) return;
    const timeout = window.setTimeout(() => setUpdateSuccess(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [updateSuccess]);

  const handleUpdateStatus = async (
    question: PendingQuestion,
    nextStatus: QuestionResolutionStatus,
  ): Promise<boolean> => {
    if (updatingId || question.resolutionStatus === nextStatus) return false;
    setUpdatingId(question.id);
    setUpdateError(null);
    setUpdateSuccess(null);

    try {
      const response = await fetch("/api/boss/question-logs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          questionLogId: question.id,
          nextStatus,
          currentStatus: question.resolutionStatus,
          currentRevision: question.resolutionRevision,
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        code?: string;
      } | null;

      if (!response.ok || !body?.success) {
        const errorMsg =
          body?.code === "RESOLUTION_FEATURE_UNAVAILABLE"
            ? "질문 처리 상태 관리 기능이 아직 준비 중입니다. 관리자에게 문의해 주세요."
            : body?.code === "RESOLUTION_STATUS_CONFLICT"
              ? "다른 관리자에 의해 질문 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요."
              : (body?.error || "처리 상태 변경에 실패했습니다. 다시 시도해 주세요.");
        setUpdateError({ id: question.id, message: errorMsg });
        return false;
      }

      setUpdateSuccess(nextStatus === "resolved" ? "질문을 처리 완료로 변경했습니다." : "질문을 확인 중으로 변경했습니다.");
      setReloadKey((k) => k + 1);
      return true;
    } catch {
      setUpdateError({ id: question.id, message: "네트워크 오류가 발생했습니다. 다시 시도해 주세요." });
      return false;
    } finally {
      setUpdatingId(null);
    }
  };

  const handleStartProcessing = async (question: PendingQuestion) => {
    if (storeState.status !== "ready") return;
    const started = question.resolutionStatus === "in_progress"
      || await handleUpdateStatus(question, "in_progress");
    if (started) {
      router.push(buildBossQuestionDetailUrl(question.id, storeState.store.storeId));
    }
  };

  const handleRetry = useCallback(() => {
    setQuestionsState(null);
    setReloadKey((key) => key + 1);
  }, []);

  const handleLogout = async () => {
    try {
      await createClient().auth.signOut();
    } catch (e) {
      console.error("Logout failed:", e);
    }
    router.push("/");
  };

  const storeName = storeState.status === "ready" ? storeState.store.storeName : "";

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex">
      <OwnerSidebar activeMenu="questions" onLogout={handleLogout} />

      <div className="flex-1 min-w-0 ml-0 lg:ml-[240px] flex flex-col">
        {storeState.status === "resolving" ? (
          <div className="sticky top-0 z-20 bg-white border-b border-[var(--color-border)] h-16 shrink-0" />
        ) : (
          <OwnerHeader userName={userName} storeName={storeName} onLogout={handleLogout} />
        )}

        <main className="flex-1 overflow-y-auto">
          <div className="p-6 lg:p-8 max-w-7xl mx-auto">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                확인이 필요한 직원 질문
              </h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                매뉴얼 근거가 부족한 질문과 최근 7일간 반복된 질문입니다. 최근 {QUESTION_LIMIT}건까지 표시합니다.
              </p>
              {storeState.status === "ready" && (
                <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
                  현재 매장 · <span className="font-semibold text-[var(--color-text-secondary)]">{storeName}</span>
                </p>
              )}
            </div>

            {storeState.status === "resolving" && <Notice tone="info">매장 정보를 불러오는 중...</Notice>}
            {storeState.status === "error" && <Notice tone="error">매장 정보를 불러올 수 없습니다.</Notice>}
            {storeState.status === "no-store" && <Notice tone="info">승인된 매장이 없습니다.</Notice>}

            {storeState.status === "ready" && visible && (
              <>
                {storeState.requestedStoreRejected && (
                  <div className="mb-6">
                    <Notice tone="info">
                      알림의 매장에 접근할 수 없어 현재 운영 매장의 질문을 표시합니다.
                    </Notice>
                  </div>
                )}

                {visible.kind === "ready" && !visible.resolutionFeatureAvailable && (
                  <div className="mb-6">
                    <Notice tone="info">
                      질문 처리 상태 관리 기능이 아직 준비 중입니다. 현재는 질문 열람만 가능합니다.
                    </Notice>
                  </div>
                )}

                {/* 상태 필터 (직원 카테고리 칩과 같은 스타일) */}
                <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="처리 상태">
                  {RESOLUTION_FILTER_TABS.map((tab) => {
                    const isSelected = activeFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => {
                          if (activeFilter !== tab.id) {
                            setActiveFilter(tab.id);
                            setQuestionsState(null);
                          }
                        }}
                        className={`min-h-[36px] rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                          isSelected
                            ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]"
                            : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-text-primary)]"
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {updateSuccess && <div className="mb-4"><Notice tone="info">{updateSuccess}</Notice></div>}

                {visible.kind === "loading" && <Notice tone="info">질문을 불러오는 중...</Notice>}

                {visible.kind === "forbidden" && (
                  <Notice tone="error">이 매장의 질문을 볼 권한이 없습니다. 매장 승인 상태를 확인해 주세요.</Notice>
                )}

                {visible.kind === "error" && (
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
                    <p className="flex-1 text-sm text-red-700">질문 목록을 불러오지 못했습니다.</p>
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                    >
                      <RefreshCw size={16} aria-hidden="true" /> 다시 시도
                    </button>
                  </div>
                )}

                {visible.kind === "ready" && visible.questions.length === 0 && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
                    <MessageCircleQuestionMark size={28} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                    <p className="text-base font-semibold text-[var(--color-text-primary)]">
                      보류된 질문이 없습니다.
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                      매뉴얼 근거 부족 또는 반복 질문이 있으면 이곳에 표시됩니다.
                    </p>
                  </div>
                )}

                {visible.kind === "ready" && visible.questions.length > 0 && (
                  <>
                    {canHighlight && !highlightFound && (
                      <div className="mb-4">
                        <Notice tone="info">알림의 질문을 이 매장의 보류 질문에서 찾을 수 없습니다.</Notice>
                      </div>
                    )}
                    <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
                      질문 <span className="font-bold text-[var(--color-text-primary)]">{visible.questions.length}</span>건
                    </p>
                    <ul className="space-y-3">
                      {visible.questions.map((question) => {
                        const isHighlighted = highlightFound && question.id === highlightQuestionId;
                        const isUpdating = updatingId === question.id;
                        const hasError = updateError?.id === question.id;
                        const isInProgress = question.resolutionStatus === "in_progress";
                        const detailUrl = buildBossQuestionDetailUrl(question.id, storeState.status === "ready" ? storeState.store.storeId : "");

                        return (
                          <li
                            key={question.id}
                            ref={isHighlighted ? highlightRef : undefined}
                            aria-current={isHighlighted ? "true" : undefined}
                            role={isInProgress ? "link" : undefined}
                            tabIndex={isInProgress ? 0 : undefined}
                            onClick={isInProgress ? () => router.push(detailUrl) : undefined}
                            onKeyDown={isInProgress ? (event) => {
                              if (event.target !== event.currentTarget || event.key !== "Enter") return;
                              event.preventDefault();
                              router.push(detailUrl);
                            } : undefined}
                            className={`rounded-xl border bg-white px-5 py-4 lg:p-5 transition-colors ${isInProgress ? "cursor-pointer hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]" : ""} ${
                              isHighlighted
                                ? "border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/20"
                                : "border-[var(--color-border)]"
                            }`}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                              <div className="flex items-center gap-2">
                                {question.resolutionStatus ? (
                                  <ResolutionBadge status={question.resolutionStatus} />
                                ) : (
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                                    반복 검토
                                  </span>
                                )}
                              </div>

                              {/* 상태 변경 액션 버튼들 */}
                              {question.resolutionStatus && (
                                <div className="flex items-center gap-1.5 self-end sm:self-auto">
                                  {question.resolutionStatus === "open" && (
                                    <button
                                      type="button"
                                      disabled={isUpdating || !visible.resolutionFeatureAvailable}
                                      onClick={() => handleStartProcessing(question)}
                                      className={`${actionButtonClass} border border-[var(--color-border)] bg-white text-[var(--color-text-primary)] hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-bg-default)]`}
                                    >
                                      {isUpdating ? "처리 중..." : "처리 시작"}
                                    </button>
                                  )}

                                  {(question.resolutionStatus === "open" || question.resolutionStatus === "in_progress") && (
                                    <button
                                      type="button"
                                      disabled={isUpdating || !visible.resolutionFeatureAvailable}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleUpdateStatus(question, "resolved");
                                      }}
                                      className={`${actionButtonClass} bg-[var(--color-primary)] text-white hover:opacity-90`}
                                    >
                                      {isUpdating ? "변경 중..." : "처리 완료"}
                                    </button>
                                  )}

                                  {question.resolutionStatus === "resolved" && (
                                    <button
                                      type="button"
                                      disabled={isUpdating || !visible.resolutionFeatureAvailable}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleUpdateStatus(question, "in_progress");
                                      }}
                                      className={`${actionButtonClass} border border-[var(--color-border)] bg-white text-[var(--color-text-primary)] hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-bg-default)]`}
                                    >
                                      {isUpdating ? "변경 중..." : "다시 열기"}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            <p className="text-base font-semibold text-[var(--color-text-primary)] whitespace-pre-wrap break-words mb-2">
                              {question.question}
                            </p>

                            {hasError && (
                              <p role="alert" className="mt-2 text-xs text-red-600">
                                {updateError.message}
                              </p>
                            )}

                            {question.resolutionStatus === "resolved" && question.resolvedAt && (
                              <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">
                                처리 완료: {formatDateTime(question.resolvedAt)}
                              </p>
                            )}

                            {question.resolutionStatus !== "resolved" && question.resolutionUpdatedAt && (
                              <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">
                                상태 변경: {formatDateTime(question.resolutionUpdatedAt)}
                              </p>
                            )}

                            <div className="mt-4 flex items-end justify-between gap-3">
                              <time dateTime={question.createdAt} className="text-xs text-[var(--color-text-tertiary)]">
                                {formatDateTime(question.createdAt)}
                              </time>
                              {question.originReason === "frequent_question" ? (
                                <span
                                  aria-label={`반복 질문, 최근 7일 ${question.repeatCount}회`}
                                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800"
                                >
                                  <Repeat2 size={14} aria-hidden="true" /> 반복 질문 ({question.repeatCount}회)
                                </span>
                              ) : (
                                <span
                                  aria-label="매뉴얼 근거 부족, 점주 확인 필요"
                                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-900"
                                >
                                  <BookOpen size={14} aria-hidden="true" /> 매뉴얼 근거 부족
                                </span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
