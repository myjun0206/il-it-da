export function NoticeReadStatus({ isRead }: { isRead: boolean | null }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
        isRead === null
          ? "bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]"
          : isRead
            ? "bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]"
            : "bg-amber-50 text-amber-800"
      }`}
    >
      {isRead === null ? "발행" : isRead ? "읽음" : "안읽음"}
    </span>
  );
}