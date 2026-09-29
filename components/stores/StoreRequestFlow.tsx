"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Check, CheckCircle2, Clock3, Loader2, MapPin, Search, Store as StoreIcon, UserCheck } from "lucide-react";

import StoreMap from "@/components/signup/StoreMap";
import { formatStoreDisplayName, searchStores } from "@/lib/stores/search-stores";
import type { Store } from "@/lib/types/store";

const MIN_QUERY_LENGTH = 2;

/** 화면 문구 (직원: 근무 매장 / 점주: 운영 매장) */
export interface StoreRequestCopy {
  backHref: string;
  backLabel: string;
  title: string;
  description: string;
  successDescription: string;
  successTitle: string;
  pendingLabel: string;
  approvalStepLabel: string;
  startStepLabel: string;
  successGuide: string;
  successSubGuide: string;
  statusHref: string;
  searchIdleText: string;
  activeBadge: string;
  selectedLabel: string;
  applyLabel: string;
  duplicateApproved: string;
  duplicatePending: string;
  duplicateRejected: string;
}

export interface StoreRequestMembership {
  storeName: string;
  status: string;
}

/** 신청 API 호출 결과. 신청/권한 로직은 각 역할의 페이지(API)가 담당하고, 이 컴포넌트는 UI만 맡는다. */
export type StoreRequestOutcome =
  | { kind: "created"; storeName: string }
  | { kind: "error"; message: string };

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "done"; results: Store[] };

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  // 신청 직후 결과 화면 전용 상태. 실제 승인 여부의 기준은 항상 DB(membership)이며, 새로고침하면 사라진다.
  | { status: "requested"; storeName: string; address: string }
  | { status: "error"; message: string };

interface StoreRequestFlowProps {
  copy: StoreRequestCopy;
  /** 본인의 해당 역할 membership (검색 결과 배지·중복 안내용. 최종 판단은 서버) */
  memberships: StoreRequestMembership[];
  onSubmit: (store: Store) => Promise<StoreRequestOutcome>;
}

/**
 * 매장 검색(NAVER) + 지도 + 선택 매장 고정 Action Bar + 신청 완료 화면.
 * 직원 근무 매장 추가(/staff/stores/add)와 점주 운영 매장 추가(/boss/stores/add)가 함께 쓰는 UI.
 */
