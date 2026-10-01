"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";

interface EditableNotice {
  id: string;
  title: string;
  content: string;
}

interface NoticeEditDialogProps {
  notice: EditableNotice | null;
  onClose: () => void;
  onSave: (title: string, content: string) => Promise<void>;
}

const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 5000;
const fieldClass =
  "w-full rounded-lg border-2 border-[var(--color-border)] bg-white px-4 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30";

export function NoticeEditDialog({ notice, onClose, onSave }: NoticeEditDialogProps) {
  const [title, setTitle] = useState(notice?.title ?? "");
  const [content, setContent] = useState(notice?.content ?? "");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  if (!notice) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle || !trimmedContent) {
      setError("제목과 내용을 입력해주세요.");
      return;
    }

    setError("");
    setIsSaving(true);
    try {
      await onSave(trimmedTitle, trimmedContent);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "공지를 수정하지 못했습니다.");
      setIsSaving(false);
    }
  };

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 lg:items-center lg:p-6"
      onClick={() => !isSaving && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="notice-edit-title"
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl lg:max-w-2xl lg:rounded-lg lg:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <h2 id="notice-edit-title" className="text-xl font-bold text-[var(--color-text-primary)]">공지 수정</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label="공지 수정 닫기"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor="notice-edit-title-input" className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
              제목
            </label>
            <input
              id="notice-edit-title-input"
              value={title}
              maxLength={TITLE_MAX_LENGTH}
              onChange={(event) => setTitle(event.target.value)}
              className={`${fieldClass} h-11`}
            />
          </div>
          <div className="mt-4">
            <label htmlFor="notice-edit-content-input" className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
              내용
            </label>
            <textarea
              id="notice-edit-content-input"
              value={content}
              maxLength={CONTENT_MAX_LENGTH}
              onChange={(event) => setContent(event.target.value)}
              className={`${fieldClass} h-60 resize-y py-3 leading-6`}
            />
          </div>

          {error && (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2 border-t border-[var(--color-border)] pt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-default)] disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "저장 중..." : "저장"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}