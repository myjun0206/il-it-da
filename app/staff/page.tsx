"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Bot, CheckCircle2, ChevronRight, Clock3, Info, Paperclip, Send, Store, UserRound } from "lucide-react";

import StaffHeader from "@/components/staff/StaffHeader";
import StaffSidebar from "@/components/staff/StaffSidebar";
import type { RagSource, RagStatus } from "@/lib/rag/types";
import type { StaffStore } from "@/lib/staff/approved-stores";
import { createClient } from "@/lib/supabase/client";

type Message = {
  from: "ai" | "me";
  text: string;
  time: string;
  status?: RagStatus;
  source?: Partial<Pick<RagSource, "title" | "category">>;
  similarity?: number;
};

type StoreMembership = {
  storeId: string;
  storeName: string;
  role: string;
  status: string;
};

const statusBadgeConfig = {
  answered: { label: "매뉴얼 기반 답변", icon: CheckCircle2, className: "border border-[#7cd4b6] bg-[#e8f9f4] text-[#0d5d4d]" },
  cautious: { label: "확인 권장", icon: AlertCircle, className: "border border-[#f0c965] bg-[#fffaed] text-[#7a5a18]" },
  insufficient: { label: "관리자 확인 필요", icon: Info, className: "border border-[#e8a9a1] bg-[#fef2f0] text-[#8d3c33]" },
} as const;
const quickQuestions = [
  "오늘 마감 순서 알려줘",
  "음료 레시피가 궁금해요",
  "재고 확인은 어떻게 해?",
  "지각하면 누구에게 말하나요?",
  "POS 사용법을 알고 싶어요",
  "매장 청소 체크리스트 보여줘",
  "신규 알바가 꼭 알아야 할 내용은?",
];
const SELECTED_STORE_STORAGE_KEY = "staffSelectedStoreId";
const INITIAL_MESSAGES: Message[] = [
  { from: "ai", text: "안녕하세요!\n일잇다 AI입니다.\n매장 업무와 관련된 궁금한 점이 있다면 언제든 물어보세요.\n매뉴얼을 기반으로 정확하고 친절하게 답변해드릴게요.", time: "오후 1:58" },
  { from: "ai", text: "아래 예시 질문을 참고하거나,\n직접 궁금한 내용을 입력해보세요.", time: "오후 1:58" },
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
  const [userName, setUserName] = useState("직원");
  const [storeName, setStoreName] = useState("매장");
const [stores, setStores] = useState<StaffStore[]>([]);
const [selectedStore, setSelectedStore] = useState<StaffStore | null>(null);
const [isStoresLoading, setIsStoresLoading] = useState(true);
const [storesError, setStoresError] = useState("");
const [storesReloadToken, setStoresReloadToken] = useState(0);

function selectStore(storeId: string) {
  if (isLoading || isStoresLoading) return;

  const store = stores.find((candidate) => candidate.id === storeId) ?? null;

  if (selectedStore?.id !== store?.id) {
    setMessages(INITIAL_MESSAGES);
    setInput("");
    setErrorMessage("");
  }

  setSelectedStore(store);
  setStoreName(store?.name ?? "매장");

  if (store) {
    sessionStorage.setItem(SELECTED_STORE_STORAGE_KEY, store.id);
  } else {
    sessionStorage.removeItem(SELECTED_STORE_STORAGE_KEY);
  }
}

  useEffect(() => {
    const controller = new AbortController();

    async function loadApprovedStores() {
      setIsStoresLoading(true);
      setStoresError("");

      try {
        const response = await fetch("/api/staff/stores", { signal: controller.signal });
        if (response.status === 401) {
          router.push("/");
          return;
        }

        const payload = (await response.json()) as { stores?: StaffStore[]; error?: string };
        if (!response.ok || !Array.isArray(payload.stores)) {
          throw new Error("Unable to load approved stores.");
        }

        if (controller.signal.aborted) return;

        const availableStores = payload.stores;
        const storedStoreId = sessionStorage.getItem(SELECTED_STORE_STORAGE_KEY);
        const restoredStore =
          availableStores.find((store) => store.id === storedStoreId) ?? null;

        if (restoredStore) {
          setSelectedStore(restoredStore);
          setStoreName(restoredStore.name);
        } else if (availableStores.length === 1) {
          setSelectedStore(availableStores[0]);
          setStoreName(availableStores[0].name);
        } else {
          setSelectedStore(null);
          setStoreName("매장");
        }
        if (!restoredStore && storedStoreId) {
          sessionStorage.removeItem(SELECTED_STORE_STORAGE_KEY);
        }
      } catch {
        if (controller.signal.aborted) return;
        setStores([]);
        setSelectedStore(null);
        setStoreName("매장");
        setStoresError("승인된 소속 매장을 불러오지 못했습니다. 다시 시도해 주세요.");
      } finally {
        if (!controller.signal.aborted) {
          setIsStoresLoading(false);
        }
      }
    }

    loadApprovedStores();
    return () => controller.abort();
  }, [router, storesReloadToken]);

  useEffect(() => {
    // Check Supabase session - redirect if needed
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getUser();
        
        if (error || !data.user) {
          router.push("/");
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", data.user.id)
          .maybeSingle<{ role: string }>();

        // Verify user is staff
        if (profile?.role !== "staff") {
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

  useEffect(() => {
    // Set user info from metadata
    const setUserInfo = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) return;

        const user = data.session.user;
        const name = user.user_metadata?.name;

        // Set user name from metadata
        if (name) {
          setUserName(name);
        }
      } catch (e) {
        console.error("Set user info failed:", e);
      }
    };

    setUserInfo();
  }, []);

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
    if (!question || isLoading || isStoresLoading) return;
    if (!selectedStore) {
      setErrorMessage(
        stores.length === 0
          ? "승인된 소속 매장이 없습니다. 관리자에게 승인 상태를 확인해 주세요."
          : "먼저 근무 매장을 선택해 주세요.",
      );
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
    <div className="h-screen overflow-hidden bg-[var(--color-bg-default)]">
      {/* Sidebar */}
      <StaffSidebar
        activeMenu="ai-chat"
        onLogout={handleLogout}
      />

      {/* Main Content - Right side with flex column layout */}
      <div className="lg:ml-[240px] h-screen flex flex-col overflow-hidden">
        {/* Header */}
        <StaffHeader userName={userName} storeName={storeName} />

        {/* Content */}
        <main className="flex-1 min-h-0 overflow-y-auto p-6 lg:p-8">
          <div className="max-w-7xl mx-auto h-full flex flex-col">
            {/* Title Section */}
            <div className="mb-8 flex items-center justify-between flex-shrink-0">
              <div>
                <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                  일잇다 AI
                </h1>
                <p className="text-base text-[var(--color-text-secondary)]">
                  매장 업무에 대한 궁금한 점을 언제든지 물어보세요.
                </p>
              </div>
              <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--color-primary)] hover:text-[var(--color-primary-light)] transition-colors flex-shrink-0">
                새 대화 시작
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Store Selector */}
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-white px-4 py-3 flex-shrink-0">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-light)]/30 text-[var(--color-primary)]">
                <Store size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <label htmlFor="staff-store" className="block text-xs font-semibold text-[var(--color-text-secondary)]">
                  근무 매장
                </label>
                <select
                  id="staff-store"
                  value={selectedStore?.id ?? ""}
                  disabled={isLoading || isStoresLoading || stores.length === 0}
                  onChange={(event) => selectStore(event.target.value)}
                  className="mt-0.5 w-full bg-transparent text-sm font-semibold text-[var(--color-text-primary)] outline-none disabled:cursor-not-allowed disabled:opacity-70"
                >
