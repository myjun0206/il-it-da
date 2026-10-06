"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import { resolveOwnerCurrentStore } from "@/lib/owner/current-store";
import { BOSS_QUESTIONS_PATH, buildBossQuestionsUrl, pickQuestionsStore } from "@/lib/owner/boss-questions-view";
import type { RepeatedQuestionAlertView } from "@/lib/owner/repeated-question-alerts";

interface RepeatedQuestionViewProps {
  storeId: string | null;
  alertId: string | null;
}

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "error" }
  | { kind: "ready"; storeName: string; alert: RepeatedQuestionAlertView };

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function RepeatedQuestionView({ storeId, alertId }: RepeatedQuestionViewProps) {
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      try {
        const { data } = await createClient().auth.getSession();
        if (!isCancelled) setUserName(data.session?.user.user_metadata?.name || "점주");
      } catch {
        // 이름 표시만 생략한다.
      }

      if (!storeId || !alertId) {
        if (!isCancelled) setState({ kind: "not-found" });
        return;
      }

      // 알림 링크의 매장이 승인된 점주 매장 목록에 없으면 다른 매장으로 대체하지 않고 차단한다.
      const resolution = await resolveOwnerCurrentStore();
      if (isCancelled) return;
      if (resolution.status === "error") {
        setState({ kind: "error" });
        return;
      }
      const choice = pickQuestionsStore(resolution.stores, resolution.current, storeId);
      if (choice.requestedStoreRejected || !choice.store || choice.store.storeId !== storeId) {
        setState({ kind: "forbidden" });
        return;
      }

      try {
        const params = new URLSearchParams({ storeId, alertId });
        const response = await fetch(`/api/boss/repeated-questions?${params.toString()}`, { credentials: "include" });
        const body = (await response.json().catch(() => null)) as
          | { success?: boolean; data?: { alert?: RepeatedQuestionAlertView } }
          | null;
        if (isCancelled) return;

        if (response.status === 401 || response.status === 403) {
          setState({ kind: "forbidden" });
        } else if (response.status === 404) {
          setState({ kind: "not-found" });
        } else if (!response.ok || !body?.success || !body.data?.alert || body.data.alert.storeId !== storeId) {
          setState({ kind: "error" });
        } else {
          setState({ kind: "ready", storeName: choice.store.storeName, alert: body.data.alert });
        }
      } catch {
        if (!isCancelled) setState({ kind: "error" });
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [storeId, alertId]);

  const handleLogout = async () => {
    try {
      await createClient().auth.signOut();
    } catch (e) {
      console.error("Logout failed:", e);
    }
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex">
      <OwnerSidebar activeMenu="questions" onLogout={handleLogout} />

      <div className="flex-1 min-w-0 ml-0 lg:ml-[240px] flex flex-col">
        <OwnerHeader userName={userName} storeName={state.kind === "ready" ? state.storeName : ""} onLogout={handleLogout} />

        <main className="flex-1 overflow-y-auto">
          <div className="p-6 lg:p-8 max-w-7xl mx-auto">
           <div className="max-w-4xl">
            <Link
              href={BOSS_QUESTIONS_PATH}
              className="-ml-2 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <ArrowLeft size={16} aria-hidden="true" /> 보류 질문
            </Link>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">반복 질문</h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                같은 매장에서 같은 질문이 반복된 내용입니다. 근거 부족으로 보류된 질문 목록과는 별개입니다.
              </p>
            </div>

            {state.kind === "loading" && (
              <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
                <p role="status" className="text-base text-[var(--color-text-secondary)]">반복 질문을 불러오는 중...</p>
              </div>
            )}
            {state.kind === "forbidden" && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                이 매장의 반복 질문을 볼 권한이 없습니다.
              </p>
            )}
            {state.kind === "not-found" && (
              <p role="status" className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center text-base text-[var(--color-text-secondary)]">
                반복 질문 알림을 찾을 수 없습니다.
              </p>
            )}
            {state.kind === "error" && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                반복 질문 정보를 불러오지 못했습니다.
              </p>
            )}

            {state.kind === "ready" && (
              <section className="rounded-xl border border-[var(--color-border)] bg-white p-5 lg:p-6 space-y-4">
                <p className="inline-flex rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
                  알림 발송 시점 집계 · {formatDate(state.alert.alertedAt)}
                </p>
                {state.alert.analysisLimited === true && (
                  <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    이 기간의 질문이 너무 많아 최근 질문 일부만 집계했습니다. 실제 반복 횟수는 더 많을 수 있습니다.
                  </p>
                )}
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text-secondary)] mb-1">대표 질문</p>
                  <p className="text-base font-medium text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
                    {state.alert.representativeQuestion}
                  </p>
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-[var(--color-text-secondary)]">반복 횟수</dt>
                    <dd className="font-semibold text-[var(--color-text-primary)]">{state.alert.repeatCount}회</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-text-secondary)]">집계 기간</dt>
                    <dd className="font-semibold text-[var(--color-text-primary)]">
                      최근 {state.alert.windowDays}일 ({formatDate(state.alert.windowStart)} ~ {formatDate(state.alert.windowEnd)})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-text-secondary)]">분류</dt>
                    <dd className="font-semibold text-[var(--color-text-primary)]">{state.alert.categoryLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-text-secondary)]">답변 결과</dt>
                    <dd className="font-semibold text-[var(--color-text-primary)]">
                      답변 {state.alert.statusCounts.answered} · 주의 답변 {state.alert.statusCounts.cautious} · 근거 부족 {state.alert.statusCounts.insufficient}
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  반복 횟수·기간·분류는 알림 발송 당시 값이며, 이후 들어온 같은 질문은 반영되지 않습니다. 표현이 다른 비슷한 질문은 합산하지 않습니다.
                </p>
                <Link
                  href={buildBossQuestionsUrl(state.alert.storeId)}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
                >
                  보류·반복 질문 처리 화면으로 이동 <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </section>
            )}
           </div>
          </div>
        </main>
      </div>
    </div>
  );
}
