"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronDown, Copy, FileText, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/common/Button";
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
  const [notice, setNotice] = useState("");
  const [manualsError, setManualsError] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showVerification, setShowVerification] = useState(false);
  const id = useId();
  const manualGroups = buildManualSelectionGroups(manuals, storeId);
  const options = manualGroups.flatMap((group) => group.options);
  const selectedOption = options.find((option) => option.manual.id === selectedId);
  const selectedManual = selectedOption?.manual;

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

  const copyQuestion = async () => {
    if (copying) return;
    setCopying(true);
    try { await navigator.clipboard.writeText(question); setNotice("질문 원문을 복사했습니다."); }
    catch { setNotice("복사하지 못했습니다. 질문 원문을 직접 선택해 주세요."); }
    finally { setCopying(false); }
  };

  return (
    <section aria-label="관련 매뉴얼 확인·수정" className="min-w-0 space-y-5 py-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold"><BookOpen size={20} className="shrink-0 text-(--color-primary)" aria-hidden="true" />관련 매뉴얼 확인·수정</h2>
        <Button variant="ghost" size="md" disabled={loading} title="답변과 매뉴얼 다시 불러오기" aria-label="답변과 매뉴얼 다시 불러오기" onClick={() => { setLoading(true); setReload((value) => value + 1); }} className="shrink-0 px-2">
          <RefreshCw size={18} className={loading ? "animate-spin" : ""} aria-hidden="true" />
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="space-y-3">
        <label htmlFor={`${id}-manual`} className="block text-sm font-medium">수정할 매장 매뉴얼을 선택하세요</label>
        {manualsError && <p role="alert" className="text-sm text-red-700">{manualsError}</p>}
        {loading && <p role="status" className="text-sm text-(--color-text-secondary)">답변과 매장 매뉴얼을 불러오는 중...</p>}
        {!loading && !manualsError && options.length === 0 && <p role="status" className="text-sm text-(--color-text-secondary)">수정할 매장 매뉴얼이 없습니다. 전체 매장 매뉴얼에서 내용을 확인하거나 추가할 수 있습니다.</p>}
        <select id={`${id}-manual`} value={selectedId} disabled={loading || !!manualsError || options.length === 0} onChange={(event) => setSelectedId(event.target.value)} className="w-full min-w-0 rounded-md border border-(--color-border) bg-(--color-bg-default) p-3 text-sm text-(--color-text-primary) focus-visible:outline-2 focus-visible:outline-(--color-primary) disabled:opacity-60">
          <option value="">매장 매뉴얼 선택</option>
          {manualGroups.map((group) => <optgroup key={group.id} label={group.label}>
            {group.options.map((option) => <option key={option.manual.id} value={option.manual.id}>{option.label}</option>)}
          </optgroup>)}
        </select>
        {!loading && selectedManual && <div className="flex min-w-0 flex-col gap-3 border-l-2 border-(--color-primary) pl-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><p className="text-xs text-(--color-text-secondary)">{storeName || "선택 매장"} · 매장 전용</p><p className="mt-1 wrap-break-word font-semibold">{selectedOption?.title}</p><p className="mt-1 wrap-break-word text-sm text-(--color-text-secondary)">{selectedManual.category}{selectedOption?.parentTitle ? ` · ${selectedOption.parentTitle}` : ""}</p></div>
          <Link href={buildQuestionManualEditUrl(storeId, questionId, selectedManual.id)} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-(--color-primary) px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"><Pencil size={16} aria-hidden="true" />매뉴얼 편집</Link>
        </div>}
        {!loading && !manualsError && options.length > 0 && !selectedManual && <p className="text-sm text-(--color-text-secondary)">아직 선택한 매뉴얼이 없습니다.</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href={buildQuestionManualEditUrl(storeId, questionId)} className="inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-md border border-(--color-border) px-3 py-2 text-sm font-semibold text-(--color-primary) hover:bg-(--color-primary-light) focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary-accent)"><FileText size={16} className="shrink-0" aria-hidden="true" />전체 매장 매뉴얼</Link>
          <Link href="/boss/manuals" className="inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-md border border-(--color-border) px-3 py-2 text-sm font-semibold text-(--color-primary) hover:bg-(--color-primary-light) focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary-accent)"><BookOpen size={16} className="shrink-0" aria-hidden="true" />본사 매뉴얼 확인</Link>
        </div>
      </div>
      <div className="border-y border-(--color-border)">
        <button type="button" aria-expanded={showContext} aria-controls={`${id}-context`} onClick={() => setShowContext((value) => !value)} className="flex min-h-12 w-full items-center justify-between gap-3 py-3 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-(--color-primary)">
          기존 챗봇 답변과 근거 후보<ChevronDown size={18} className={`shrink-0 transition-transform ${showContext ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        <div id={`${id}-context`} hidden={!showContext} className="space-y-4 pb-4">
          {loading && <p role="status" className="text-sm">기존 답변을 불러오는 중...</p>}
          {!loading && context && <>
            <div><h3 className="text-sm font-semibold">당시 답변</h3><p className="mt-2 whitespace-pre-wrap wrap-break-word text-sm">{context.answer || "저장된 답변이 없습니다."}</p></div>
            <div><h3 className="text-sm font-semibold">기록된 근거 후보</h3>
              {context.source ? <>
                <p className="mt-2 wrap-break-word text-sm font-semibold">{context.source.category} · {context.source.title}</p>
                <p className="mt-1 text-xs text-(--color-text-secondary)">{context.source.editable ? "매장 전용" : "본사 공통 · 읽기 전용"}</p>
                <p className="mt-2 whitespace-pre-wrap wrap-break-word text-sm">{context.source.content}</p>
                {!context.source.editable && <p className="mt-2 text-sm text-amber-800">본사 매뉴얼은 점주가 수정할 수 없습니다. 내용이 부족하면 본사 확인이 필요합니다.</p>}
                {context.source.editable && !manualsError && options.some((option) => option.manual.id === context.source?.id) && <Button variant="outline" size="sm" className="mt-3" onClick={() => { setSelectedId(context.source!.id); document.getElementById(`${id}-manual`)?.focus(); }}>이 근거 매뉴얼 선택</Button>}
              </> : <p className="mt-2 text-sm">{context.sourceState === "none" ? "기록된 근거가 없습니다." : "근거가 삭제되었거나 조회 범위를 확인할 수 없습니다."}</p>}
              <p className="mt-3 text-xs leading-5 text-(--color-text-secondary)">근거 후보는 현재 본문이며 당시 전체 검색 근거는 저장되지 않았습니다. 질문과 맞는지 직접 확인해 주세요.</p>
            </div>
          </>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" disabled={copying} onClick={() => void copyQuestion()} className="gap-2"><Copy size={16} aria-hidden="true" />질문 원문 복사</Button>
        <Button variant="ghost" size="sm" aria-expanded={showVerification} aria-controls={`${id}-verification`} onClick={() => setShowVerification((value) => !value)} className="gap-2">직원 재질문 안내<ChevronDown size={16} aria-hidden="true" /></Button>
      </div>
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <p id={`${id}-verification`} hidden={!showVerification} className="text-sm leading-6 text-(--color-text-secondary)">해당 매장의 승인된 직원이 챗봇에 질문 원문을 직접 입력하고 답변과 근거를 확인해 주세요. 이 버튼은 재질문을 실행하지 않습니다. 매뉴얼을 수정했다면 본문 저장과 검색 반영 결과를 먼저 확인해 주세요.</p>
      <div>
        <button type="button" aria-expanded={showHelp} aria-controls={`${id}-help`} onClick={() => setShowHelp((value) => !value)} className="inline-flex min-h-10 items-center gap-2 text-sm text-(--color-text-secondary) focus-visible:outline-2 focus-visible:outline-(--color-primary)">처리 도움말<ChevronDown size={16} className={showHelp ? "rotate-180" : ""} aria-hidden="true" /></button>
        <div id={`${id}-help`} hidden={!showHelp} className="space-y-2 pt-2 text-sm leading-6 text-(--color-text-secondary)">
          <p>답이 이미 매뉴얼에 있다면 본문을 바꾸지 말고 검색 문제로 확인해 주세요. 반복 질문은 직원 안내가 필요한 경우도 있습니다.</p>
          <p>본문 저장과 검색 반영은 별개입니다. 실패하거나 결과가 미확인이라면 매뉴얼 화면에서 최신 내용과 검색 준비 상태를 확인해 주세요.</p>
          <p>매뉴얼 수정 없이 직원 안내나 개별 대응으로 처리할 수 있습니다. 매뉴얼 저장만으로 질문이 자동 완료되지는 않습니다.</p>
        </div>
      </div>
    </section>
  );
}