"use client";

import { FormEvent, useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Bot, CheckCircle2, Clock3, History, Info, Lock, Mic, Plus, Send, UserRound } from "lucide-react";

import { useStaffShell } from "@/components/staff/StaffShellContext";
import ConversationHistoryDrawer from "@/components/staff/ConversationHistoryDrawer";
import type { RagSource, RagStatus } from "@/lib/rag/types";
import type { StaffStore } from "@/lib/staff/approved-stores";
import type { ConversationMessageDto, ConversationSummaryDto } from "@/lib/staff/conversations";
import {
  readStaffConversationId,
  writeStaffConversationId,
} from "@/lib/staff/selected-store";
import { formatStoreDisplayName } from "@/lib/stores/search-stores";
import { createClient } from "@/lib/supabase/client";

type Message = {
  from: "ai" | "me";
  text: string;
  /** 비어 있으면 시간 표시 생략 (안내 메시지) */
  time: string;
  status?: RagStatus;
  source?: Partial<Pick<RagSource, "title" | "category">>;
  similarity?: number;
};

type ConversationDetail = {
  conversation: ConversationSummaryDto & { canContinue: boolean };
  messages: ConversationMessageDto[];
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

function buildNewChatMessages(storeName?: string): Message[] {
  const greetingText = storeName
    ? `새로운 대화를 시작해보세요.\n"${storeName}"의 업무에 대해 무엇이든 물어보세요.\n\n아래 예시 질문을 참고하거나,\n직접 궁금한 내용을 입력해보세요.`
    : `새로운 대화를 시작해보세요.\n업무에 대해 무엇이든 물어보세요.\n\n아래 예시 질문을 참고하거나,\n직접 궁금한 내용을 입력해보세요.`;
  return [
    { from: "ai", text: greetingText, time: "" },
  ];
}

const NEW_CHAT_MESSAGES: Message[] = buildNewChatMessages();

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

function formatMessageTime(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
}

/** 채팅 상단 날짜 표시: 오늘 / 어제 / M월 D일 */
function formatDateLabel(value?: string): string {
  if (!value) return "오늘";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "오늘";
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= todayStart) return "오늘";
  if (date.getTime() >= todayStart - 24 * 60 * 60 * 1000) return "어제";
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function toChatMessages(rows: ConversationMessageDto[]): Message[] {
  return rows.map((row) => {
    const message: Message = { from: row.role === "user" ? "me" : "ai", text: row.content, time: formatMessageTime(row.createdAt) };
    if (row.role === "assistant") {
      if (isRagStatus(row.status)) message.status = row.status;
      if (row.sourceTitle || row.sourceCategory) {
        message.source = { title: row.sourceTitle ?? undefined, category: row.sourceCategory ?? undefined };
      }
      if (typeof row.similarity === "number") message.similarity = row.similarity;
    }
    return message;
  });
}

/** 본인 대화 1건 조회 (서버가 user_id를 검증; 없거나 남의 대화면 null) */
async function fetchConversationDetail(conversationId: string, signal?: AbortSignal): Promise<ConversationDetail | null> {
  const response = await fetch(`/api/staff/conversations/${encodeURIComponent(conversationId)}`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as Partial<ConversationDetail>;
  if (!payload.conversation || !Array.isArray(payload.messages)) return null;
  return payload as ConversationDetail;
}

export default function StaffPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(NEW_CHAT_MESSAGES);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  // 근무 매장 목록/현재 매장은 직원 공통 상태(Header와 같은 source)를 쓴다.
  const {
    stores,
    pendingStores,
    selectedStore,
    isStoresLoading,
    storesError,
    reloadStores,
    selectStore: selectShellStore,
  } = useStaffShell();
  const restoreCheckedRef = useRef(false);
  const previousStoreIdRef = useRef(selectedStore?.id ?? null);
  const [toastMessage, setToastMessage] = useState("");
  // 대화: 첫 질문에 서버가 만든 ID. null이면 아직 저장되지 않은 새 대화.
  const [conversationId, setConversationId] = useState<string | null>(null);
  // 근무 권한이 없는 매장의 지난 대화를 열었을 때: 열람만 가능 (값 = 대화 매장명)
  const [readOnlyStoreName, setReadOnlyStoreName] = useState<string | null>(null);
  const [dateLabel, setDateLabel] = useState("오늘");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isConversationLoading, setIsConversationLoading] = useState(false);

  const messagesAreaRef = useRef<HTMLDivElement>(null);

  // 새 메시지·복원된 대화는 항상 최신 메시지가 보이도록 아래로 스크롤한다.
  useEffect(() => {
    const area = messagesAreaRef.current;
    if (area) area.scrollTop = area.scrollHeight;
  }, [messages, isLoading, errorMessage]);

  const isBusy = isLoading || isStoresLoading || isConversationLoading;
  const canAsk = !isBusy && Boolean(selectedStore) && readOnlyStoreName === null;

  function resetConversation(nextMessages?: Message[]) {
    const messagesToUse = nextMessages ?? buildNewChatMessages(selectedStore?.name);
    setMessages(messagesToUse);
    setConversationId(null);
    writeStaffConversationId(null);
    setReadOnlyStoreName(null);
    setDateLabel("오늘");
    setInput("");
    setErrorMessage("");
  }

  const resetForStoreChange = useEffectEvent(() => resetConversation());

  useEffect(() => {
    if (isStoresLoading) return;
    const nextStoreId = selectedStore?.id ?? null;
    const previousStoreId = previousStoreIdRef.current;
    previousStoreIdRef.current = nextStoreId;
    if (previousStoreId !== null && previousStoreId !== nextStoreId) {
      resetForStoreChange();
    }
  }, [isStoresLoading, selectedStore?.id]);

  /** + 새 대화: 화면만 초기화한다. DB row는 첫 질문 때 서버가 만든다. */
  function startNewConversation() {
    if (isBusy) return;
    resetConversation();
  }

  function applyStore(store: StaffStore) {
    // 공통 상태를 바꾸면 Header/ProfileMenu도 즉시 같은 매장으로 바뀐다.
    previousStoreIdRef.current = store.id;
    selectShellStore(store.id);
  }

  async function openConversation(summary: ConversationSummaryDto) {
    setIsHistoryOpen(false);
    if (isBusy || summary.id === conversationId) return;

    setIsConversationLoading(true);
    setErrorMessage("");
    try {
      const detail = await fetchConversationDetail(summary.id);
      if (!detail) {
        setErrorMessage("대화를 불러오지 못했습니다. 삭제되었거나 접근할 수 없는 대화입니다.");
        return;
      }

      const { conversation } = detail;
      // canContinue는 서버가 approved staff membership으로 판단한 값. 화면 목록에도 있어야 전환한다.
      const conversationStore = conversation.canContinue
        ? stores.find((store) => store.id === conversation.storeId) ?? null
        : null;

      setMessages(toChatMessages(detail.messages));
      setDateLabel(formatDateLabel(detail.messages[0]?.createdAt));
      setConversationId(conversation.id);
      writeStaffConversationId(conversation.id);
      setInput("");

      if (conversationStore) {
        setReadOnlyStoreName(null);
        if (conversationStore.id !== selectedStore?.id) {
          applyStore(conversationStore);
          setToastMessage(`${formatStoreDisplayName(conversationStore.name)} 대화로 전환했습니다.`);
        }
      } else {
        // 현재 근무 매장은 바꾸지 않고, 지난 대화는 열람만 허용한다.
        setReadOnlyStoreName(conversation.storeName || "이전 매장");
      }
    } catch {
      setErrorMessage("대화를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsConversationLoading(false);
    }
  }

  function handleConversationDeleted(deletedId: string) {
    if (deletedId === conversationId) resetConversation();
  }

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(""), 2500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Auth 확인: Staff 권한 검증
  useEffect(() => {
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
          .select("role, approval_status")
          .eq("id", data.user.id)
          .maybeSingle<{ role: string; approval_status: string | null }>();

        // Verify user is staff
        if (profile?.role !== "staff") {
          router.push("/");
          return;
        }
        if (profile.approval_status !== "approved") {
          router.push("/signup/approval-status");
          return;
        }
      } catch (e) {
        console.error("Auth check failed:", e);
        router.push("/");
      }
    };

    checkAuth();
  }, [router]);

  // 새로고침: 이 탭에서 보던 대화가 현재 근무 매장의 대화면 다시 연다. (본인 대화인지는 서버가 확인)
  useEffect(() => {
    if (isStoresLoading || restoreCheckedRef.current) return;
    const storedConversationId = readStaffConversationId();
    if (!storedConversationId) {
      restoreCheckedRef.current = true;
      return;
    }

    const controller = new AbortController();
    void fetchConversationDetail(storedConversationId, controller.signal)
      .catch(() => null)
      .then((restored) => {
        if (controller.signal.aborted) return;
        restoreCheckedRef.current = true;
        const { conversation } = restored ?? {};
        const sameStore = conversation?.canContinue && conversation.storeId === selectedStore?.id;
        if (!restored || !conversation || (conversation.canContinue && !sameStore)) {
          writeStaffConversationId(null);
          return;
        }
        setMessages(toChatMessages(restored.messages));
        setDateLabel(formatDateLabel(restored.messages[0]?.createdAt));
        setConversationId(conversation.id);
        setReadOnlyStoreName(sameStore ? null : conversation.storeName || "이전 매장");
      });
    return () => controller.abort();
  }, [isStoresLoading, selectedStore]);

  async function submitQuestion(rawQuestion: string) {
    const question = rawQuestion.trim();
    if (!question || isBusy) return;
    if (readOnlyStoreName !== null) {
      setErrorMessage("이 대화는 열람만 할 수 있습니다. 새 질문은 새 대화에서 시작해 주세요.");
      return;
    }
    if (!selectedStore) {
      setErrorMessage(
        stores.length === 0
          ? "승인된 근무 매장이 없습니다. 근무 매장이 승인된 뒤에 질문할 수 있어요."
          : "먼저 근무 매장을 선택해 주세요.",
      );
      return;
    }
    setInput("");
    setErrorMessage("");
    setMessages(current => [...current, { from: "me", text: question, time: formatMessageTime(new Date()) }]);
    setIsLoading(true);

    try {
      // 이어서 묻는 대화면 서버가 대화에 저장된 매장을 쓰고, storeId는 새 대화 시작에만 쓰인다.
      const response = await fetch("/api/staff/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, storeId: selectedStore.id, conversationId }),
      });

      const result: unknown = await response.json();
      const payload = isRecord(result) ? result : {};
      if (previousStoreIdRef.current !== selectedStore.id) return;

      if (payload.code === "CONVERSATION_NOT_FOUND") {
        // 다른 탭에서 삭제된 대화: 새 대화로 돌린다.
        setConversationId(null);
        writeStaffConversationId(null);
        setErrorMessage("이 대화를 찾을 수 없어 새 대화로 전환했습니다. 질문을 다시 보내 주세요.");
        return;
      }
      if (payload.code === "STORE_FORBIDDEN") {
        // 점주가 소속을 해제했을 수 있다: 승인 매장 목록을 다시 불러와 다른 매장 또는 매장 관리로 안내한다.
        resetConversation();
        setErrorMessage("이 매장의 근무 권한이 확인되지 않아 답변할 수 없습니다. 근무 매장 목록을 새로 불러왔습니다.");
        reloadStores();
        return;
      }

      const answer = typeof payload.answer === "string" ? payload.answer.trim() : "";
      const error = typeof payload.error === "string" ? payload.error : "답변을 받지 못했어요.";
      if (!response.ok || !answer) throw new Error(error);

      const message: Message = { from: "ai", text: answer, time: formatMessageTime(new Date()) };
      if (isRagStatus(payload.status)) message.status = payload.status;

      const source = normalizeSource(payload.source);
      if (source) message.source = source;

      if (typeof payload.similarity === "number" && Number.isFinite(payload.similarity)) {
        message.similarity = payload.similarity;
      }

      setMessages(current => [...current, message]);

      // 새 대화인데 conversationId가 저장되지 않은 경우 감지
      if (typeof payload.conversationId === "string" && payload.conversationId) {
        setConversationId(payload.conversationId);
        writeStaffConversationId(payload.conversationId);
      } else if (!conversationId) {
        // 새 대화 시작 중이었는데 저장 실패
        const saveErr = typeof payload.saveError === "string" ? payload.saveError : "대화 기록을 저장하지 못했습니다.";
        setErrorMessage(saveErr);
      }
    } catch {
      if (previousStoreIdRef.current !== selectedStore.id) return;
      setErrorMessage("답변을 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    void submitQuestion(input);
  }

  function dismissError() {
    setErrorMessage("");
  }

  return (
    <div className="h-full p-6 lg:p-8">
          <div className="max-w-7xl mx-auto h-full flex flex-col">
            {/* Title Section */}
            <div className="mb-8 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                  일잇다 AI
                </h1>
                <p className="text-base text-[var(--color-text-secondary)]">
                  매장 업무에 대한 궁금한 점을 언제든지 물어보세요.
                </p>
              </div>
              {/* 대화 액션: 기록 열기 / 새 대화 (compact) */}
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen(true)}
                  aria-haspopup="dialog"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <History size={16} aria-hidden="true" /> 대화 기록
                </button>
                <button
                  type="button"
                  onClick={startNewConversation}
                  disabled={isBusy}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[var(--color-primary)]/40 bg-[var(--color-primary-light)]/20 px-3 text-sm font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-light)]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus size={16} aria-hidden="true" /> 새 대화
                </button>
              </div>
            </div>

            {/* Store Selector 제거됨 - 기본 매장 자동 사용 */}

            {storesError && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <span>{storesError}</span>
                <button
                  type="button"
                  onClick={reloadStores}
                  className="shrink-0 font-semibold text-red-700 hover:text-red-900"
                >
                  다시 시도
                </button>
              </div>
            )}

            {!isStoresLoading && !storesError && stores.length === 0 && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <span>
                  {pendingStores.length > 0
                    ? "근무 신청이 승인 대기 중입니다. 점주가 승인하면 근무 매장으로 선택할 수 있습니다."
                    : "승인된 근무 매장이 없습니다."}
                </span>
                <Link
                  href="/staff/stores"
                  className="inline-flex min-h-[36px] items-center rounded-lg px-2 font-semibold text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  근무 매장 관리 →
                </Link>
              </div>
            )}

            {toastMessage && (
              <div
                role="status"
                className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-[var(--color-text-primary)] px-4 py-3 text-sm font-medium text-[var(--color-bg-surface)] shadow-md lg:left-[calc(50%+120px)]"
              >
                <CheckCircle2 size={16} aria-hidden="true" />
                {toastMessage}
              </div>
            )}


            {/* Chat Container - takes remaining space */}
            <div className="bg-white border border-[var(--color-border)] rounded-lg overflow-hidden flex flex-col flex-1 min-h-0">
            {/* Messages Area - Only this scrolls */}
            <div ref={messagesAreaRef} className="flex-1 overflow-y-auto space-y-6 p-6 min-h-0">
              {/* Date Indicator */}
              <div className="flex justify-center">
                <span className="flex items-center gap-1.5 rounded-full bg-[var(--color-bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)]">
                  <Clock3 size={12} /> {dateLabel}
                </span>
              </div>

              {isConversationLoading && (
                <p className="py-2 text-center text-sm text-[var(--color-text-secondary)]" role="status">
                  대화를 불러오는 중...
                </p>
              )}

              {/* Messages */}
              {messages.map((message, index) => {
                const prevMessage = index > 0 ? messages[index - 1] : null;
                const isConsecutiveAI = prevMessage?.from === "ai" && message.from === "ai";
                return (
                  <MessageBubble
                    key={`${message.time}-${index}`}
                    message={message}
                    showIcon={!isConsecutiveAI}
                  />
                );
              })}

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

            {/* Quick Questions - Scrollable with drag support */}
            <QuickQuestionsScroller questions={quickQuestions} canAsk={canAsk} onSelectQuestion={submitQuestion} />

            {/* Input Area - Fixed at bottom */}
            <div className="bg-white px-4 pt-3 pb-4 flex-shrink-0">
              {readOnlyStoreName !== null && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900" role="note">
                  <span className="flex min-w-0 items-start gap-1.5">
                    <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      {formatStoreDisplayName(readOnlyStoreName)} 근무 권한이 없어 이 대화는 열람만 할 수 있습니다.
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={startNewConversation}
                    className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg px-2 font-semibold text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                  >
                    <Plus size={14} aria-hidden="true" /> 새 대화 시작
                  </button>
                </div>
              )}
              <form onSubmit={sendMessage} className="flex items-center gap-0 border border-[var(--color-border)] rounded-lg bg-white overflow-hidden">
                <button
                  type="button"
                  disabled
                  title="음성 입력 준비 중"
                  aria-label="음성 입력 (준비 중)"
                  className="flex h-12 w-12 items-center justify-center text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-surface)] transition-colors flex-shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Mic size={20} />
                </button>

                <input
                  value={input}
                  disabled={!canAsk}
                  onChange={event => setInput(event.target.value)}
                  placeholder={isLoading ? "답변을 기다리는 중이에요…" : readOnlyStoreName !== null ? "열람 전용 대화입니다" : "질문을 입력하세요"}
                  aria-label="질문 입력창"
                  className="min-w-0 flex-1 px-4 py-3 bg-white text-base font-normal text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]/70 transition-colors disabled:cursor-not-allowed disabled:opacity-60 border-l border-[var(--color-border)]"
                />

                <button
                  type="submit"
                  disabled={!canAsk || !input.trim()}
                  aria-label="메시지 보내기"
                  className="flex h-12 w-12 items-center justify-center bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary)]/90 transition-colors flex-shrink-0 disabled:cursor-not-allowed disabled:bg-[var(--color-primary)]/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] border-l border-[var(--color-border)]"
                >
                  <Send size={20} />
                </button>
              </form>
            </div>
          </div>
          </div>

      {isHistoryOpen && (
        <ConversationHistoryDrawer
          activeConversationId={conversationId}
          onClose={() => setIsHistoryOpen(false)}
          onOpenConversation={openConversation}
          onDeleted={handleConversationDeleted}
        />
      )}
    </div>
  );
}

