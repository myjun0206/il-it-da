import { Eye } from "lucide-react";

interface NoticeMetaProps {
  createdAt: string;
  viewCount: number;
  sourceLabel?: string;
  className?: string;
}

export function formatNoticeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}.${month}.${day}`;
}

export function NoticeMeta({ createdAt, viewCount, sourceLabel, className = "" }: NoticeMetaProps) {
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--color-text-secondary)] ${className}`}>
      {sourceLabel && (
        <>
          <span className="font-medium text-[var(--color-text-primary)]">{sourceLabel}</span>
          <span aria-hidden="true">·</span>
        </>
      )}
      <span>{formatNoticeDate(createdAt)}</span>
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1">
        <Eye size={14} aria-hidden="true" /> 조회 {viewCount}
      </span>
    </div>
  );
}