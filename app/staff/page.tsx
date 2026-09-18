"use client";

import { FormEvent, startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot, Clock3, FileText, MoreHorizontal, Paperclip, Send, Store, UserRound } from "lucide-react";

import { DEMO_STORES, findDemoStore, type DemoStore } from "@/lib/data/demoStores";
import type { RagSource, RagStatus } from "@/lib/rag/types";
import { createClient } from "@/lib/supabase/client";

type Message = {
  from: "ai" | "me";
  text: string;
  time: string;
  status?: RagStatus;
  source?: Partial<Pick<RagSource, "title" | "category">>;
  similarity?: number;
};

const statusBadgeConfig = {
  answered: { label: "매뉴얼 기반 답변", className: "border border-[#a9e0cf] bg-[#edf9f4] text-[#0d5d4d]" },
  cautious: { label: "확인 권장", className: "border border-[#f0d48f] bg-[#fff5d4] text-[#7a5a18]" },
  insufficient: { label: "관리자 확인 필요", className: "border border-[#f0b7af] bg-[#fdeae8] text-[#8d3c33]" },
} as const;
const quickQuestions = ["오늘 마감 순서 알려줘", "재고 확인은 어떻게 해?", "지각하면 누구에게 말해?"];
const SELECTED_STORE_STORAGE_KEY = "staffDemoStoreId";
const INITIAL_MESSAGES: Message[] = [
  { from: "ai", text: "안녕하세요, 민지님!\n오늘도 일잇다와 함께 차근차근 시작해볼까요?", time: "오후 1:58" },
  { from: "ai", text: "매장 업무에 대해 궁금한 점을 물어보세요.\n제가 등록된 매장 가이드를 바탕으로 답해드릴게요.", time: "오후 1:58" },
];

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
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedStore, setSelectedStore] = useState<DemoStore | null>(null);

  useEffect(() => {
    // PoC demo selection only. Real authorization must resolve the user's permitted store server-side.
    const storedStoreId = sessionStorage.getItem(SELECTED_STORE_STORAGE_KEY);
    if (!storedStoreId) return;

    const storedStore = findDemoStore(storedStoreId);
    if (!storedStore) {
      sessionStorage.removeItem(SELECTED_STORE_STORAGE_KEY);
      return;
    }

    startTransition(() => setSelectedStore(storedStore));
  }, []);

  function selectStore(storeId: string) {
    if (isLoading) return;

    const store = findDemoStore(storeId) ?? null;
    if (selectedStore?.id !== store?.id) {
      setMessages(INITIAL_MESSAGES);
      setInput("");
      setErrorMessage("");
    }
    setSelectedStore(store);

    if (store) {
      sessionStorage.setItem(SELECTED_STORE_STORAGE_KEY, store.id);
    } else {
      sessionStorage.removeItem(SELECTED_STORE_STORAGE_KEY);
    }
  }

  useEffect(() => {
    // Check Supabase session - redirect if needed
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        
        if (!data.session?.user) {
          router.push("/");
          return;
        }

        const role = data.session.user.user_metadata?.role;

        // Verify user is staff
        if (role !== "staff") {
          router.push("/");
          return;
        }
      } catch (e) {
        console.error("Auth check failed:", e);
        router.push("/");
      }
    };

    checkAuth();
  }, [router]);

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
    } catch (e) {
      console.error("Logout failed:", e);
      router.push("/");
    }
  };

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const question = input.trim();
    if (!question || isLoading) return;
    if (!selectedStore) {
      setErrorMessage("먼저 근무 매장을 선택해 주세요.");
      return;
    }
    setInput("");
    setErrorMessage("");
    setMessages(current => [...current, { from: "me", text: question, time: "방금 전" }]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, storeId: selectedStore.id }),
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
      setErrorMessage("답변을 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  function dismissError() {
    setErrorMessage("");
  }

  return (
    <div className="chat-shell min-h-screen bg-[#f3f7f6] md:flex md:items-center md:justify-center md:p-8">
      <main className="mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden bg-[#fffdfb] shadow-[0_24px_80px_rgba(28,50,65,0.12)] md:h-[min(820px,calc(100vh-64px))] md:max-w-[440px] md:rounded-[2rem]">
        <header className="flex h-[78px] shrink-0 items-center justify-between border-b border-[#edf2ef] bg-white px-5">
          <button onClick={() => router.back()} aria-label="뒤로가기" className="flex h-11 w-11 items-center justify-center rounded-full text-[#1C3241] transition-colors hover:bg-[#edf5f3]">
            <ArrowLeft size={19} />
          </button>

          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EAF7F3] text-[#0C9D81]"><Bot size={18} /></span>
            <div>
              <p className="text-sm font-bold text-[#1C3241]">일잇다 AI</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#59707a]">
                <span className="h-2 w-2 rounded-full bg-[#1FB58B]" /> 온라인
              </p>
            </div>
          </div>

          <button onClick={handleLogout} aria-label="로그아웃" className="flex h-11 w-11 items-center justify-center rounded-full text-[#5a6e78] transition-colors hover:bg-[#edf5f3]">
            <MoreHorizontal size={19} />
          </button>
        </header>

        <div className="flex items-center gap-3 border-b border-[#eef2f0] bg-[#f7faf9] px-5 py-3.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e7f5f0] text-[#0C9D81]"><Store size={15} /></span>
          <div className="min-w-0 flex-1">
            <label htmlFor="staff-store" className="block text-[11px] font-semibold text-[#59707a]">근무 매장</label>
            <select
              id="staff-store"
              value={selectedStore?.id ?? ""}
              disabled={isLoading}
              onChange={(event) => selectStore(event.target.value)}
              className="mt-0.5 w-full bg-transparent text-[12px] font-bold text-[#1C3241] outline-none disabled:cursor-not-allowed disabled:opacity-70"
            >
              <option value="">매장을 선택해 주세요</option>
              {DEMO_STORES.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
            <p className="mt-0.5 truncate text-[11px] text-[#697B87]">
              {selectedStore ? `M Coffee · ${selectedStore.name}` : "선택 후 매장 매뉴얼을 검색합니다"}
            </p>
          </div>
          <FileText size={16} className="text-[#697B87]" />
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
          <div className="flex justify-center">
            <span className="flex items-center gap-1.5 rounded-full bg-[#edf5f3] px-3 py-1.5 text-[11px] font-semibold text-[#52676e]">
              <Clock3 size={12} /> 오늘
            </span>
          </div>

          {messages.map((message, index) => <MessageBubble key={`${message.time}-${index}`} message={message} />)}

          {isLoading && <TypingIndicator />}

          {errorMessage && (
            <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-[#f0c7bf] bg-[#fff0ee] px-3.5 py-3 text-[#7d403a] shadow-sm">
              <span className="mt-0.5 flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full bg-[#f3d0ca] text-[10px] font-bold text-[#7d403a]">!</span>
              <div className="flex-1">
                <p className="text-[12px] font-semibold leading-5 text-[#4a5862]">{errorMessage}</p>
                <button
                  type="button"
                  onClick={dismissError}
                  className="mt-2 inline-flex items-center justify-center rounded-xl border border-[#0C9D81] bg-[#0C9D81] px-3 py-2 text-[12px] font-bold text-white shadow-sm transition-colors hover:bg-[#0a8e76] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0C9D81] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fff0ee]"
                >
                  닫기
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[#edf2ef] bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {quickQuestions.map(question => (
              <button
                key={question}
                type="button"
                aria-label={`질문 예시: ${question}`}
                disabled={isLoading}
                onClick={() => setInput(question)}
                className="shrink-0 whitespace-nowrap rounded-full border border-[#d7e8e4] bg-[#f6faf8] px-3 py-2 text-[12px] font-semibold text-[#1C3241] shadow-sm transition-colors disabled:cursor-not-allowed disabled:border-[#edf2ef] disabled:bg-[#f5f7f6] disabled:text-[#9aa8ad] disabled:opacity-75"
              >
                {question}
              </button>
            ))}
          </div>

          <form onSubmit={sendMessage} className="flex items-center gap-2 rounded-2xl border border-[#e5edea] bg-[#f6faf8] px-3 py-2 shadow-inner">
            <button type="button" aria-label="파일 첨부" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[#59707a] transition-colors hover:bg-[#edf5f3]">
              <Paperclip size={18} />
            </button>

            <input
              value={input}
              disabled={isLoading}
              onChange={event => setInput(event.target.value)}
              placeholder={isLoading ? "답변을 기다리는 중이에요…" : "질문을 입력하세요"}
              aria-label="질문 입력창"
              className="min-w-0 flex-1 bg-transparent py-2 text-[15px] text-[#1C3241] outline-none placeholder:text-[#778a93] disabled:cursor-not-allowed disabled:opacity-70"
            />

            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              aria-label="메시지 보내기"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0C9D81] text-white shadow-[0_8px_16px_rgba(12,157,129,0.18)] transition-colors hover:bg-[#0a8e76] disabled:cursor-not-allowed disabled:bg-[#a6cfc3] disabled:shadow-none"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const badge = message.from === "ai" && message.status ? statusBadgeConfig[message.status] : null;
  const hasSource = message.from === "ai" && (message.source?.title || message.source?.category || typeof message.similarity === "number");
  const similarityPercent = typeof message.similarity === "number" ? Math.min(100, Math.max(0, Math.round(message.similarity * 100))) : null;

  return (
    <div className={`flex items-end gap-2 ${message.from === "me" ? "justify-end" : "justify-start"}`}>
      {message.from === "ai" && (
        <span className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EAF7F3] text-[#0C9D81]">
          <Bot size={14} />
        </span>
      )}

      <div className={`max-w-[85%] ${message.from === "me" ? "items-end" : "items-start"} flex flex-col`}>
        {badge && (
          <span className={`mb-1.5 w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge.className}`}>
            {badge.label}
          </span>
        )}

        <div
          className={`whitespace-pre-line break-words rounded-2xl px-4 py-3 text-[15px] leading-6 ${
            message.from === "me"
              ? "rounded-br-sm bg-[#0C9D81] text-white shadow-sm"
              : "rounded-bl-sm bg-[#f0f5f3] text-[#1C3241]"
          }`}
        >
          {message.text}
        </div>

        {hasSource && (
          <div className="mt-2 w-fit max-w-full rounded-xl border border-[#e7efec] bg-[#f7faf9] px-2.5 py-2 text-[11px] text-[#5d727d]">
            <p className="font-bold text-[#1C3241]">근거 매뉴얼</p>
            {(message.source?.title || message.source?.category) && (
              <p className="mt-1 truncate text-[12px] font-semibold text-[#2a4650]">
                {[message.source?.title, message.source?.category].filter(Boolean).join(" · ")}
              </p>
            )}
            {similarityPercent !== null && <p className="mt-1 text-[11px] text-[#59707a]">관련도 {similarityPercent}%</p>}
          </div>
        )}

        <span className="mt-1.5 px-1 text-[10px] text-[#697B87]">{message.time}</span>
      </div>

      {message.from === "me" && (
        <span className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e9f3ef] text-[#0C9D81]">
          <UserRound size={14} />
        </span>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <span className="mb-1 mr-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#EAF7F3] text-[#0C9D81]">
        <Bot size={14} />
      </span>
      <div role="status" aria-label="AI가 답변을 작성 중" className="flex items-center gap-3 rounded-2xl rounded-bl-sm bg-[#f0f5f3] px-3.5 py-2.5">
        <span className="flex gap-1.5">
          <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#0C9D81]" />
          <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#0C9D81] [animation-delay:120ms]" />
          <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#0C9D81] [animation-delay:240ms]" />
        </span>
        <span className="text-[12px] font-semibold text-[#1C3241]">매뉴얼을 확인하고 있어요</span>
      </div>
    </div>
  );
}
