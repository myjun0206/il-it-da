"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UploadCloud, Loader2, ArrowLeft, Download, Check } from "lucide-react";
import { Button } from "@/components/common/Button";
import { ManualPreviewEditor, type ManualEditState } from "@/components/manuals/ManualPreviewEditor";
import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedProfile } from "@/lib/auth/client-profile";
import { MAX_UPLOAD_FILE_SIZE_BYTES, isFileSizeWithinLimit } from "@/lib/manuals/upload-limits";
import { buildConfirmedManualsPayload, type ManualUploadPreview } from "@/lib/manuals/build-manual-preview";

type Step = "upload" | "review";

// 화면에 보여주는 지원 형식. input accept 값과 반드시 일치시킨다.
const SUPPORTED_EXTENSIONS = [".txt", ".md", ".docx", ".csv", ".xlsx", ".xls"];
const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_FILE_SIZE_BYTES / (1024 * 1024));

// 매뉴얼 관리 화면(app/hq/manuals/page.tsx)과 같은 키를 사용한다.
const MANUAL_UPLOAD_NOTICE_KEY = "ilitda:manual-upload-notice";

const STEPS = ["파일 선택", "내용 확인", "저장 완료"] as const;

function setUploadNotice(message: string) {
  try {
    sessionStorage.setItem(MANUAL_UPLOAD_NOTICE_KEY, message);
  } catch {
    // 저장소를 쓸 수 없는 환경이면 알림 없이 이동한다.
  }
}

type PendingLeave = { title: string; run: () => void };

