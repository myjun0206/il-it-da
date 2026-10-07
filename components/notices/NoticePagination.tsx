interface NoticePaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function NoticePagination({ page, totalPages, onPageChange }: NoticePaginationProps) {
  if (totalPages <= 1) return null;

  const currentPage = Math.min(page, totalPages);
  const firstPage = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const lastPage = Math.min(totalPages, firstPage + 4);

  return (
    <nav aria-label="공지 페이지" className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="min-h-[40px] rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        이전
      </button>
      {Array.from({ length: lastPage - firstPage + 1 }, (_, index) => firstPage + index).map((pageNumber) => (
        <button
          key={pageNumber}
          type="button"
          onClick={() => onPageChange(pageNumber)}
          aria-label={`${pageNumber}페이지`}
          aria-current={pageNumber === page ? "page" : undefined}
          className={`min-h-[40px] min-w-[40px] rounded-lg border px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
            pageNumber === page
              ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
              : "border-[var(--color-border)] bg-white text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]"
          }`}
        >
          {pageNumber}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="min-h-[40px] rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        다음
      </button>
    </nav>
  );
}