export default function StoreRequestFlow({ copy, memberships, onSubmit }: StoreRequestFlowProps) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  // 하단 고정 Action Bar: 데스크톱에서는 사이드바 하단(설정/로그아웃) 영역과 같은 높이로 맞춰
  // 두 영역의 상단 구분선이 한 줄로 이어지게 하고, 본문에는 바 높이만큼 여백을 준다.
  const actionBarRef = useRef<HTMLElement>(null);
  const [sidebarFooterHeight, setSidebarFooterHeight] = useState<number | null>(null);
  const [actionBarHeight, setActionBarHeight] = useState(0);

  // 검색 (기존 /api/stores/search 공통 호출 재사용, debounce + 취소)
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearch({ status: "loading" });
      searchStores(trimmed, controller.signal)
        .then((results) => {
          setSearch({ status: "done", results });
          setSelectedStoreId((current) => (results.some((store) => store.id === current) ? current : null));
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") return;
          setSearch({ status: "error" });
        });
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (value.trim().length < MIN_QUERY_LENGTH) {
      setSearch({ status: "idle" });
      setSelectedStoreId(null);
    }
  };

  useEffect(() => {
    const footer = document.querySelector<HTMLElement>("[data-app-sidebar-footer]");
    const desktop = window.matchMedia("(min-width: 1024px)");
    const update = () => setSidebarFooterHeight(footer && desktop.matches ? footer.offsetHeight : null);

    update();
    const observer = footer ? new ResizeObserver(update) : null;
    if (footer) observer?.observe(footer);
    desktop.addEventListener("change", update);
    return () => {
      observer?.disconnect();
      desktop.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    const bar = actionBarRef.current;
    if (!bar) return;
    const observer = new ResizeObserver(() => setActionBarHeight(bar.offsetHeight));
    observer.observe(bar);
    return () => observer.disconnect();
  });

  const results = useMemo(() => (search.status === "done" ? search.results : []), [search]);
  const resultIds = useMemo(() => results.map((store) => store.id), [results]);
  const selectedStore = results.find((store) => store.id === selectedStoreId) ?? null;

  // 서버(store-membership 서비스)와 같은 기준(정확한 매장명)으로 기존 신청 여부를 미리 안내한다.
  // 표시용 안내일 뿐이며, 실제 중복 방지·권한 판단은 서버가 매장 ID 기준으로 한다.
  const membershipStatusByName = useMemo(
    () => new Map(memberships.map((membership) => [membership.storeName, membership.status])),
    [memberships],
  );
  const existingStatus = selectedStore ? membershipStatusByName.get(selectedStore.name) ?? null : null;
  const existingMembership = existingStatus ? { status: existingStatus } : null;

  const selectStore = (store: Store) => {
    setSelectedStoreId(store.id);
    if (submit.status === "error") setSubmit({ status: "idle" });
  };

  const handleSubmit = async () => {
    if (!selectedStore || submit.status === "submitting" || existingMembership) return;

    setSubmit({ status: "submitting" });
    const outcome = await onSubmit(selectedStore);
    if (outcome.kind === "created") {
      setSubmit({ status: "requested", storeName: outcome.storeName, address: selectedStore.address ?? "" });
    } else {
      setSubmit({ status: "error", message: outcome.message });
    }
  };

  const showMapResults = search.status === "done" && results.length > 0;

  return (
    <>
      <Link
        href={copy.backHref}
        className="-ml-2 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {copy.backLabel}
      </Link>

      <div className="mb-5">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-1.5">{copy.title}</h1>
        <p className="text-base text-[var(--color-text-secondary)]">
          {submit.status === "requested"
            ? copy.successDescription
            : copy.description}
        </p>
      </div>

      {submit.status === "requested" ? (
        <section
          role="status"
          aria-labelledby="request-done-title"
          className="w-full rounded-xl border border-[var(--color-border)] bg-white p-6 sm:p-8 lg:px-12 lg:py-10"
        >
          <h2 id="request-done-title" className="flex items-center gap-2 text-lg font-bold text-[var(--color-primary)]">
            <CheckCircle2 size={24} aria-hidden="true" />
            {copy.successTitle}
          </h2>

          {/* 신청한 매장 (신청 시 선택한 매장 데이터) */}
          <div className="mt-6 flex flex-col gap-3 rounded-lg bg-[var(--color-bg-default)] px-5 py-4 sm:flex-row lg:px-6 sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <p className="text-base font-bold text-[var(--color-text-primary)]">
                {formatStoreDisplayName(submit.storeName)}
              </p>
              {submit.address && (
                <p className="mt-1 flex items-start gap-1.5 text-sm text-[var(--color-text-secondary)]">
                  <MapPin size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {submit.address}
                </p>
              )}
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-full bg-amber-50 px-2.5 py-1 text-sm font-medium text-amber-800 sm:self-auto">
              <Clock3 size={14} aria-hidden="true" /> {copy.pendingLabel}
            </span>
          </div>

          {/* 진행 단계: 신청 완료(완료) → 승인(현재) → 시작(예정) */}
          <ol aria-label="승인 진행 단계" className="mx-auto mt-10 grid w-full max-w-[52rem] grid-cols-3">
            {[
              { label: "신청 완료", state: "done" as const, Icon: Check, caption: "완료" },
              { label: copy.approvalStepLabel, state: "current" as const, Icon: UserCheck, caption: "승인 대기" },
              { label: copy.startStepLabel, state: "upcoming" as const, Icon: StoreIcon, caption: "예정" },
            ].map((step, index) => (
              <li
                key={step.label}
                aria-current={step.state === "current" ? "step" : undefined}
                className="relative flex flex-col items-center text-center"
              >
                {index > 0 && (
                  <span
                    aria-hidden="true"
                    className={`absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2 ${
                      step.state === "upcoming" ? "bg-[var(--color-border)]" : "bg-[var(--color-primary)]"
                    }`}
                  />
                )}
                <span
                  className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                    step.state === "done"
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                      : step.state === "current"
                        ? "border-amber-400 bg-amber-50 text-amber-800"
                        : "border-[var(--color-border)] bg-white text-[var(--color-text-tertiary)]"
                  }`}
                >
                  <step.Icon size={16} aria-hidden="true" />
                </span>
                <span
                  className={`mt-2 text-sm font-semibold ${
                    step.state === "upcoming" ? "text-[var(--color-text-tertiary)]" : "text-[var(--color-text-primary)]"
                  }`}
                >
                  {step.label}
                </span>
                <span
                  className={`text-xs ${
                    step.state === "current" ? "font-medium text-amber-800" : "text-[var(--color-text-tertiary)]"
                  }`}
                >
                  {step.caption}
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-10 space-y-1 border-t border-[var(--color-border)] pt-6">
            <p className="text-base text-[var(--color-text-primary)]">{copy.successGuide}</p>
            <p className="text-sm text-[var(--color-text-tertiary)]">{copy.successSubGuide}</p>
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Link
              href={copy.statusHref}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[var(--color-primary)] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
            >
              신청 현황 보기
            </Link>
            <button
              type="button"
              onClick={() => {
                // 결과 화면만 닫고 검색 화면으로 돌아간다. 방금 만든 pending 신청은 그대로 유지된다.
                setSubmit({ status: "idle" });
                setSelectedStoreId(null);
              }}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-[var(--color-border)] bg-white px-5 text-sm font-medium text-[var(--color-text-primary)] hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              다른 매장 추가
            </button>
          </div>

        </section>
      ) : (
        <>
          {/* STEP 1 — Search */}
          {/* 검색은 결과 목록과 지도를 함께 제어하므로 아래 작업 영역과 같은 폭(w-full)을 쓴다. */}
          <div className="relative mb-4 w-full">
            <Search
              size={20}
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              placeholder="매장명 또는 주소로 검색"
              aria-label="매장명 또는 주소로 검색"
              className="h-12 w-full rounded-lg border-2 border-[var(--color-border)] bg-white pl-12 pr-4 text-base [&::-webkit-search-cancel-button]:cursor-pointer text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30"
            />
          </div>

          {/* STEP 2 — Results (≈40%) + Map (≈60%) */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.3fr)]">
            <section
              aria-label="검색 결과"
              className="flex max-h-[360px] min-h-[220px] flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-white lg:h-[540px] lg:max-h-none"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">검색 결과</h2>
                {search.status === "done" && (
                  <span className="text-sm text-[var(--color-text-secondary)]">{results.length}</span>
                )}
              </div>

              {search.status === "idle" ? (
                <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
                  <StoreIcon size={24} className="mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                  <p className="text-sm text-[var(--color-text-secondary)]">{copy.searchIdleText}</p>
                  <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">매장명 또는 주소를 2글자 이상 입력하세요.</p>
                </div>
              ) : search.status === "loading" ? (
                <p className="flex flex-1 items-center justify-center gap-2 px-5 py-8 text-sm text-[var(--color-text-secondary)]" role="status">
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" /> 검색 중...
                </p>
              ) : search.status === "error" ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-8 text-center" role="alert">
                  <p className="flex items-center gap-2 text-sm text-red-700">
                    <AlertCircle size={16} aria-hidden="true" /> 매장 검색 중 문제가 발생했습니다.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const current = query;
                      setQuery("");
                      setTimeout(() => setQuery(current), 0);
                    }}
                    className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                  >
                    다시 시도
                  </button>
                </div>
              ) : results.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
                  <p className="text-sm text-[var(--color-text-secondary)]">검색 결과가 없습니다.</p>
                  <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">매장명이나 주소를 다시 확인해 주세요.</p>
                </div>
              ) : (
                <ul className="flex-1 overflow-y-auto [scrollbar-width:thin]">
                  {results.map((store) => {
                    const isSelected = store.id === selectedStoreId;
                    const status = membershipStatusByName.get(store.name);
                    return (
                      <li key={store.id} className="border-b border-[var(--color-border)] last:border-b-0">
                        <button
                          type="button"
                          onClick={() => selectStore(store)}
                          aria-pressed={isSelected}
                          className={`flex min-h-[56px] w-full items-start gap-2.5 border-l-4 px-3.5 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)] ${
                            isSelected
                              ? "border-l-[var(--color-primary)] bg-[var(--color-primary-light)]/30"
                              : "border-l-transparent hover:bg-[var(--color-bg-default)]"
                          }`}
                        >
                          {isSelected ? (
                            <Check size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
                          ) : (
                            <MapPin size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--color-text-tertiary)]" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span
                              className={`block truncate text-sm font-semibold ${
                                isSelected ? "text-[var(--color-primary)]" : "text-[var(--color-text-primary)]"
                              }`}
                            >
                              {formatStoreDisplayName(store.name)}
                            </span>
                            {store.address && (
                              <span className="mt-0.5 block truncate text-sm text-[var(--color-text-secondary)]">
                                {store.address}
                              </span>
                            )}
                          </span>
                          {status === "approved" ? (
                            <span className="mt-0.5 shrink-0 rounded-full bg-[var(--color-primary-light)]/40 px-2 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
                              {copy.activeBadge}
                            </span>
                          ) : status === "pending" ? (
                            <span className="mt-0.5 shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                              승인 대기
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section
              aria-label="매장 위치 지도"
              className="relative h-[260px] overflow-hidden rounded-xl border border-[var(--color-border)] bg-white md:h-[360px] lg:h-[540px]"
            >
              {showMapResults ? (
                <StoreMap
                  stores={results}
                  selectedStoreIds={resultIds}
                  focusedStoreId={selectedStoreId}
                  onStoreSelect={selectStore}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center bg-[var(--color-bg-default)] px-6 text-center">
                  <MapPin size={28} className="mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                  <p className="text-sm text-[var(--color-text-secondary)]">검색하면 매장 위치가 지도에 표시됩니다.</p>
                </div>
              )}
            </section>
          </div>

          {/* STEP 3 — Selected store action bar: 선택했을 때만, viewport 하단 고정.
              사이드바(240px) 오른쪽 main 영역에만 놓이고, 헤더/드롭다운(z-30~50)보다 낮은 z-20. */}
          {selectedStore && (
            <section
              ref={actionBarRef}
              aria-label={copy.selectedLabel}
              style={sidebarFooterHeight ? { minHeight: sidebarFooterHeight } : undefined}
              className="fixed bottom-0 left-0 right-0 z-20 flex items-center border-t border-[var(--color-border)] bg-white px-6 py-4 lg:left-[240px] lg:px-8"
            >
              <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-secondary)]">선택한 매장</p>
                  <p className="truncate text-base font-bold text-[var(--color-text-primary)]">
                    {formatStoreDisplayName(selectedStore.name)}
                  </p>
                  {selectedStore.address && (
                    <p className="truncate text-sm text-[var(--color-text-secondary)]">{selectedStore.address}</p>
                  )}
                  {submit.status === "error" && (
                    <p className="mt-1 flex items-start gap-2 text-sm text-red-700" role="alert">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                      {submit.message}
                    </p>
                  )}
                </div>

                <div className="shrink-0">
                  {existingMembership?.status === "approved" ? (
                    <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)]" role="status">
                      <CheckCircle2 size={16} aria-hidden="true" /> {copy.duplicateApproved}
                    </p>
                  ) : existingMembership?.status === "pending" ? (
                    <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800" role="status">
                      <Clock3 size={16} aria-hidden="true" /> {copy.duplicatePending}
                    </p>
                  ) : existingMembership?.status === "rejected" ? (
                    <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text-secondary)]" role="status">
                      <AlertCircle size={16} aria-hidden="true" /> {copy.duplicateRejected}
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={submit.status === "submitting"}
                      className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[var(--color-primary)] px-6 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
                    >
                      {submit.status === "submitting" ? "신청 중..." : copy.applyLabel}
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* 고정 Action Bar에 본문 끝이 가려지지 않도록 실제 바 높이만큼 여백 */}
          {selectedStore && <div aria-hidden="true" style={{ height: actionBarHeight + 20 }} />}
        </>
      )}
    </>
  );
}
