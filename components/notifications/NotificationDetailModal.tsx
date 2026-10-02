"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

interface NotificationDetailModalProps {
  notification: {
    id: string;
    title: string;
    message: string;
    createdAt: string;
    type?: string;
  };
  onClose: () => void;
}

function formatNotificationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}.${month}.${day}`;
}

export function NotificationDetailModal({ notification, onClose }: NotificationDetailModalProps) {
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
        onClick={(event) => event.stopPropagation()}
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
          <span className="text-sm text-[var(--color-text-secondary)]">
            {formatNotificationDate(notification.createdAt)}
          </span>

          {/* Confirm Button on the right */}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[var(--color-primary)] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            확인
          </button>
        </footer>
      </section>
    </div>
  );
}
