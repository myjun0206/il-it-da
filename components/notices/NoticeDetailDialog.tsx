"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

import { NoticeMeta } from "@/components/notices/NoticeMeta";
import { NoticeReadStatus } from "@/components/notices/NoticeReadStatus";

interface NoticeDetailDialogProps {
  notice: {
    title: string;
    content: string;
    sourceLabel: string;
    createdAt: string;
    viewCount: number;
    isRead: boolean | null;
  };
  onClose: () => void;
  actions?: ReactNode;
}

export function NoticeDetailDialog({ notice, onClose, actions }: NoticeDetailDialogProps) {
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
        aria-labelledby="notice-detail-title"
        className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl lg:max-w-2xl lg:rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] p-5 sm:p-6">
          <h2 id="notice-detail-title" className="break-words text-lg font-bold text-[var(--color-text-primary)] sm:text-xl">
            {notice.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="공지 상세 닫기"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <NoticeReadStatus isRead={notice.isRead} />
            <span className="text-sm font-medium text-[var(--color-text-secondary)]">{notice.sourceLabel}</span>
          </div>
          <NoticeMeta createdAt={notice.createdAt} viewCount={notice.viewCount} className="mb-6" />
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--color-text-primary)]">
            {notice.content}
          </p>
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] p-5 sm:p-6">
          {actions}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[var(--color-primary)] px-5 text-sm font-semibold text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            닫기
          </button>
        </footer>
      </section>
    </div>
  );
}