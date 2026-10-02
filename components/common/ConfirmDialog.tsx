"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Portal } from "./Portal";

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
  const dialogRef = useRef<HTMLDivElement>(null);

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

  // 초점이 창 밖(탭 이동 등)으로 나가도 Esc로 닫히도록 문서 단위에서 받는다.
  // Tab 순환은 EscalationNotificationPopup과 같은 방식이다.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!isLoading) onCancel();
        return;
      }
      if (e.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
      );
      const active = document.activeElement;

      // 처리 중에는 버튼이 모두 비활성이므로 창 자체에 초점을 묶어 둔다.
      if (focusable.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const outside = !active || !dialog.contains(active);

      if (e.shiftKey && (outside || active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (outside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading, onCancel]);

  // 닫히면 창을 열기 전 초점(예: "소속 해제" 버튼)으로 돌려보낸다.
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [isOpen]);

  const handleBackdropClick = () => {
    if (!isLoading) onCancel();
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div
        role="presentation"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          padding: "1rem",
        }}
        onClick={handleBackdropClick}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          tabIndex={-1}
          className="max-w-sm w-full rounded-2xl bg-white p-6 shadow-xl focus:outline-none"
          onClick={(e) => e.stopPropagation()}
        >
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 id="confirm-dialog-title" className="text-lg font-bold text-[var(--color-text-primary)]">{title}</h2>
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
            // 위험한 작업은 Enter로 바로 실행되지 않도록 취소에 먼저 초점을 둔다.
            autoFocus={isDangerous}
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
        </div>
      </div>
    </Portal>
  );
}
