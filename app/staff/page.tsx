"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, Bot, Clock3, FileText, MoreHorizontal, Paperclip, Send, Store, UserRound } from "lucide-react";
import type { RagSource, RagStatus } from "../../lib/rag/types";

type Message = {
  from: "ai" | "me";
  text: string;
  time: string;
  status?: RagStatus;
  source?: Partial<Pick<RagSource, "title" | "category">>;
  similarity?: number;
};

const statusBadgeConfig = {
  answered: { label: "매뉴얼 기반 답변", className: "bg-[#e0efe1] text-[#2e765c]" },
  cautious: { label: "확인 권장", className: "bg-[#fbeecd] text-[#8b6745]" },
  insufficient: { label: "관리자 확인 필요", className: "bg-[#fbe0da] text-[#c7664d]" },
} as const;
const quickQuestions = ["오늘 마감 순서 알려줘", "재고 확인은 어떻게 해?", "지각하면 누구에게 말해?"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRagStatus(value: unknown): value is RagStatus {
  return value === "answered" || value === "cautious" || value === "insufficient";
}

function normalizeSource(value: unknown): Message["source"] {
  if (!isRecord(value)) return undefined;
  const title = typeof value.title === "string" ? value.title : undefined;
  const category = typeof value.category === "string" ? value.category : undefined;
  return title || category ? { title, category } : undefined;
}

export default function StaffPage() {
  const [messages, setMessages] = useState<Message[]>([
    { from: "ai", text: "안녕하세요, 민지님!\n오늘도 일잇다와 함께 차근차근 시작해볼까요?", time: "오후 1:58" },
    { from: "ai", text: "매장 업무에 대해 궁금한 점을 물어보세요.\n제가 등록된 매장 가이드를 바탕으로 답해드릴게요.", time: "오후 1:58" },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const question = input.trim();
    if (!question || isLoading) return;
    setInput("");
    setErrorMessage("");
    setMessages(current => [...current, { from: "me", text: question, time: "방금 전" }]);
    setIsLoading(true);
    try {
      const response = await fetch("/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const result: unknown = await response.json();
      const payload = isRecord(result) ? result : {};
      const answer = typeof payload.answer === "string" ? payload.answer.trim() : "";
      const error = typeof payload.error === "string" ? payload.error : "답변을 받지 못했어요.";
      if (!response.ok || !answer) throw new Error(error);

      const message: Message = { from: "ai", text: answer, time: "방금 전" };
      if (isRagStatus(payload.status)) message.status = payload.status;
      const source = normalizeSource(payload.source);
      if (source) message.source = source;
      if (typeof payload.similarity === "number" && Number.isFinite(payload.similarity)) {
        message.similarity = payload.similarity;
      }
      setMessages(current => [...current, message]);
    } catch {
      // 기술적인 에러 메시지 대신 사용자 관점의 안내 문구만 노출합니다.
      setErrorMessage("답변을 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  function dismissError() {
    setErrorMessage("");
  }

  return <div className="chat-shell min-h-screen bg-[#f5f7f2] md:flex md:items-center md:justify-center md:p-8"><main className="mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden bg-[#fffdf9] shadow-[0_20px_70px_rgba(40,61,48,0.12)] md:h-[min(820px,calc(100vh-64px))] md:rounded-[2rem]"><header className="flex h-[78px] shrink-0 items-center justify-between border-b border-[#edf0e9] bg-white px-5"><Link href="/" className="flex h-9 w-9 items-center justify-center rounded-full text-[#608277] hover:bg-[#f0f5ee]"><ArrowLeft size={19} /></Link><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e0efe1] text-[#2e765c]"><Bot size={18} /></span><div><p className="text-sm font-bold text-[#29483b]">일잇다 AI</p><p className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-[#7e9b8d]"><span className="h-1.5 w-1.5 rounded-full bg-[#5bb47d]" /> 온라인</p></div></div><button className="flex h-9 w-9 items-center justify-center rounded-full text-[#8da099]"><MoreHorizontal size={19} /></button></header><div className="flex items-center gap-3 border-b border-[#f0f1eb] bg-[#fafbf7] px-5 py-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0dfcb] text-[#8b6745]"><Store size={15} /></span><div className="flex-1"><p className="text-xs font-bold text-[#496658]">MOONLIGHT COFFEE · 성수점</p><p className="mt-0.5 text-[10px] text-[#99a9a1]">매장 가이드 12개 연결됨</p></div><FileText size={16} className="text-[#9bb0a4]" /></div><div className="flex-1 space-y-4 overflow-y-auto px-4 py-5"><div className="flex justify-center"><span className="flex items-center gap-1.5 rounded-full bg-[#f1f3ed] px-3 py-1 text-[10px] font-semibold text-[#9aa9a1]"><Clock3 size={12} /> 오늘</span></div>{messages.map((message, index) => <MessageBubble key={`${message.time}-${index}`} message={message} />)}{isLoading && <TypingIndicator />}{errorMessage && <div role="alert" className="flex items-start gap-2 rounded-xl border border-[#f3c9bc] bg-[#fdeeea] px-3.5 py-2.5 text-[#a8452f]"><span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#f3c9bc] text-[9px] font-bold text-[#a8452f]">!</span><div className="flex-1"><p className="text-[11px] font-semibold leading-5">{errorMessage}</p><button type="button" onClick={dismissError} className="mt-1 text-[11px] font-bold text-[#a8452f] underline underline-offset-2">닫기</button></div></div>}</div><div className="shrink-0 border-t border-[#edf0e9] bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"><div className="mb-3 flex gap-2 overflow-x-auto">{quickQuestions.map(question => <button key={question} type="button" disabled={isLoading} onClick={() => setInput(question)} className="shrink-0 whitespace-nowrap rounded-full border border-[#dce7dc] bg-[#fafcf8] px-3.5 py-2.5 text-[11px] font-semibold text-[#668376] disabled:cursor-not-allowed disabled:border-[#e7ebe4] disabled:bg-[#f1f3ed] disabled:text-[#a9b4ae] disabled:opacity-70">{question}</button>)}</div><form onSubmit={sendMessage} className="flex items-center gap-2 rounded-2xl bg-[#f3f6f0] px-3 py-2"><button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center text-[#92a59c]"><Paperclip size={18} /></button><input value={input} disabled={isLoading} onChange={event => setInput(event.target.value)} placeholder={isLoading ? "답변을 기다리는 중이에요…" : "메시지를 입력하세요"} className="min-w-0 flex-1 bg-transparent py-2 text-[15px] text-[#345246] outline-none placeholder:text-[#a5b1aa] disabled:cursor-not-allowed disabled:opacity-60" /><button type="submit" disabled={isLoading || !input.trim()} aria-label="메시지 보내기" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1c6b52] text-white transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"><Send size={16} /></button></form></div></main></div>;
}

function MessageBubble({ message }: { message: Message }) {
  const badge = message.from === "ai" && message.status ? statusBadgeConfig[message.status] : null;
  const hasSource = message.from === "ai" && (message.source?.title || message.source?.category || typeof message.similarity === "number");
  const similarityPercent = typeof message.similarity === "number" ? Math.min(100, Math.max(0, Math.round(message.similarity * 100))) : null;
  return <div className={`flex items-end gap-2 ${message.from === "me" ? "justify-end" : "justify-start"}`}>{message.from === "ai" && <span className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#e0efe1] text-[#2e765c]"><Bot size={14} /></span>}<div className={`max-w-[85%] ${message.from === "me" ? "items-end" : "items-start"} flex flex-col`}>{badge && <span className={`mb-1 w-fit rounded-full px-2 py-0.5 text-[9px] font-medium opacity-90 ${badge.className}`}>{badge.label}</span>}<div className={`whitespace-pre-line break-words rounded-2xl px-4 py-3 text-[14px] leading-6 ${message.from === "me" ? "rounded-br-sm bg-[#1c6b52] text-white" : "rounded-bl-sm bg-[#f0f4ed] text-[#3c5a4d]"}`}>{message.text}</div>{hasSource && <div className="mt-1.5 w-fit max-w-full rounded-lg bg-[#f2f5ee] px-2.5 py-1.5 text-[10px] font-normal text-[#96a69c]"><p className="font-medium text-[#7e9b8d]">근거 매뉴얼</p>{(message.source?.title || message.source?.category) && <p className="mt-0.5 truncate">{[message.source?.title, message.source?.category].filter(Boolean).join(" · ")}</p>}{similarityPercent !== null && <p className="mt-0.5">관련도 {similarityPercent}%</p>}</div>}<span className="mt-1 px-1 text-[9px] text-[#a0ada6]">{message.time}</span></div>{message.from === "me" && <span className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f1dfce] text-[#a16e45]"><UserRound size={14} /></span>}</div>
}
function TypingIndicator() { return <div className="flex justify-start"><span className="mb-1 mr-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#e0efe1] text-[#2e765c]"><Bot size={14} /></span><div role="status" aria-label="AI가 답변을 작성 중" className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-[#f0f4ed] px-3.5 py-2.5"><span className="flex gap-1"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#83a394]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#83a394] [animation-delay:120ms]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#83a394] [animation-delay:240ms]" /></span><span className="text-[11px] font-semibold text-[#7e9b8d]">매뉴얼을 확인하고 있어요</span></div></div> }
