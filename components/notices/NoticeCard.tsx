import type { ReactNode } from "react";

import { NoticeMeta } from "@/components/notices/NoticeMeta";
import { NoticeReadStatus } from "@/components/notices/NoticeReadStatus";

interface NoticeCardProps {
  title: string;
  content: string;
  sourceLabel: string;
  createdAt: string;
  viewCount: number;
  isRead: boolean | null;
  onOpen: () => void;
  actions?: ReactNode;
  showContent?: boolean;
  showSourceLabel?: boolean;
}

export function NoticeCard({
  title,
  content,
  sourceLabel,
  createdAt,
  viewCount,
  isRead,
  onOpen,
  actions,
  showContent = true,
  showSourceLabel = true,
}: NoticeCardProps) {
  return (
    <article className="rounded-lg border border-[var(--color-border)] bg-white p-5 shadow-sm transition-colors hover:border-[var(--color-primary)]/50 sm:p-6">
      <div className="flex items-start gap-4">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
          <span className="mb-2 block"><NoticeReadStatus isRead={isRead} /></span>
          <span className="block break-words text-base font-semibold text-[var(--color-text-primary)] sm:text-lg">
            {title}
          </span>
          {showContent && (
            <span className="mt-2 block whitespace-pre-wrap break-words text-sm leading-6 text-[var(--color-text-secondary)] line-clamp-2">
              {content}
            </span>
          )}
          <NoticeMeta
            sourceLabel={showSourceLabel ? sourceLabel : undefined}
            createdAt={createdAt}
            viewCount={viewCount}
            className={showContent ? "mt-4" : "mt-2"}
          />
        </button>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
    </article>
  );
}