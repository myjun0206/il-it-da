"use client";

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface NoticePaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function NoticePagination({ page, totalPages, onPageChange }: NoticePaginationProps) {
  if (totalPages <= 1) return null;

  const currentPage = Math.min(page, totalPages);
  const maxVisiblePages = 5;

  // 페이지 범위 계산 (현재 페이지를 중심으로)
  let firstPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let lastPage = Math.min(totalPages, firstPage + maxVisiblePages - 1);

  // 끝에서 페이지 범위 조정
  if (lastPage - firstPage + 1 < maxVisiblePages) {
    firstPage = Math.max(1, lastPage - maxVisiblePages + 1);
  }

  const pageNumbers: (number | string)[] = [];

  // 첫 페이지 추가
  if (firstPage > 1) {
    pageNumbers.push(1);
    if (firstPage > 2) {
      pageNumbers.push("...");
    }
  }

  // 페이지 번호 추가
  for (let i = firstPage; i <= lastPage; i++) {
    pageNumbers.push(i);
  }

  // 마지막 페이지 추가
  if (lastPage < totalPages) {
    if (lastPage < totalPages - 1) {
      pageNumbers.push("...");
    }
    pageNumbers.push(totalPages);
  }

  return (
    <nav aria-label="공지 페이지" className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="이전 페이지"
        className="inline-flex min-h-[40px] w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-default)] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>

      {pageNumbers.map((pageNumber, index) =>
        pageNumber === "..." ? (
          <span key={`ellipsis-${index}`} className="px-1 text-[var(--color-text-tertiary)]">…</span>
        ) : (
          <button
            key={pageNumber}
            type="button"
            onClick={() => onPageChange(pageNumber as number)}
            aria-label={`${pageNumber}페이지`}
            aria-current={pageNumber === page ? "page" : undefined}
            className={`min-h-[40px] min-w-[40px] rounded-lg border px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
              pageNumber === page
                ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                : "border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-default)]"
            }`}
          >
            {pageNumber}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="다음 페이지"
        className="inline-flex min-h-[40px] w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-default)] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </nav>
  );
}