"use client";

import React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { ManualPreviewEditor, type ManualEditState } from "@/components/manuals/ManualPreviewEditor";
import type { ManualUploadPreview } from "@/lib/manuals/build-manual-preview";

interface ManualUploadReviewModalProps {
  preview: ManualUploadPreview;
  categoryLabels: Record<string, string>;
  manualEdits: Record<string, ManualEditState>;
  collapsedCategories: Set<string>;
  error: string;
  isSaving: boolean;
  onCategoryLabelChange: (tempId: string, value: string) => void;
  onManualTitleChange: (tempId: string, value: string) => void;
  onManualCategoryMove: (tempId: string, categoryTempId: string) => void;
  onManualExcludeToggle: (tempId: string) => void;
  onToggleCategoryCollapsed: (tempId: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export default function ManualUploadReviewModal({
  preview,
  categoryLabels,
  manualEdits,
  collapsedCategories,
  error,
  isSaving,
  onCategoryLabelChange,
  onManualTitleChange,
  onManualCategoryMove,
  onManualExcludeToggle,
  onToggleCategoryCollapsed,
  onClose,
  onSave,
}: ManualUploadReviewModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-4 sm:px-6"
      onClick={() => {
        if (!isSaving) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-upload-review-title"
        className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          aria-label="미리보기 닫기"
          className="absolute right-4 top-4 z-10 rounded-md p-1 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-default)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
        >
          <X size={20} aria-hidden="true" />
        </button>

        <div className="shrink-0 border-b border-[var(--color-border)] px-5 py-4 pr-14 sm:px-6">
          <h2 id="manual-upload-review-title" className="mb-1 text-lg font-bold text-[var(--color-text-primary)]">
            AI 분석 결과 미리보기
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            세부 매뉴얼 {preview.totalDetailManualCount}개 · 카테고리 {preview.topCategoryCount}개
          </p>
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {isSaving ? "매뉴얼을 저장하고 있어요." : ""}
        </p>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 overscroll-contain sm:px-6 sm:py-5">
          <ManualPreviewEditor
            preview={preview}
            categoryLabels={categoryLabels}
            manualEdits={manualEdits}
            collapsedCategories={collapsedCategories}
            onCategoryLabelChange={onCategoryLabelChange}
            onManualTitleChange={onManualTitleChange}
            onManualCategoryMove={onManualCategoryMove}
            onManualExcludeToggle={onManualExcludeToggle}
            onToggleCategoryCollapsed={onToggleCategoryCollapsed}
          />
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-[var(--color-status-error)] break-keep">
              {error}
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-[var(--color-border)] bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={onClose} disabled={isSaving}>
              취소
            </Button>
            <Button variant="primary" className="flex-1" isLoading={isSaving} disabled={isSaving} onClick={onSave}>
              일괄 등록
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}