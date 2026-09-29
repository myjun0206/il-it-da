"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: ReactNode;
  confirmText: string;
  cancelText: string;
  isDangerous?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmText,
  cancelText,
  isDangerous,
  isLoading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleBackdropClick = () => {
    if (!isLoading) onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !isLoading) {
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={handleBackdropClick}
    >
      <dialog
        open={isOpen}
        className="max-w-sm w-full rounded-2xl bg-white p-6 shadow-xl focus:outline-none"
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="shrink-0 p-1 rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="닫기"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mb-6 text-sm text-[var(--color-text-secondary)]">{description}</div>

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="inline-flex min-h-[44px] items-center px-4 py-2 rounded-lg border-2 border-[var(--color-border)] bg-white text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`inline-flex min-h-[44px] items-center px-4 py-2 rounded-lg text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
              isDangerous
                ? "bg-red-600 hover:bg-red-700 focus-visible:ring-red-600"
                : "bg-[var(--color-primary)] hover:opacity-90 focus-visible:ring-[var(--color-primary)]"
            }`}
          >
            {isLoading ? "처리 중..." : confirmText}
          </button>
        </div>
      </dialog>
    </div>
  );
}