export default function ManualOnboardingPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isLeavingRef = useRef(false);
  // isSaving state와 별개로, 같은 클릭이 겹쳐 들어오는 것까지 막는 동기 가드.
  const isSubmittingRef = useRef(false);
  const [step, setStep] = useState<Step>("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [preview, setPreview] = useState<ManualUploadPreview | null>(null);
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});
  const [manualEdits, setManualEdits] = useState<Record<string, ManualEditState>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [error, setError] = useState("");
  // 매뉴얼 관리 화면의 "파일로 매뉴얼 추가"로 들어왔는지(true) 회원가입 직후 온보딩인지(false).
  // hq 레이아웃이 force-dynamic이라 Suspense 없이 useSearchParams를 써도 된다.
  const fromManuals = useSearchParams().get("from") === "manuals";
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null);

  useLayoutEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const profile = await getAuthenticatedProfile(supabase);

      if (profile?.role !== "hq") {
        router.push("/");
      }
    };

    checkAuth();
  }, [router]);

  // 승인 전 정리 결과가 있는 상태에서 새로고침/탭 닫기를 하면 브라우저 기본 경고를 띄운다.
  useEffect(() => {
    if (step !== "review") return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isLeavingRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [step]);

  // 확인 모달은 Esc로 닫는다.
  useEffect(() => {
    if (!pendingLeave) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingLeave(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [pendingLeave]);

  const leaveTo = useCallback(
    (href: string) => {
      isLeavingRef.current = true;
      router.push(href);
    },
    [router],
  );

  // 정리 화면(승인 전)에서 벗어나는 동작은 확인을 받은 뒤 실행한다.
  const confirmIfUnsaved = (title: string, run: () => void) => {
    if (step === "review" && !isSaving) {
      setPendingLeave({ title, run });
      return;
    }
    run();
  };

  const handleFile = useCallback(
    async (file: File) => {
      // 분석 중에는 새 파일을 받지 않는다(중복 업로드 방지).
      if (isAnalyzing) return;

      setError("");

      const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();

      if (extension === ".pdf") {
        setError("PDF는 아직 지원하지 않아요. Word(.docx)나 텍스트(.txt)로 저장해서 올려주세요.");
        return;
      }

      if (!SUPPORTED_EXTENSIONS.includes(extension)) {
        setError(`지원하지 않는 형식이에요. ${SUPPORTED_EXTENSIONS.join(", ")} 파일을 올려주세요.`);
        return;
      }

      if (!isFileSizeWithinLimit(file.size)) {
        setError(`파일 용량은 최대 ${MAX_UPLOAD_MB}MB까지 올릴 수 있어요.`);
        return;
      }

      setIsAnalyzing(true);

      // 모든 형식을 서버의 실제 규칙 기반 파서로 분석한다(미리보기 단계 - DB에 아무것도 쓰지 않는다).
      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/manuals/preview", {
          method: "POST",
          body: formData,
        });
        const data = (await response.json()) as {
          preview?: ManualUploadPreview;
          idempotencyKey?: string;
          error?: string;
        };

        if (!response.ok || !data.preview || !data.idempotencyKey) {
          throw new Error(data.error || "파일을 분석하는 중 오류가 발생했습니다.");
        }

        const nextPreview = data.preview;
        setPreview(nextPreview);
        setIdempotencyKey(data.idempotencyKey);
        setCategoryLabels(
          Object.fromEntries(nextPreview.categories.map((category) => [category.tempId, category.label])),
        );
        setManualEdits(
          Object.fromEntries(
            nextPreview.manuals.map((manual) => [
              manual.tempId,
              { title: manual.title, topCategoryTempId: manual.topCategoryTempId, excluded: false },
            ]),
          ),
        );
        setCollapsedCategories(new Set());
        setStep("review");
      } catch (e) {
        setError(e instanceof Error ? e.message : "파일을 분석하는 중 오류가 발생했습니다.");
      } finally {
        setIsAnalyzing(false);
      }
    },
    [isAnalyzing],
  );

  const openFilePicker = () => {
    if (isAnalyzing) return;
    fileInputRef.current?.click();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (isAnalyzing) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const resetToUpload = () => {
    setPreview(null);
    setIdempotencyKey("");
    setCategoryLabels({});
    setManualEdits({});
    setCollapsedCategories(new Set());
    setError("");
    setStep("upload");
  };

  const handleSkip = () => confirmIfUnsaved("나가시겠어요?", () => leaveTo("/hq/manuals"));
  const handleBack = () => confirmIfUnsaved("매뉴얼 관리로 돌아갈까요?", () => leaveTo("/hq/manuals"));
  const handleReupload = () => confirmIfUnsaved("다른 파일을 올릴까요?", resetToUpload);

  const handleCategoryLabelChange = (tempId: string, value: string) => {
    setCategoryLabels((prev) => ({ ...prev, [tempId]: value }));
  };

  const handleManualTitleChange = (tempId: string, value: string) => {
    setManualEdits((prev) => ({ ...prev, [tempId]: { ...prev[tempId], title: value } }));
  };

  const handleManualCategoryMove = (tempId: string, topCategoryTempId: string) => {
    setManualEdits((prev) => ({ ...prev, [tempId]: { ...prev[tempId], topCategoryTempId } }));
  };

  const handleManualExcludeToggle = (tempId: string) => {
    setManualEdits((prev) => ({
      ...prev,
      [tempId]: { ...prev[tempId], excluded: !prev[tempId]?.excluded },
    }));
  };

  const toggleCategoryCollapsed = (tempId: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) {
        next.delete(tempId);
      } else {
        next.add(tempId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!preview || !idempotencyKey || isSubmittingRef.current) return;

    setError("");

    const payloadManuals = buildConfirmedManualsPayload(preview, categoryLabels, manualEdits);

    const includedCount = payloadManuals.filter((manual) => !manual.excluded).length;

    if (includedCount === 0) {
      setError("저장할 매뉴얼이 없어요. 최소 1개 이상 남겨주세요.");
      return;
    }

    isSubmittingRef.current = true;
    setIsSaving(true);

    try {
      const response = await fetch("/api/manuals/preview/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manuals: payloadManuals, idempotencyKey }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "매뉴얼 저장 중 오류가 발생했습니다.");
      }

      setUploadNotice(`세부 매뉴얼 ${includedCount}개를 저장했어요.`);
      isLeavingRef.current = true;
      router.replace("/hq/manuals");
    } catch (e) {
      setError(e instanceof Error ? e.message : "매뉴얼 저장 중 오류가 발생했습니다.");
      setIsSaving(false);
      isSubmittingRef.current = false;
    }
  };

  const currentStepIndex = step === "upload" ? 0 : 1;
  const includedManualCount = preview
    ? preview.manuals.filter((manual) => !(manualEdits[manual.tempId]?.excluded ?? false)).length
    : 0;

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      {/* 3칸 그리드로 로고를 항상 정확히 가운데에 둔다. */}
      <header className="grid grid-cols-3 items-center px-6 h-16 border-b border-[var(--color-border)] bg-white">
        <div className="justify-self-start">
          {fromManuals && (
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-1 text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <ArrowLeft size={16} /> 매뉴얼 관리
            </button>
          )}
        </div>
        <img
          src="/logo/ilitda-wordmark.png"
          alt="일잇다"
          className="h-7 object-contain justify-self-center"
        />
        <div className="justify-self-end">
          {!fromManuals && (
            <button
              type="button"
              onClick={handleSkip}
              className="text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              나중에 할게요
            </button>
          )}
        </div>
      </header>

      <main
        className={`flex justify-center px-4 sm:px-6 py-12 min-h-[calc(100vh-4rem)] ${
          step === "upload" ? "items-center" : "items-start"
        }`}
      >
        <div className="w-full max-w-4xl">
          {/* 단계 표시 */}
          <ol className="mb-8 flex items-center justify-center gap-2 sm:gap-3" aria-label="진행 단계">
            {STEPS.map((label, index) => {
              const isDone = index < currentStepIndex;
              const isCurrent = index === currentStepIndex;
              return (
                <li key={label} className="flex items-center gap-2 sm:gap-3">
                  <span
                    aria-current={isCurrent ? "step" : undefined}
                    className={`flex items-center gap-2 text-sm font-semibold ${
                      isCurrent || isDone
                        ? "text-[var(--color-primary)]"
                        : "text-[var(--color-text-tertiary)]"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        isCurrent
                          ? "bg-[var(--color-primary)] text-white"
                          : isDone
                            ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                            : "border border-[var(--color-border)] bg-white"
                      }`}
                    >
                      {isDone ? <Check size={14} /> : index + 1}
                    </span>
                    {label}
                  </span>
                  {index < STEPS.length - 1 && (
                    <span className="h-px w-6 sm:w-10 bg-[var(--color-border)]" aria-hidden />
                  )}
                </li>
              );
            })}
          </ol>

          {step === "upload" ? (
            <>
              <div className="text-center mb-8 break-keep">
                {!fromManuals && (
                  <p className="mb-3 inline-block rounded-full bg-[var(--color-primary-light)] px-3 py-1 text-sm font-semibold text-[var(--color-primary)]">
                    가입을 환영해요!
                  </p>
                )}
                <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text-primary)] mb-3">
                  {fromManuals ? "매뉴얼 파일을 올려주세요" : "먼저 매장 매뉴얼을 올려볼까요?"}
                </h1>
                <p className="text-[var(--color-text-secondary)]">
                  업로드한 파일 내용을 분석해 매뉴얼 항목을 자동으로 정리해드려요.
                </p>
              </div>

              <div
                role="button"
                tabIndex={isAnalyzing ? -1 : 0}
                aria-busy={isAnalyzing}
                aria-disabled={isAnalyzing}
                aria-label="매뉴얼 파일 선택"
                onClick={openFilePicker}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openFilePicker();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
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
                  <Loader2 size={48} className="mb-5 animate-spin text-[var(--color-primary)]" />
                ) : (
                  <UploadCloud size={48} className="mb-5 text-[var(--color-primary)]" />
                )}
                <p className="text-lg sm:text-xl font-semibold text-[var(--color-text-primary)] mb-2">
                  {isAnalyzing ? "파일을 분석하고 있어요..." : "파일을 올려주세요."}
                </p>
                <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                  {isAnalyzing
                    ? "잠시만 기다려주세요."
                    : "클릭하거나 파일을 이 영역으로 드래그하세요."}
                </p>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  {SUPPORTED_EXTENSIONS.map((ext) => (
                    <span
                      key={ext}
                      className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-default)] px-3 py-1 text-xs font-medium text-[var(--color-text-secondary)]"
                    >
                      {ext}
                    </span>
                  ))}
                  <span className="text-xs text-[var(--color-text-tertiary)]">
                    · 최대 {MAX_UPLOAD_MB}MB · PDF는 준비 중
                  </span>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={SUPPORTED_EXTENSIONS.join(",")}
                  className="hidden"
                  disabled={isAnalyzing}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // 같은 파일을 다시 선택해도 change 이벤트가 발생하도록 초기화한다.
                    e.target.value = "";
                    if (file) {
                      handleFile(file);
                    }
                  }}
                />
              </div>

              {error && (
                <p className="mt-4 text-center text-sm text-[var(--color-status-error)] break-keep">
                  {error}
                </p>
              )}

              <p className="mt-6 text-center text-sm text-[var(--color-text-secondary)] break-keep">
                어떻게 만들어야 할지 모르겠다면{" "}
                <a
                  href="/templates/manual-template.xlsx"
                  download="일잇다_매뉴얼_양식.xlsx"
                  className="inline-flex items-center gap-1 font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
                >
                  <Download size={14} /> 엑셀 양식 받기
                </a>
              </p>
            </>
          ) : (
            <>
              <div className="text-center mb-8 break-keep">
                <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text-primary)] mb-3">
                  파일 내용을 정리했어요. 저장하기 전에 확인해 주세요.
                </h1>
                {preview && (
                  <div className="text-[var(--color-text-secondary)] space-y-1">
                    <p>세부 매뉴얼 {preview.totalDetailManualCount}개를 찾았습니다.</p>
                    <p>{preview.topCategoryCount}개의 항목으로 정리했습니다.</p>
                    <p className="font-semibold text-[var(--color-text-primary)]">
                      제목이나 분류가 다르면 여기서 바꿀 수 있어요.
                    </p>
                  </div>
                )}
              </div>

              <p role="status" aria-live="polite" className="sr-only">
                {isSaving ? "매뉴얼을 저장하고 있어요." : ""}
              </p>

              {preview && (
                <ManualPreviewEditor
                  preview={preview}
                  categoryLabels={categoryLabels}
                  manualEdits={manualEdits}
                  collapsedCategories={collapsedCategories}
                  onCategoryLabelChange={handleCategoryLabelChange}
                  onManualTitleChange={handleManualTitleChange}
                  onManualCategoryMove={handleManualCategoryMove}
                  onManualExcludeToggle={handleManualExcludeToggle}
                  onToggleCategoryCollapsed={toggleCategoryCollapsed}
                />
              )}

              {error && (
                <p role="alert" className="mt-4 text-center text-sm text-[var(--color-status-error)] break-keep">
                  {error}
                </p>
              )}

              <div className="flex flex-col-reverse sm:flex-row justify-center gap-3 mt-8">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={handleReupload}
                  disabled={isSaving}
                  className="w-full sm:w-auto px-8"
                >
                  다시 올리기
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  isLoading={isSaving}
                  disabled={isSaving}
                  onClick={handleSave}
                  className="w-full sm:w-auto px-12"
                >
                  세부 매뉴얼 {includedManualCount}개 저장하기
                </Button>
              </div>
            </>
          )}
        </div>
      </main>

      {/* 승인 전 정리 결과를 버리고 나갈 때 확인 모달 */}
      {pendingLeave && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setPendingLeave(null)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="leave-dialog-title"
            aria-describedby="leave-dialog-desc"
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl break-keep"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="leave-dialog-title" className="text-lg font-bold text-[var(--color-text-primary)] mb-2">
              {pendingLeave.title}
            </h2>
            <p id="leave-dialog-desc" className="text-sm text-[var(--color-text-secondary)] mb-6">
              아직 승인하지 않아서, 지금 나가면 정리하고 수정한 내용이 모두 사라져요.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setPendingLeave(null)}
                autoFocus
              >
                계속 작성하기
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => {
                  const { run } = pendingLeave;
                  setPendingLeave(null);
                  run();
                }}
              >
                나가기
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
