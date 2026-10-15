"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/common/Button";
import ManualFileDropzone from "@/components/manuals/ManualFileDropzone";
import ManualUploadReviewModal from "@/components/manuals/ManualUploadReviewModal";
import type { ManualEditState } from "@/components/manuals/ManualPreviewEditor";
import { buildConfirmedManualsPayload, type ManualUploadPreview } from "@/lib/manuals/build-manual-preview";
import { MAX_UPLOAD_FILE_SIZE_BYTES, isFileSizeWithinLimit } from "@/lib/manuals/upload-limits";

const SUPPORTED_ANALYZE_EXTENSIONS = [".txt", ".md", ".docx", ".csv", ".xlsx", ".xls"];
const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_FILE_SIZE_BYTES / (1024 * 1024));

export default function HQManualUpload({ onClose, onSaved }: { onClose: () => void; onSaved: (data: unknown) => void }) {
  const pending = useRef(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ManualUploadPreview | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});
  const [manualEdits, setManualEdits] = useState<Record<string, ManualEditState>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [pendingLeave, setPendingLeave] = useState(false);
  const close = () => {
    if (pending.current) return;
    if (preview) setPendingLeave(true);
    else onClose();
  };

  useEffect(() => {
    if (!pendingLeave) return;
    const cancelLeave = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingLeave(false);
    };
    window.addEventListener("keydown", cancelLeave);
    return () => window.removeEventListener("keydown", cancelLeave);
  }, [pendingLeave]);

  const analyze = async (file: File) => {
    if (pending.current) return;
    setError("");
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!SUPPORTED_ANALYZE_EXTENSIONS.includes(extension)) { setError(`지원하지 않는 형식입니다. ${SUPPORTED_ANALYZE_EXTENSIONS.join(", ")} 파일을 선택해주세요.`); return; }
    if (file.size === 0) { setError("빈 파일은 업로드할 수 없습니다."); return; }
    if (!isFileSizeWithinLimit(file.size)) { setError(`파일 용량은 최대 ${MAX_UPLOAD_MB}MB까지 가능합니다.`); return; }
    setIdempotencyKey("");
    setPreview(null);
    pending.current = true;
    setIsAnalyzing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/manuals/preview", { method: "POST", credentials: "same-origin", body: formData });
      const data = await response.json().catch(() => null) as { preview?: ManualUploadPreview; idempotencyKey?: string; error?: string } | null;
      if (!response.ok || !data?.preview || !data.idempotencyKey) throw new Error(data?.error || "파일을 분석하는 중 오류가 발생했습니다.");
      setPreview(data.preview);
      setIdempotencyKey(data.idempotencyKey);
      setCategoryLabels(Object.fromEntries(data.preview.categories.map((category) => [category.tempId, category.label])));
      setManualEdits(Object.fromEntries(data.preview.manuals.map((manual) => [manual.tempId, { title: manual.title, topCategoryTempId: manual.topCategoryTempId, excluded: false }])));
      setCollapsedCategories(new Set());
    } catch (failure) {
      setError(failure instanceof TypeError ? "네트워크 연결을 확인한 후 다시 시도해주세요." : failure instanceof Error ? failure.message : "파일을 분석하는 중 오류가 발생했습니다.");
    } finally { pending.current = false; setIsAnalyzing(false); }
  };

  const save = async () => {
    if (!preview || !idempotencyKey || pending.current) return;
    setError("");
    const manuals = buildConfirmedManualsPayload(preview, categoryLabels, manualEdits);
    if (!manuals.some((manual) => !manual.excluded)) { setError("저장할 매뉴얼이 없어요. 최소 1개 이상 남겨주세요."); return; }
    pending.current = true;
    setIsSaving(true);
    try {
      const response = await fetch("/api/manuals/preview/confirm", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manuals, idempotencyKey }) });
      const data = await response.json().catch(() => null) as { manuals?: unknown[]; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "매뉴얼 저장 중 오류가 발생했습니다.");
      if (!Array.isArray(data?.manuals) || data.manuals.length === 0) throw new Error("매뉴얼 저장 결과를 확인하지 못했습니다. 다시 시도해주세요.");
      onSaved(data);
    } catch (failure) {
      setError(failure instanceof TypeError ? "네트워크 연결을 확인한 후 다시 시도해주세요." : failure instanceof Error ? failure.message : "매뉴얼 저장 중 오류가 발생했습니다.");
    } finally { pending.current = false; setIsSaving(false); }
  };

  if (pendingLeave) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setPendingLeave(false)}>
      <section role="alertdialog" aria-modal="true" aria-labelledby="hq-upload-leave-title" aria-describedby="hq-upload-leave-description" className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <h2 id="hq-upload-leave-title" className="text-lg font-bold">등록을 취소할까요?</h2>
        <p id="hq-upload-leave-description" className="my-4 break-keep text-sm text-(--color-text-secondary)">아직 저장하지 않은 수정 내용이 사라져요.</p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setPendingLeave(false)} autoFocus>계속 작성하기</Button>
          <Button variant="danger" className="flex-1" onClick={onClose}>나가기</Button>
        </div>
      </section>
    </div>
  );

  if (preview) return (
    <ManualUploadReviewModal
      preview={preview}
      categoryLabels={categoryLabels}
      manualEdits={manualEdits}
      collapsedCategories={collapsedCategories}
      error={error}
      isSaving={isSaving}
      onCategoryLabelChange={(tempId, value) => setCategoryLabels((current) => ({ ...current, [tempId]: value }))}
      onManualTitleChange={(tempId, title) => setManualEdits((current) => ({ ...current, [tempId]: { ...current[tempId], title } }))}
      onManualCategoryMove={(tempId, topCategoryTempId) => setManualEdits((current) => ({ ...current, [tempId]: { ...current[tempId], topCategoryTempId } }))}
      onManualExcludeToggle={(tempId) => setManualEdits((current) => ({ ...current, [tempId]: { ...current[tempId], excluded: !current[tempId]?.excluded } }))}
      onToggleCategoryCollapsed={(tempId) => setCollapsedCategories((current) => { const next = new Set(current); if (next.has(tempId)) next.delete(tempId); else next.add(tempId); return next; })}
      onClose={close}
      onSave={() => void save()}
    />
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-4 sm:px-6" onClick={close}>
      <section role="dialog" aria-modal="true" aria-labelledby="hq-manual-upload-title" className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6" onClick={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div><h2 id="hq-manual-upload-title" className="text-lg font-bold text-(--color-text-primary)">매뉴얼 파일을 올려주세요</h2><p className="mt-1 text-sm text-(--color-text-secondary)">업로드한 파일 내용을 분석해 매뉴얼 항목을 자동으로 정리해드려요.</p></div>
          <button type="button" onClick={close} disabled={isAnalyzing} aria-label="등록 창 닫기" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-(--color-text-tertiary) transition-colors hover:bg-(--color-bg-default) hover:text-(--color-text-primary) disabled:opacity-50"><X size={20} aria-hidden="true" /></button>
        </div>
        <ManualFileDropzone isAnalyzing={isAnalyzing} supportedExtensions={SUPPORTED_ANALYZE_EXTENSIONS} maxUploadMb={MAX_UPLOAD_MB} onFileSelected={(file) => void analyze(file)} />
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={close} disabled={isAnalyzing}>취소</Button></div>
      </section>
    </div>
  );
}