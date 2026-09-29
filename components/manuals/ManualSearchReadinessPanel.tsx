"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, MinusCircle, RefreshCw } from "lucide-react";

import type { ManualReadinessDetail, ManualReadinessReport } from "@/lib/manuals/manual-search-readiness";

type Props = {
  /** 상태 조회 URL. 지점 화면은 storeId 쿼리를 포함해서 넘긴다. */
  readinessUrl: string;
  /** 재처리 요청 URL. */
  reindexUrl: string;
  /** 지점 화면에서만 사용. 서버가 다시 검증하므로 화면 표시에는 쓰지 않는다. */
  storeId?: string;
};

const STATUS_ICONS = {
  ready: CheckCircle2,
  needs_reindex: AlertCircle,
  not_searchable: MinusCircle,
  parent_only: MinusCircle,
} as const;

const STATUS_STYLES = {
  ready: "bg-green-50 text-green-800 border-green-300",
  needs_reindex: "bg-amber-50 text-amber-900 border-amber-400",
  not_searchable: "bg-gray-50 text-gray-700 border-gray-300",
  parent_only: "bg-gray-50 text-gray-700 border-gray-300",
} as const;

function StatusBadge({ manual }: { manual: ManualReadinessDetail }) {
  const Icon = STATUS_ICONS[manual.status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_STYLES[manual.status]}`}
    >
      <Icon size={14} aria-hidden="true" />
      {manual.statusLabel}
    </span>
  );
}

export function ManualSearchReadinessPanel({ readinessUrl, reindexUrl, storeId }: Props) {
  const [report, setReport] = useState<ManualReadinessReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyManualId, setBusyManualId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const loadReport = useCallback(async (): Promise<{ report?: ManualReadinessReport; error?: string }> => {
    const response = await fetch(readinessUrl);
    const data = (await response.json()) as { report?: ManualReadinessReport; error?: string };
    if (!response.ok || !data.report) {
      throw new Error(data.error || "검색 준비 상태를 불러오지 못했어요.");
    }
    return data;
  }, [readinessUrl]);

  useEffect(() => {
    let cancelled = false;

    loadReport()
      .then((data) => {
        if (cancelled || !data.report) return;
        setReport(data.report);
        setError("");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "검색 준비 상태를 불러오지 못했어요.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadReport, reloadToken]);

  const handleReindex = async (manual: ManualReadinessDetail) => {
    setBusyManualId(manual.manualId);
    setNotice("");
    setError("");

    try {
      const response = await fetch(reindexUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(storeId ? { storeId, manualId: manual.manualId } : { manualId: manual.manualId }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "검색 준비를 다시 하지 못했어요.");
      }

      setNotice(`'${manual.title}'의 검색 준비를 다시 했어요.`);
      setReloadToken((token) => token + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "검색 준비를 다시 하지 못했어요.");
    } finally {
      setBusyManualId(null);
    }
  };

  const summary = report?.summary;
  const needsAttention = (summary?.needsReindexCount ?? 0) > 0;
  const groupsToShow = report?.groups.filter((group) => group.manuals.length > 0) ?? [];

  return (
    <section
      aria-label="검색 준비 상태"
      className="mb-6 rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">검색 준비 상태</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)] break-keep">
            저장이 끝나도 준비가 되어야 직원 챗봇이 답변에 사용할 수 있어요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          className="self-start rounded-lg border-2 border-[var(--color-border)] px-4 py-2 text-sm font-bold text-[var(--color-text-primary)] hover:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-accent)]"
        >
          {isExpanded ? "자세히 보기 닫기" : "자세히 보기"}
        </button>
      </div>

      {isLoading && !report ? (
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">상태를 확인하는 중이에요...</p>
      ) : summary ? (
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-green-300 bg-green-50 p-3">
            <dt className="text-sm font-semibold text-green-900">검색 준비 완료</dt>
            <dd className="mt-1 text-2xl font-bold text-green-900">{summary.readyCount}개</dd>
          </div>
          <div className="rounded-lg border border-amber-400 bg-amber-50 p-3">
            <dt className="text-sm font-semibold text-amber-900">검색 준비 필요</dt>
            <dd className="mt-1 text-2xl font-bold text-amber-900">{summary.needsReindexCount}개</dd>
          </div>
          <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
            <dt className="text-sm font-semibold text-gray-700">검색 대상 아님</dt>
            <dd className="mt-1 text-2xl font-bold text-gray-700">{summary.notSearchableCount}개</dd>
          </div>
        </dl>
      ) : null}

      {summary && !needsAttention && (
        <p className="mt-3 text-sm font-semibold text-[var(--color-text-primary)]">
          모든 매뉴얼이 검색 준비를 마쳤어요.
        </p>
      )}

      <p role="status" aria-live="polite" className="mt-3 text-sm font-semibold text-[var(--color-text-primary)]">
        {notice}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-[var(--color-status-error)] break-keep">
          {error}
        </p>
      )}

      {isExpanded && (
        <div className="mt-4 space-y-4">
          {groupsToShow.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">아직 등록된 세부 매뉴얼이 없어요.</p>
          ) : (
            groupsToShow.map((group, groupIndex) => (
              <div key={`${group.category}-${group.title}-${groupIndex}`} className="rounded-lg border border-[var(--color-border)] p-4">
                <p className="text-xs font-semibold text-[var(--color-text-tertiary)]">{group.category}</p>
                <p className="text-base font-bold text-[var(--color-text-primary)] break-keep">{group.title}</p>
                <ul className="mt-3 space-y-2">
                  {group.manuals.map((manual) => (
                    <li
                      key={manual.manualId}
                      className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="text-sm text-[var(--color-text-primary)] break-keep">{manual.title}</span>
                      <span className="flex items-center gap-2">
                        <StatusBadge manual={manual} />
                        {manual.canReindex && (
                          <button
                            type="button"
                            onClick={() => void handleReindex(manual)}
                            disabled={busyManualId !== null}
                            aria-label={`${manual.title} 검색 준비 다시 하기`}
                            className="inline-flex items-center gap-1 rounded-lg border-2 border-[var(--color-primary)] px-3 py-1.5 text-sm font-bold text-[var(--color-primary)] hover:bg-[var(--color-primary-light)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <RefreshCw size={14} aria-hidden="true" />
                            {busyManualId === manual.manualId ? "준비하는 중..." : "검색 준비 다시 하기"}
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