<option value="">
  {isStoresLoading
    ? "승인된 매장 정보를 불러오는 중..."
    : stores.length > 0
      ? "매장을 선택해 주세요"
      : "승인된 근무 매장이 없습니다"}
</option>

{stores.map((store) => (
  <option key={store.id} value={store.id}>
    {store.name}
  </option>
))}

                </select>
              </div>
            </div>

            {storesError && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <span>{storesError}</span>
                <button
                  type="button"
                  onClick={() => setStoresReloadToken((value) => value + 1)}
                  className="shrink-0 font-semibold text-red-700 hover:text-red-900"
                >
                  다시 시도
                </button>
              </div>
            )}

            {!isStoresLoading && !storesError && stores.length === 0 && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                승인된 소속 매장이 없습니다. 관리자에게 승인 상태를 확인해 주세요.
              </div>
            )}

            {/* Chat Container - takes remaining space */}
            <div className="bg-white border border-[var(--color-border)] rounded-lg overflow-hidden flex flex-col flex-1 min-h-0">
            {/* Messages Area - Only this scrolls */}
            <div className="flex-1 overflow-y-auto space-y-4 p-6 min-h-0">
              {/* Date Indicator */}
              <div className="flex justify-center">
                <span className="flex items-center gap-1.5 rounded-full bg-[var(--color-bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)]">
                  <Clock3 size={12} /> 오늘
                </span>
              </div>

              {/* Messages */}
              {messages.map((message, index) => (
                <MessageBubble key={`${message.time}-${index}`} message={message} />
              ))}

              {/* Loading Indicator */}
              {isLoading && <TypingIndicator />}

              {/* Error Message */}
              {errorMessage && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-red-800">{errorMessage}</p>
                    </div>
                    <button
                      type="button"
                      onClick={dismissError}
                      className="text-red-600 hover:text-red-700 font-medium text-sm"
                    >
                      닫기
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Questions - Fixed at bottom, horizontal scroll */}
            <div className="border-t border-[var(--color-border)] bg-white px-6 py-4 flex-shrink-0">
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {quickQuestions.map(question => (
                  <button
                    key={question}
                    type="button"
                    aria-label={`질문: ${question}`}
                    disabled={isLoading || isStoresLoading || !selectedStore}
                    onClick={() => {
                      setInput(question);
                      sendMessage({ preventDefault: () => {} } as FormEvent);
                    }}
                    className="shrink-0 whitespace-nowrap rounded-full border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-primary-light)]/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>

            {/* Input Area - Fixed at bottom */}
            <div className="border-t border-[var(--color-border)] bg-white p-4 flex-shrink-0">
              <form onSubmit={sendMessage} className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="파일 첨부"
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] transition-colors flex-shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                >
                  <Paperclip size={20} />
                </button>

                <input
                  value={input}
                  disabled={isLoading || isStoresLoading || !selectedStore}
                  onChange={event => setInput(event.target.value)}
                  placeholder={isLoading ? "답변을 기다리는 중이에요…" : "질문을 입력하세요"}
                  aria-label="질문 입력창"
                  className="min-w-0 flex-1 px-4 py-3 border border-[var(--color-border)] rounded-lg bg-white text-base font-normal text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]/70 focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]/20 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                />

                <button
                  type="submit"
                  disabled={isLoading || isStoresLoading || !selectedStore || !input.trim()}
                  aria-label="메시지 보내기"
                  className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary)]/90 transition-colors flex-shrink-0 disabled:cursor-not-allowed disabled:bg-[var(--color-primary)]/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                >
                  <Send size={20} />
                </button>
              </form>
            </div>
          </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const badge = message.from === "ai" && message.status ? statusBadgeConfig[message.status] : null;
  const StatusIcon = badge?.icon;
  const hasSource = message.from === "ai" && (message.source?.title || message.source?.category || typeof message.similarity === "number");
  const similarityPercent = typeof message.similarity === "number" ? Math.min(100, Math.max(0, Math.round(message.similarity * 100))) : null;

  return (
    <div className={`flex items-end gap-3 ${message.from === "me" ? "justify-end" : "justify-start"}`}>
      {/* AI Avatar */}
      {message.from === "ai" && (
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#e8f5f0] text-[var(--color-primary)]">
          <Bot size={16} strokeWidth={2} />
        </div>
      )}

      <div className={`max-w-[65%] ${message.from === "me" ? "items-end" : "items-start"} flex flex-col`}>
        {/* Status Badge - Only for AI */}
        {badge && (
          <div className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${badge.className}`}>
            {StatusIcon && <StatusIcon size={14} strokeWidth={2.5} />}
            <span>{badge.label}</span>
          </div>
        )}

        {/* Message Bubble */}
        <div
          className={`rounded-2xl px-4 py-3 text-base leading-relaxed ${
            message.from === "me"
              ? "rounded-br-none bg-[#d4ead7] text-[#0d5d4d] font-medium"
              : "rounded-bl-none bg-[#f0f7f4] text-[#1a1a1a] border border-[#e0eae8]"
          }`}
        >
          <div className="whitespace-pre-line break-words">{message.text}</div>
        </div>

        {/* Source Info - Only for AI */}
        {hasSource && (
          <div className="mt-3 w-full max-w-sm rounded-lg border border-[#e0eae8] bg-[#f9fbfa] p-3">
            {/* Source Badge */}
            {(message.source?.title || message.source?.category) && (
              <div className="mb-2 flex items-start gap-2">
                <span className="text-xs font-semibold text-[var(--color-primary)]">📖</span>
                <div>
                  <p className="text-xs font-semibold text-[#0d5d4d]">근거 매뉴얼</p>
                  <p className="mt-0.5 text-xs font-medium text-[#0d5d4d]">
                    {[message.source?.title, message.source?.category].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
            )}

            {/* Similarity - Only if exists */}
            {similarityPercent !== null && (
              <div className="mt-2 border-t border-[#e0eae8] pt-2">
                <p className="text-xs text-[#555]">관련도 <span className="font-semibold text-[#0d5d4d]">{similarityPercent}%</span></p>
              </div>
            )}
          </div>
        )}

        {/* Timestamp */}
        <span className="mt-2 px-1 text-xs text-[#888]">{message.time}</span>
      </div>

      {/* User Avatar */}
      {message.from === "me" && (
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#d4ead7] text-[#0d5d4d]">
          <UserRound size={16} strokeWidth={2} />
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start items-end gap-3">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#e8f5f0] text-[var(--color-primary)]">
        <Bot size={16} strokeWidth={2} />
      </div>
      <div role="status" aria-label="AI가 답변을 작성 중" className="flex items-center gap-2 rounded-2xl rounded-bl-none bg-[#f0f7f4] px-4 py-3 border border-[#e0eae8]">
        <span className="flex gap-1.5">
          <i className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-primary)]" />
          <i className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-primary)] [animation-delay:120ms]" />
          <i className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-primary)] [animation-delay:240ms]" />
        </span>
        <span className="text-sm font-medium text-[#1a1a1a]">매뉴얼을 확인하고 있어요</span>
      </div>
    </div>
  );
}