function MessageBubble({ message, showIcon = true }: { message: Message; showIcon?: boolean }) {
  const badge = message.from === "ai" && message.status ? statusBadgeConfig[message.status] : null;
  const StatusIcon = badge?.icon;
  const hasSource = message.from === "ai" && (message.source?.title || message.source?.category);
  const similarityPercent = typeof message.similarity === "number" ? Math.min(100, Math.max(0, Math.round(message.similarity * 100))) : null;

  return (
    <div className={`flex items-end gap-3 ${message.from === "me" ? "justify-end" : "justify-start"}`}>
      {/* AI Avatar - Only show if not consecutive AI message */}
      {message.from === "ai" && showIcon && (
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#e8f5f0] text-[var(--color-primary)]">
          <Bot size={16} strokeWidth={2} />
        </div>
      )}

      {/* Spacing placeholder for alignment when icon is hidden */}
      {message.from === "ai" && !showIcon && (
        <div className="h-9 w-9 flex-shrink-0" />
      )}

      <div className={`max-w-[65%] ${message.from === "me" ? "items-end" : "items-start"} flex flex-col`}>
        {message.from === "ai" ? (
          <>
            {/* AI Answer - Document-style with left accent line */}
            <div className="flex gap-4 items-start">
              {/* Left Accent Line */}
              <div className="w-0.5 bg-[var(--color-primary)] flex-shrink-0" />

              {/* AI Answer Content */}
              <div className="flex-1 flex flex-col">
                {/* Status Badge - Small label */}
                {badge && (
                  <div className={`mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold w-fit ${badge.className}`}>
                    {StatusIcon && <StatusIcon size={12} strokeWidth={2.5} />}
                    <span>{badge.label}</span>
                  </div>
                )}

                {/* Message Text - Multiple paragraphs with proper spacing */}
                <div className="text-base leading-relaxed text-[#1a1a1a] space-y-3">
                  {message.text.split('\n\n').map((paragraph, idx) => (
                    <div key={idx} className="whitespace-pre-wrap break-words">
                      {paragraph}
                    </div>
                  ))}
                </div>

                {/* Source Info - Inside the accent line group */}
                {hasSource && (
                  <div className="mt-4 pt-3 border-t border-[#dfe7dc] flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-sm flex-shrink-0">📖</span>
                      <p className="text-xs font-medium text-[#0d5d4d] truncate">
                        {[message.source?.title, message.source?.category].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {similarityPercent !== null && (
                      <p className="text-xs font-semibold text-[#0d5d4d] flex-shrink-0 whitespace-nowrap">{similarityPercent}%</p>
                    )}
                  </div>
                )}

                {/* Timestamp - Inside accent line group, below source */}
                {message.time && <span className="mt-2 text-xs text-[#888]">{message.time}</span>}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* User Message Bubble */}
            <div className="rounded-2xl rounded-br-none bg-[#d4ead7] text-[#0d5d4d] font-medium px-4 py-3 text-base leading-relaxed">
              <div className="whitespace-pre-line break-words">{message.text}</div>
            </div>

            {/* Timestamp - Outside */}
            {message.time && <span className="mt-2 px-1 text-xs text-[#888]">{message.time}</span>}
          </>
        )}
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
    <div className="flex items-end gap-3 justify-start">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#e8f5f0] text-[var(--color-primary)]">
        <Bot size={16} strokeWidth={2} />
      </div>
      <div className="max-w-[65%] items-start flex flex-col">
        <div role="status" aria-label="AI가 답변을 작성 중" className="flex gap-4 items-start">
          {/* Accent line placeholder for alignment */}
          <div className="w-0.5 bg-transparent flex-shrink-0" />

          {/* Loading content - SAME STRUCTURE as MessageBubble text wrapper */}
          <div className="flex-1 flex flex-col">
            {/* Match MessageBubble's text wrapper structure exactly */}
            <div className="text-sm font-medium text-[#1a1a1a]">
              <span className="inline-flex gap-1.5">
                <i className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-primary)]" />
                <i className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-primary)] [animation-delay:120ms]" />
                <i className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-primary)] [animation-delay:240ms]" />
              </span>
              <span className="ml-2">매뉴얼을 확인하고 있어요</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type QuickQuestionsScrollerProps = {
  questions: string[];
  canAsk: boolean;
  onSelectQuestion: (question: string) => void;
};

