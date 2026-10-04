"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, MoreVertical, X } from "lucide-react";

interface NotificationDetailModalProps {
  notification: {
    id: string;
    title: string;
    message: string;
    createdAt: string;
    type?: string;
  };
  onClose: () => void;
  onNavigate?: () => void;
  isRead?: boolean;
  onMarkAsRead?: () => Promise<void>;
  onMarkAsUnread?: () => Promise<void>;
  onDelete?: () => Promise<void>;
}

function formatNotificationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}.${month}.${day}`;
}

export function NotificationDetailModal({ notification, onClose, onNavigate, isRead, onMarkAsRead, onMarkAsUnread, onDelete }: NotificationDetailModalProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const markAction = isRead ? onMarkAsUnread : onMarkAsRead;

  async function runAction(action: () => Promise<void>) {
    if (isActionLoading) return;
    setIsActionLoading(true);
    try {
      await action();
      setIsMenuOpen(false);
    } finally {
      setIsActionLoading(false);
    }
  }
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 lg:items-center lg:p-6"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-detail-title"
        className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl lg:max-w-[680px] lg:rounded-lg"
        onClick={(event) => {
          event.stopPropagation();
          if (!(event.target as Element).closest("[data-notification-actions]")) setIsMenuOpen(false);
        }}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-5">
          <h2 id="notification-detail-title" className="break-words text-lg font-bold text-[var(--color-text-primary)]">
            {notification.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="알림 상세 닫기"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* 알림 본문 */}
          <p className="whitespace-pre-wrap break-words text-base leading-7 text-[var(--color-text-primary)]">
            {notification.message}
          </p>
        </div>

        {/* Footer - Date and Confirm Button */}
        <footer className="flex items-center justify-between px-6 py-5">
          {/* Date on the left */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--color-text-secondary)]">
              {formatNotificationDate(notification.createdAt)}
            </span>
            {(markAction || onDelete) && (
              <div className="relative" data-notification-actions>
                <button type="button" aria-label="알림 관리" title="알림 관리" aria-haspopup="menu" aria-expanded={isMenuOpen} disabled={isActionLoading} onClick={() => setIsMenuOpen((open) => !open)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50">
                  <MoreVertical size={18} aria-hidden="true" />
                </button>
                {isMenuOpen && (
                  <div role="menu" aria-label="알림 관리" className="absolute bottom-full left-0 mb-1 min-w-36 rounded-lg border border-[var(--color-border)] bg-white p-1 shadow-md">
                    {markAction && <button type="button" role="menuitem" disabled={isActionLoading} onClick={() => void runAction(markAction)} className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--color-bg-surface)] disabled:opacity-50">{isRead ? "읽지 않음으로 표시" : "읽음으로 표시"}</button>}
                    {onDelete && <button type="button" role="menuitem" disabled={isActionLoading} onClick={() => void runAction(onDelete)} className="block w-full rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">삭제</button>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Confirm Button on the right */}
          <div className="flex flex-wrap justify-end gap-2">
            {onNavigate && (
              <button
                type="button"
                onClick={onNavigate}
                className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-lg px-3 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-bg-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                관련 페이지로 이동 <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[var(--color-primary)] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
            >
              확인
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
