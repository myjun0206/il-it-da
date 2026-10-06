"use client";

import { useEffect, type ReactNode } from "react";
import { Eye, X } from "lucide-react";

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

function getNoticeTypeBadge(sourceLabel: string): string {
  if (sourceLabel.includes("본사")) return "본사 공지";
  if (sourceLabel.includes("점주")) return "매장 공지";
  return "공지";
}

function formatNoticeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}.${month}.${day}`;
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

  const noticeTypeBadge = getNoticeTypeBadge(notice.sourceLabel);
  const readStatusText = notice.isRead === null ? "발행" : notice.isRead ? "읽음" : "안읽음";

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
        className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl lg:max-w-[680px] lg:rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-5">
          <h2 id="notice-detail-title" className="break-words text-lg font-bold text-[var(--color-text-primary)]">
            {notice.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="공지 상세 닫기"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* 상태 영역: 공지 유형 + 읽음 상태 */}
          <div className="mb-4 flex items-center gap-3">
            <span className="inline-flex rounded-full bg-[var(--color-primary-light)]/40 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
              {noticeTypeBadge}
            </span>
            <span className="text-xs text-[var(--color-text-tertiary)]">{readStatusText}</span>
          </div>

          {/* 날짜 + 조회수 */}
          <div className="mb-7 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <span>{formatNoticeDate(notice.createdAt)}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Eye size={14} aria-hidden="true" /> 조회 {notice.viewCount}
            </span>
          </div>

          {/* 공지 본문 */}
          <p className="whitespace-pre-wrap break-words text-base leading-7 text-[var(--color-text-primary)]">
            {notice.content}
          </p>
        </div>

        {/* Footer */}
        <footer className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] px-6 py-5">
          {actions}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[var(--color-primary)] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            닫기
          </button>
        </footer>
      </section>
    </div>
  );
}