"use client";

import React, { useRef, useState } from "react";
import { Loader2, UploadCloud } from "lucide-react";

interface ManualFileDropzoneProps {
  isAnalyzing: boolean;
  supportedExtensions: string[];
  maxUploadMb: number;
  onFileSelected: (file: File) => void;
}

export default function ManualFileDropzone({
  isAnalyzing,
  supportedExtensions,
  maxUploadMb,
  onFileSelected,
}: ManualFileDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const openFilePicker = () => {
    if (!isAnalyzing) fileInputRef.current?.click();
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (isAnalyzing) return;
    const file = event.dataTransfer.files[0];
    if (file) onFileSelected(file);
  };

  return (
    <div
      role="button"
      tabIndex={isAnalyzing ? -1 : 0}
      aria-busy={isAnalyzing}
      aria-disabled={isAnalyzing}
      aria-label="매뉴얼 파일 선택"
      onClick={openFilePicker}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openFilePicker();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!isAnalyzing) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`flex min-h-[360px] flex-col items-center justify-center bg-white rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center transition-colors shadow-sm break-keep focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 ${
        isAnalyzing
          ? "cursor-wait opacity-80 border-[var(--color-border)]"
          : isDragging
            ? "cursor-pointer border-[var(--color-primary)] bg-[var(--color-bg-surface)]"
            : "cursor-pointer border-[var(--color-border)] hover:border-[var(--color-primary)]"
      }`}
    >
      {isAnalyzing ? (
        <Loader2 size={48} className="mb-5 animate-spin text-[var(--color-primary)]" aria-hidden="true" />
      ) : (
        <UploadCloud size={48} className="mb-5 text-[var(--color-primary)]" aria-hidden="true" />
      )}
      <p className="text-lg sm:text-xl font-semibold text-[var(--color-text-primary)] mb-2">
        {isAnalyzing ? "파일을 분석하고 있어요..." : "파일을 올려주세요."}
      </p>
      <p className="text-sm text-[var(--color-text-secondary)] mb-6">
        {isAnalyzing ? "잠시만 기다려주세요." : "클릭하거나 파일을 이 영역으로 드래그하세요."}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {supportedExtensions.map((extension) => (
          <span
            key={extension}
            className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-default)] px-3 py-1 text-xs font-medium text-[var(--color-text-secondary)]"
          >
            {extension}
          </span>
        ))}
        <span className="text-xs text-[var(--color-text-tertiary)]">
          · 최대 {maxUploadMb}MB · PDF는 준비 중
        </span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={supportedExtensions.join(",")}
        className="hidden"
        disabled={isAnalyzing}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFileSelected(file);
        }}
      />
    </div>
  );
}