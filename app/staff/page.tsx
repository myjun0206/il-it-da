"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, Bot, Clock3, FileText, MoreHorizontal, Paperclip, Send, Store, UserRound } from "lucide-react";

type Message = { from: "ai" | "me"; text: string; time: string };
const quickQuestions = ["오늘 마감 순서 알려줘", "재고 확인은 어떻게 해?", "지각하면 누구에게 말해?"];

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
      const result = (await response.json()) as { answer?: string; error?: string };
      if (!response.ok || !result.answer) throw new Error(result.error || "답변을 받지 못했어요.");
      setMessages(current => [...current, { from: "ai", text: result.answer as string, time: "방금 전" }]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "잠시 후 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  return <div className="chat-shell min-h-screen bg-[#f5f7f2] md:flex md:items-center md:justify-center md:p-8"><main className="mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden bg-[#fffdf9] shadow-[0_20px_70px_rgba(40,61,48,0.12)] md:h-[min(820px,calc(100vh-64px))] md:rounded-[2rem]"><header className="flex h-[78px] shrink-0 items-center justify-between border-b border-[#edf0e9] bg-white px-5"><Link href="/" className="flex h-9 w-9 items-center justify-center rounded-full text-[#608277] hover:bg-[#f0f5ee]"><ArrowLeft size={19} /></Link><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e0efe1] text-[#2e765c]"><Bot size={18} /></span><div><p className="text-sm font-bold text-[#29483b]">일잇다 AI</p><p className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-[#7e9b8d]"><span className="h-1.5 w-1.5 rounded-full bg-[#5bb47d]" /> 온라인</p></div></div><button className="flex h-9 w-9 items-center justify-center rounded-full text-[#8da099]"><MoreHorizontal size={19} /></button></header><div className="flex items-center gap-3 border-b border-[#f0f1eb] bg-[#fafbf7] px-5 py-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0dfcb] text-[#8b6745]"><Store size={15} /></span><div className="flex-1"><p className="text-xs font-bold text-[#496658]">MOONLIGHT COFFEE · 성수점</p><p className="mt-0.5 text-[10px] text-[#99a9a1]">매장 가이드 12개 연결됨</p></div><FileText size={16} className="text-[#9bb0a4]" /></div><div className="flex-1 space-y-5 overflow-y-auto px-5 py-6"><div className="flex justify-center"><span className="flex items-center gap-1.5 rounded-full bg-[#f1f3ed] px-3 py-1 text-[10px] font-semibold text-[#9aa9a1]"><Clock3 size={12} /> 오늘</span></div>{messages.map((message, index) => <MessageBubble key={`${message.time}-${index}`} message={message} />)}{isLoading && <TypingIndicator />}{errorMessage && <p role="alert" className="text-center text-xs font-semibold text-[#c7664d]">{errorMessage}</p>}</div><div className="border-t border-[#edf0e9] bg-white px-5 pb-5 pt-3"><div className="mb-3 flex gap-2 overflow-x-auto">{quickQuestions.map(question => <button key={question} type="button" disabled={isLoading} onClick={() => setInput(question)} className="whitespace-nowrap rounded-full border border-[#dce7dc] bg-[#fafcf8] px-3 py-2 text-[10px] font-semibold text-[#668376] disabled:opacity-50">{question}</button>)}</div><form onSubmit={sendMessage} className="flex items-center gap-2 rounded-2xl bg-[#f3f6f0] px-3 py-2"><button type="button" className="flex h-9 w-9 items-center justify-center text-[#92a59c]"><Paperclip size={17} /></button><input value={input} disabled={isLoading} onChange={event => setInput(event.target.value)} placeholder="메시지를 입력하세요" className="min-w-0 flex-1 bg-transparent text-sm text-[#345246] outline-none placeholder:text-[#a5b1aa] disabled:opacity-50" /><button type="submit" disabled={isLoading || !input.trim()} aria-label="메시지 보내기" className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1c6b52] text-white transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"><Send size={15} /></button></form></div></main></div>;
}

function MessageBubble({ message }: { message: Message }) { return <div className={`flex items-end gap-2 ${message.from === "me" ? "justify-end" : "justify-start"}`}>{message.from === "ai" && <span className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#e0efe1] text-[#2e765c]"><Bot size={14} /></span>}<div className={`max-w-[78%] ${message.from === "me" ? "items-end" : "items-start"} flex flex-col`}><div className={`whitespace-pre-line rounded-2xl px-4 py-3 text-[13px] leading-5 ${message.from === "me" ? "rounded-br-sm bg-[#1c6b52] text-white" : "rounded-bl-sm bg-[#f0f4ed] text-[#476458]"}`}>{message.text}</div><span className="mt-1 px-1 text-[9px] text-[#a0ada6]">{message.time}</span></div>{message.from === "me" && <span className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f1dfce] text-[#a16e45]"><UserRound size={14} /></span>}</div> }
function TypingIndicator() { return <div className="flex justify-start"><span className="mb-1 mr-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#e0efe1] text-[#2e765c]"><Bot size={14} /></span><div role="status" aria-label="AI가 답변을 작성 중" className="rounded-2xl rounded-bl-sm bg-[#f0f4ed] px-4 py-3"><span className="flex gap-1"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#83a394]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#83a394] [animation-delay:120ms]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#83a394] [animation-delay:240ms]" /></span></div></div> }
