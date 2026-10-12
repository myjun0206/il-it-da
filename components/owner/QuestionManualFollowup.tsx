"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ChevronDown, Copy, Pencil, RefreshCw, Search, X } from "lucide-react";
import { buildManualSelectionGroups } from "@/lib/manuals/manual-selection";
import { buildQuestionManualEditUrl, type QuestionManualContext } from "@/lib/owner/question-manual-context";
import type { ManualRecord } from "@/lib/types/manual";

export default function QuestionManualFollowup({ storeId, storeName, questionId, question }: {
  storeId: string; storeName?: string; questionId: string; question: string;
}) {
  const [context, setContext] = useState<QuestionManualContext | null>(null);
  const [manuals, setManuals] = useState<ManualRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [manualsError, setManualsError] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedAccordion, setExpandedAccordion] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [copyNotice, setCopyNotice] = useState("");
  const [copying, setCopying] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const manualGroups = buildManualSelectionGroups(manuals, storeId);
  const options = manualGroups.flatMap((group) => group.options);

  // 검색 필터링 로직
  const filteredOptions = searchQuery.trim() === ""
    ? options
    : options.filter((option) => {
        const query = searchQuery.toLowerCase();
        return (
          option.manual.title.toLowerCase().includes(query) ||
          option.manual.content.toLowerCase().includes(query)
        );
      });

  const selectedOption = options.find((option) => option.manual.id === selectedId);
  const selectedManual = selectedOption?.manual;

  // 선택된 매뉴얼이 매장 매뉴얼인지 판단
  const isStoreManual = selectedManual && selectedManual.store_id !== null;

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ storeId });
    void (async () => {
      const results = await Promise.allSettled([
        fetch(`/api/boss/question-logs/${encodeURIComponent(questionId)}/context?${query}`).then(async (response) => {
          const body = await response.json() as { context?: QuestionManualContext; error?: string };
          if (!response.ok || !body.context) throw new Error(body.error || "기존 답변을 불러오지 못했습니다.");
          return body.context;
        }),
        fetch(`/api/store-manuals?${query}`).then(async (response) => {
          const body = await response.json() as { manuals?: ManualRecord[]; error?: string };
          if (!response.ok || !body.manuals) throw new Error(body.error || "매장 매뉴얼을 불러오지 못했습니다.");
          return body.manuals;
        }),
      ]);
      if (cancelled) return;
      const [contextResult, manualsResult] = results;
      if (contextResult.status === "fulfilled") { setContext(contextResult.value); setError(""); }
      else { setContext(null); setError("기존 답변과 근거를 확인하지 못했습니다."); }
      if (manualsResult.status === "fulfilled") {
        const rows = manualsResult.value;
        const available = rows.filter((row) => row.store_id === storeId);
        setManuals(available);
        const selectable = buildManualSelectionGroups(available, storeId).flatMap((group) => group.options);
        setSelectedId((current) => selectable.some((option) => option.manual.id === current) ? current : "");
        setManualsError("");
      } else { setManuals([]); setSelectedId(""); setManualsError("매장 매뉴얼 목록을 확인하지 못했습니다. 다시 불러와 주세요."); }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [storeId, questionId, reload]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isDropdownOpen]);

  useEffect(() => {
    if (isDropdownOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isDropdownOpen]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        setReload((value) => value + 1);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const toggleAccordion = (key: string) => {
    setExpandedAccordion(expandedAccordion === key ? null : key);
  };

  const handleSelectOption = (optionId: string) => {
    setSelectedId(optionId);
    setIsDropdownOpen(false);
    setSearchQuery("");
    document.getElementById(`${id}-manual`)?.focus();
  };

  const handleManualKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setIsDropdownOpen(false);
      document.getElementById(`${id}-manual`)?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsDropdownOpen(true);
      setHighlightedIndex((current) => !isDropdownOpen ? 0 : Math.max(0, Math.min(filteredOptions.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" && isDropdownOpen) {
      event.preventDefault();
      const option = filteredOptions[highlightedIndex];
      if (option) handleSelectOption(option.manual.id);
    }
  };

  const copyQuestion = async () => {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(question);
      setCopyNotice("질문 원문을 복사했습니다.");
    } catch {
      setCopyNotice("복사하지 못했습니다. 질문 원문을 직접 선택해 주세요.");
    } finally {
      setCopying(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  return (
    <div className="space-y-6">
      {/* 1단계: 매뉴얼 확인하기 */}
      <section aria-label="1단계: 매뉴얼 확인하기" className="min-w-0 mb-10">
        <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">1단계: 매뉴얼 확인하기</h2>

        <div className="space-y-4">
          {error && <p role="alert" className="text-base text-red-700 font-medium">{error}</p>}
          {manualsError && <p role="alert" className="text-base text-red-700 font-medium">{manualsError}</p>}
          {loading && <p role="status" className="text-base text-[var(--color-text-secondary)]">답변과 매장 매뉴얼을 불러오는 중...</p>}
          {!loading && !manualsError && options.length === 0 && <p role="status" className="text-base text-[var(--color-text-secondary)]">수정할 매장 매뉴얼이 없습니다.</p>}

          {(
            <>
              {/* 커스텀 드롭다운 */}
              <div ref={dropdownRef} className="relative">
                <label htmlFor={`${id}-manual`} className="block text-sm font-semibold mb-2 text-[var(--color-text-primary)]">매뉴얼 선택</label>
                <button
                  id={`${id}-manual`}
                  type="button"
                  disabled={loading || !!manualsError || options.length === 0}
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  onKeyDown={handleManualKey}
                  aria-label="수정할 매장 매뉴얼을 선택하세요"
                  aria-haspopup="listbox"
                  aria-expanded={isDropdownOpen}
                  aria-controls={`${id}-options`}
                  data-selected-id={selectedId}
                  className="w-full min-h-[48px] rounded-lg border-2 border-[var(--color-border)] bg-white px-4 py-3 text-base text-left font-medium text-[var(--color-text-primary)] hover:border-[var(--color-primary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 disabled:opacity-60 transition-colors flex items-center justify-between"
                >
                  <span className="truncate">
                    {selectedOption?.title || "수정할 매장 매뉴얼을 선택하세요"}
                  </span>
                  <ChevronDown
                    size={20}
                    className={`shrink-0 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                </button>

                {isDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border-2 border-[var(--color-border)] bg-white shadow-lg overflow-hidden">
                    {/* 검색창 */}
                    <div className="sticky top-0 bg-white border-b border-[var(--color-border)] p-3">
                      <div className="relative flex items-center">
                        <Search size={16} className="absolute left-3 text-[var(--color-text-secondary)]" aria-hidden="true" />
                        <input
                          ref={searchInputRef}
                          type="text"
                          placeholder="매뉴얼 검색..."
                          value={searchQuery}
                          onChange={(event) => { setSearchQuery(event.target.value); setHighlightedIndex(0); }}
                          onKeyDown={handleManualKey}
                          aria-controls={`${id}-options`}
                          aria-activedescendant={filteredOptions[highlightedIndex] ? `${id}-option-${filteredOptions[highlightedIndex].manual.id}` : undefined}
                          className="w-full min-h-[36px] pl-9 pr-9 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-white text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 transition-colors"
                          aria-label="매뉴얼 검색"
                        />
                        {searchQuery && (
                          <button
                            type="button"
                            onClick={clearSearch}
                            className="absolute right-3 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                            aria-label="검색어 지우기"
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 검색 결과 */}
                    {filteredOptions.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-[var(--color-text-secondary)]">
                        검색 결과가 없습니다.
                      </div>
                    ) : (
                      <ul id={`${id}-options`} role="listbox" aria-label="매장 매뉴얼" className="max-h-64 overflow-y-auto">
                        {manualGroups.map((group) => {
                          const groupOptions = group.options.filter((option) =>
                            filteredOptions.some((filtered) => filtered.manual.id === option.manual.id)
                          );

                          if (groupOptions.length === 0) return null;

                          return (
                            <li key={group.id} role="group" aria-label={group.label}>
                              <div className="px-4 py-2 bg-[var(--color-bg-secondary)] text-sm font-semibold text-[var(--color-text-secondary)]">
                                {group.label}
                              </div>
                              <ul>
                                {groupOptions.map((option) => (
                                  <li key={option.manual.id}>
                                    <button
                                      type="button"
                                      role="option"
                                      id={`${id}-option-${option.manual.id}`}
                                      data-manual-id={option.manual.id}
                                      aria-selected={selectedId === option.manual.id}
                                      onClick={() => handleSelectOption(option.manual.id)}
                                      className={`w-full text-left px-4 py-3 min-h-[44px] text-base font-medium transition-colors ${
                                        selectedId === option.manual.id
                                          ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-l-4 border-[var(--color-primary)]"
                                          : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] border-l-4 border-transparent"
                                      }`}
                                    >
                                      {option.label || "제목 없음"}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* 선택된 매뉴얼 정보 */}
              {!loading && !selectedManual && options.length > 0 && <p role="status" className="text-sm text-[var(--color-text-secondary)]">아직 선택한 매뉴얼이 없습니다.</p>}
              {selectedManual && (
                <div className="flex min-w-0 flex-col gap-4 border-l-4 border-[var(--color-primary)] pl-4 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-secondary)]">
                      {isStoreManual ? `${storeName || "선택 매장"} · 매장 전용` : "본사 · 공용"}
                    </p>
                    <p className="mt-2 wrap-break-word font-semibold text-base text-[var(--color-text-primary)]">{selectedOption?.title}</p>
                  </div>
                  {isStoreManual && (
                    <Link
                      href={buildQuestionManualEditUrl(storeId, questionId, selectedManual.id)}
                      className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-3 text-base font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                    >
                      <Pencil size={18} aria-hidden="true" />
                      <span>매뉴얼 편집</span>
                    </Link>
                  )}
                  <button type="button" aria-label="매뉴얼 선택 초기화" onClick={() => setSelectedId("")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--color-border)]"><X size={16} aria-hidden="true" /></button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={loading} onClick={() => { setLoading(true); setReload((value) => value + 1); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 text-sm text-[var(--color-primary)]">
            <RefreshCw size={16} aria-hidden="true" />답변과 매뉴얼 다시 불러오기
          </button>
          <Link href={buildQuestionManualEditUrl(storeId, questionId)} className="inline-flex min-h-11 items-center rounded-lg border border-[var(--color-border)] px-3 text-sm text-[var(--color-primary)]">전체 매장 매뉴얼</Link>
          <Link href="/boss/manuals" className="inline-flex min-h-11 items-center rounded-lg border border-[var(--color-border)] px-3 text-sm text-[var(--color-primary)]">본사 매뉴얼 확인</Link>
        </div>
      </section>

      {/* 2단계: 질문 처리 안내 */}
      <section aria-label="2단계: 질문 처리 안내" className="min-w-0">
        <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">2단계: 질문 처리 안내</h2>

        <button type="button" disabled={copying} onClick={() => void copyQuestion()} className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 text-sm text-[var(--color-primary)]">
          <Copy size={16} aria-hidden="true" />질문 원문 복사
        </button>
        {copyNotice && <p role="status" className="mb-4 text-sm text-[var(--color-text-secondary)]">{copyNotice}</p>}
        <div className="space-y-3">
          {/* 기존 AI 답변 확인 아코디언 */}
          <div className="border-2 border-[var(--color-border)] rounded-lg overflow-hidden">
            <button
              type="button"
              aria-expanded={expandedAccordion === "context"}
              aria-controls={`${id}-context`}
              onClick={() => toggleAccordion("context")}
              className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-3 text-left text-base font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] transition-colors"
            >
              기존 AI 답변 확인
              <ChevronDown
                size={20}
                className={`shrink-0 transition-transform ${expandedAccordion === "context" ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            {expandedAccordion === "context" && (
              <div id={`${id}-context`} className="space-y-4 border-t-2 border-[var(--color-border)] px-4 py-4 bg-[var(--color-bg-secondary)]">
                {loading && <p role="status" className="text-base text-[var(--color-text-secondary)]">기존 답변을 불러오는 중...</p>}
                {!loading && context && <>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">당시 답변</h3>
                    <p className="text-base leading-7 text-[var(--color-text-primary)] whitespace-pre-wrap">{context.answer || "저장된 답변이 없습니다."}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">기록된 근거 후보</h3>
                    {context.source ? <>
                      <p className="text-sm font-semibold text-[var(--color-text-primary)]">{context.source.category} · {context.source.title}</p>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{context.source.editable ? "매장 전용" : "본사 공통 · 읽기 전용"}</p>
                      <p className="mt-2 text-base leading-7 text-[var(--color-text-primary)] whitespace-pre-wrap">{context.source.content}</p>
                      {!context.source.editable && <p className="mt-2 text-sm text-amber-700 font-medium">본사 매뉴얼은 점주가 수정할 수 없습니다. 내용이 부족하면 본사 확인이 필요합니다.</p>}
                      <p className="mt-3 text-sm text-[var(--color-text-secondary)]">근거 후보는 현재 본문이며 당시 전체 검색 근거는 저장되지 않았습니다. 질문과 맞는지 직접 확인해 주세요.</p>
                      {context.source.editable && !manualsError && options.some((option) => option.manual.id === context.source?.id) && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(context.source!.id);
                            document.getElementById(`${id}-manual`)?.focus();
                          }}
                          className="mt-3 min-h-11 rounded-lg border border-[var(--color-border)] px-3 text-sm font-medium text-[var(--color-primary)]"
                        >
                          이 근거 매뉴얼 선택
                        </button>
                      )}
                    </> : <p className="text-base text-[var(--color-text-secondary)]">{context.sourceState === "none" ? "기록된 근거가 없습니다." : "근거가 삭제되었습니다."}</p>}
                  </div>
                </>}
              </div>
            )}
          </div>

          {/* 직원 재질문 안내 아코디언 */}
          <div className="border-2 border-[var(--color-border)] rounded-lg overflow-hidden">
            <button
              type="button"
              aria-expanded={expandedAccordion === "verification"}
              aria-controls={`${id}-verification`}
              onClick={() => toggleAccordion("verification")}
              className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-3 text-left text-base font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] transition-colors"
            >
              직원 재질문 안내
              <ChevronDown
                size={20}
                className={`shrink-0 transition-transform ${expandedAccordion === "verification" ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            {expandedAccordion === "verification" && (
              <div id={`${id}-verification`} className="space-y-3 border-t-2 border-[var(--color-border)] px-4 py-4 bg-[var(--color-bg-secondary)]">
                <p className="text-base leading-7 text-[var(--color-text-primary)]">해당 매장의 승인된 직원이 챗봇에 질문 원문을 직접 입력하고 답변과 근거를 확인합니다. 이 버튼은 재질문을 실행하지 않습니다.</p>
                <p className="text-base leading-7 text-[var(--color-text-primary)]">매뉴얼을 수정했다면 본문 저장과 검색 반영 결과를 먼저 확인해 주세요.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 처리 도움말 */}
      <section aria-label="처리 도움말" className="min-w-0">
        <div className="border-2 border-[var(--color-border)] rounded-lg overflow-hidden">
          <button
            type="button"
            aria-expanded={expandedAccordion === "help"}
            aria-controls={`${id}-help`}
            onClick={() => toggleAccordion("help")}
            className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-3 text-left text-base font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] transition-colors"
          >
            처리 도움말
            <ChevronDown
              size={20}
              className={`shrink-0 transition-transform ${expandedAccordion === "help" ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
          {expandedAccordion === "help" && (
            <div id={`${id}-help`} className="space-y-3 border-t-2 border-[var(--color-border)] px-4 py-4 bg-[var(--color-bg-secondary)]">
              <p className="text-base leading-7 text-[var(--color-text-primary)]">답이 이미 매뉴얼에 있다면 본문을 바꾸지 말고 검색 문제로 확인해 주세요.</p>
              <p className="text-base leading-7 text-[var(--color-text-primary)]">본문 저장과 검색 반영은 별개입니다. 매뉴얼 화면에서 최신 내용을 확인해 주세요.</p>
              <p className="text-base leading-7 text-[var(--color-text-primary)]">매뉴얼 수정 없이 직원 안내나 개별 대응으로 처리할 수 있습니다.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
