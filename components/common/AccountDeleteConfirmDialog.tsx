"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { Portal } from "./Portal";

interface AccountDeleteConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: ReactNode;
  passwordValue: string;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  isDeleting: boolean;
  onPasswordChange: (password: string) => void;
  onAuthenticate: () => void;
  onConfirmDelete: () => void;
  onCancel: () => void;
}

export function AccountDeleteConfirmDialog({
  isOpen,
  title,
  description,
  passwordValue,
  isAuthenticated,
  isAuthenticating,
  isDeleting,
  onPasswordChange,
  onAuthenticate,
  onConfirmDelete,
  onCancel,
}: AccountDeleteConfirmDialogProps) {
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
    if (!isAuthenticating && !isDeleting) onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !isAuthenticating && !isDeleting) {
      onCancel();
    }
  };

  if (!isOpen) return null;

  const isLoading = isAuthenticating || isDeleting;

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
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-delete-dialog-title"
          tabIndex={-1}
          className="max-w-sm w-full rounded-2xl bg-white p-6 shadow-xl focus:outline-none"
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 id="account-delete-dialog-title" className="text-lg font-bold text-[var(--color-text-primary)]">{title}</h2>
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

          {isAuthenticated ? (
            // Step 2: 최종 확인
            <div className="mb-6 space-y-3">
              <div className="p-4 rounded-lg bg-red-50 border border-red-200">
                <p className="text-sm text-red-700 font-medium">
                  ⚠️ 이 작업은 되돌릴 수 없습니다.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
                <p className="text-sm text-amber-800">
                  <span className="font-medium">다음 작업이 진행됩니다:</span>
                </p>
                <ul className="text-xs text-amber-800 mt-2 space-y-1 pl-4 list-disc">
                  <li>소속된 모든 매장에서 탈퇴</li>
                  <li>승인 대기 중인 매장 신청 취소</li>
                  <li>계정 및 관련 정보 삭제</li>
                </ul>
              </div>
            </div>
          ) : (
            // Step 1: 비밀번호 입력
            <div className="mb-6">
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                현재 비밀번호
              </label>
              <input
                type="password"
                value={passwordValue}
                onChange={(e) => onPasswordChange(e.target.value)}
                placeholder="본인 확인을 위해 비밀번호를 입력하세요"
                disabled={isLoading}
                className="w-full px-4 py-3 rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
              />
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="inline-flex min-h-[44px] items-center px-4 py-2 rounded-lg border-2 border-[var(--color-border)] bg-white text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              취소
            </button>
            {isAuthenticated ? (
              <button
                type="button"
                onClick={onConfirmDelete}
                disabled={isLoading}
                className="inline-flex min-h-[44px] items-center px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isDeleting ? "탈퇴 중..." : "탈퇴"}
              </button>
            ) : (
              <button
                type="button"
                onClick={onAuthenticate}
                disabled={isLoading || !passwordValue}
                className="inline-flex min-h-[44px] items-center px-4 py-2 rounded-lg bg-[var(--color-primary)] hover:opacity-90 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isAuthenticating ? "인증 중..." : "다음"}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