function QuickQuestionsScroller({ questions, canAsk, onSelectQuestion }: QuickQuestionsScrollerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef({ isDragging: false, startX: 0, startScrollLeft: 0, hasMoved: false });
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(true);

  function updateFadeState() {
    const container = scrollContainerRef.current;
    if (!container) return;

    const hasScroll = container.scrollWidth > container.clientWidth;
    setShowLeftFade(hasScroll && container.scrollLeft > 0);
    setShowRightFade(hasScroll && container.scrollLeft < container.scrollWidth - container.clientWidth - 10);
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    dragStateRef.current.isDragging = true;
    dragStateRef.current.startX = e.clientX;
    dragStateRef.current.startScrollLeft = scrollContainerRef.current?.scrollLeft ?? 0;
    dragStateRef.current.hasMoved = false;
    if (scrollContainerRef.current) {
      scrollContainerRef.current.style.cursor = "grabbing";
      scrollContainerRef.current.style.scrollBehavior = "auto";
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!dragStateRef.current.isDragging) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const movementX = e.clientX - dragStateRef.current.startX;
    if (Math.abs(movementX) > 5) {
      dragStateRef.current.hasMoved = true;
    }

    container.scrollLeft = dragStateRef.current.startScrollLeft - movementX;
  }

  function handleMouseUp() {
    dragStateRef.current.isDragging = false;
    if (scrollContainerRef.current) {
      scrollContainerRef.current.style.cursor = "grab";
      scrollContainerRef.current.style.scrollBehavior = "smooth";
    }
    updateFadeState();
  }

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    dragStateRef.current.isDragging = true;
    dragStateRef.current.startX = e.touches[0]?.clientX ?? 0;
    dragStateRef.current.startScrollLeft = scrollContainerRef.current?.scrollLeft ?? 0;
    dragStateRef.current.hasMoved = false;
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (!dragStateRef.current.isDragging) return;

    const container = scrollContainerRef.current;
    if (!container || !e.touches[0]) return;

    const movementX = e.touches[0].clientX - dragStateRef.current.startX;
    if (Math.abs(movementX) > 5) {
      dragStateRef.current.hasMoved = true;
    }

    container.scrollLeft = dragStateRef.current.startScrollLeft - movementX;
  }

  function handleTouchEnd() {
    dragStateRef.current.isDragging = false;
    updateFadeState();
  }

  function handleScroll() {
    updateFadeState();
  }

  function handleButtonClick(e: React.MouseEvent<HTMLButtonElement>, question: string) {
    if (dragStateRef.current.hasMoved) {
      e.preventDefault();
      return;
    }
    onSelectQuestion(question);
  }

  useEffect(() => {
    updateFadeState();
  }, [questions]);

  return (
    <div className="bg-white px-5 py-3 flex-shrink-0 relative overflow-hidden">
      {/* Left Fade */}
      {showLeftFade && (
        <div className="absolute left-5 top-0 bottom-0 w-12 pointer-events-none z-10" style={{
          background: "linear-gradient(to right, rgb(255, 255, 255) 0%, rgba(255, 255, 255, 0) 100%)",
        }} />
      )}

      {/* Right Fade */}
      {showRightFade && (
        <div className="absolute right-5 top-0 bottom-0 w-12 pointer-events-none z-10" style={{
          background: "linear-gradient(to left, rgb(255, 255, 255) 0%, rgba(255, 255, 255, 0) 100%)",
        }} />
      )}

      {/* Scrollable Container */}
      <div
        ref={scrollContainerRef}
        className="flex items-center gap-2 overflow-x-auto p-1 scrollbar-hide"
        style={{
          scrollBehavior: "smooth",
          cursor: "grab",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onScroll={handleScroll}
      >
        {questions.map(question => (
          <button
            key={question}
            type="button"
            aria-label={`질문: ${question}`}
            disabled={!canAsk}
            onClick={(e) => handleButtonClick(e, question)}
            className="shrink-0 whitespace-nowrap rounded-full border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-primary-light)]/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] select-none"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}
