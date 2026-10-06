"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, MessageSquare, RefreshCw, Trash2, X } from "lucide-react";

import type { ConversationSummaryDto } from "@/lib/staff/conversations";

type ListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; conversations: ConversationSummaryDto[]; historyAvailable: boolean };

interface ConversationHistoryDrawerProps {
  activeConversationId: string | null;
  onClose: () => void;
  onOpenConversation: (conversation: ConversationSummaryDto) => void;
  /** 삭제된 대화가 지금 열린 대화면 페이지가 새 대화로 바꿀 수 있게 알린다. */
  onDeleted: (conversationId: string) => void;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function groupLabel(value: string, todayStart: number): "오늘" | "어제" | "이전" {
  const time = new Date(value).getTime();
  if (time >= todayStart) return "오늘";
  if (time >= todayStart - 24 * 60 * 60 * 1000) return "어제";
  return "이전";
}

function formatItemTime(value: string, group: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (group === "이전") return `${date.getMonth() + 1}월 ${date.getDate()}일`;
  return date.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
}

/** 직원 AI 대화 기록 (우측 Drawer). 목록/삭제는 서버가 본인 대화만 다룬다. */
export default function ConversationHistoryDrawer({
  activeConversationId,
  onClose,
  onOpenConversation,
  onDeleted,
}: ConversationHistoryDrawerProps) {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [todayStart] = useState(() => startOfDay(new Date()));
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const load = () =>
    fetch("/api/staff/conversations", { credentials: "include" })
      .then(async (response) => {
        const result = (await response.json()) as { conversations?: ConversationSummaryDto[]; historyAvailable?: boolean };
        if (!response.ok || !Array.isArray(result.conversations)) throw new Error("failed");
        setState({ status: "ready", conversations: result.conversations, historyAvailable: result.historyAvailable !== false });
      })
      .catch(() => setState({ status: "error" }));

  useEffect(() => {
    void load();
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // 열릴 때 한 번만 목록을 불러온다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deleteConversation = async (conversation: ConversationSummaryDto) => {
    if (deletingId) return;
    if (!window.confirm("이 대화를 삭제할까요?\n삭제한 대화는 복구할 수 없습니다.")) return;
    setDeletingId(conversation.id);
    try {
      const response = await fetch(`/api/staff/conversations/${encodeURIComponent(conversation.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (response.ok) {
        setState((current) =>
          current.status === "ready"
            ? { ...current, conversations: current.conversations.filter((item) => item.id !== conversation.id) }
            : current,
        );
        onDeleted(conversation.id);
      }
    } finally {
      setDeletingId(null);
    }
  };

  const groups =
    state.status === "ready"
      ? (["오늘", "어제", "이전"] as const)
          .map((label) => ({
            label,
            items: state.conversations.filter((conversation) => groupLabel(conversation.updatedAt, todayStart) === label),
          }))
          .filter((group) => group.items.length > 0)
      : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversation-history-title"
        className="relative flex h-full w-full max-w-sm flex-col border-l border-[var(--color-border)] bg-white shadow-md"
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-5">
          <h2 id="conversation-history-title" className="text-base font-bold text-[var(--color-text-primary)]">
            대화 기록
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="대화 기록 닫기"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 [scrollbar-width:thin]">
          {state.status === "loading" ? (
            <p className="px-2 py-8 text-center text-sm text-[var(--color-text-secondary)]" role="status">
              대화 기록을 불러오는 중...
            </p>
          ) : state.status === "error" ? (
            <div className="flex flex-col items-center gap-2 px-2 py-8 text-center" role="alert">
              <p className="flex items-center gap-1.5 text-sm text-red-700">
                <AlertCircle size={16} aria-hidden="true" /> 대화 기록을 불러오지 못했습니다.
              </p>
              <button
                type="button"
                onClick={() => {
                  setState({ status: "loading" });
                  void load();
                }}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                <RefreshCw size={16} aria-hidden="true" /> 다시 시도
              </button>
            </div>
          ) : !state.historyAvailable ? (
            <p className="px-2 py-8 text-center text-sm text-[var(--color-text-secondary)]">
              대화 기록 저장소가 아직 준비되지 않았습니다.
            </p>
          ) : groups.length === 0 ? (
            <div className="px-2 py-10 text-center">
              <MessageSquare size={24} className="mx-auto mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
              <p className="text-sm text-[var(--color-text-secondary)]">아직 저장된 대화가 없습니다.</p>
              <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">AI에게 첫 질문을 해보세요.</p>
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.label} aria-label={group.label} className="mb-3">
                <h3 className="px-2 pb-1 pt-2 text-xs font-semibold text-[var(--color-text-tertiary)]">{group.label}</h3>
                <ul>
                  {group.items.map((conversation) => {
                    const isActive = conversation.id === activeConversationId;
                    return (
                      <li key={conversation.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => onOpenConversation(conversation)}
                          aria-current={isActive ? "true" : undefined}
                          className={`flex w-full flex-col items-start rounded-lg py-2.5 pl-3 pr-12 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                            isActive ? "bg-[var(--color-primary-light)]/30" : "hover:bg-[var(--color-bg-default)]"
                          }`}
                        >
                          <span className="flex w-full items-center gap-1.5">
                            {isActive && (
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" aria-hidden="true" />
                            )}
                            <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">{conversation.title}</span>
                          </span>
                          <span className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
                            {formatItemTime(conversation.updatedAt, group.label)}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteConversation(conversation)}
                          disabled={deletingId !== null}
                          aria-label={`${conversation.title} 대화 삭제`}
                          className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 hover:bg-red-50 hover:text-red-700 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 group-hover:opacity-100 disabled:opacity-40"
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
