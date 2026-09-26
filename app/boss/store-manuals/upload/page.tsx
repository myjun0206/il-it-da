"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, Loader2, ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/common/Button";
import { ManualPreviewEditor, type ManualEditState } from "@/components/manuals/ManualPreviewEditor";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedProfile } from "@/lib/auth/client-profile";
import { MAX_UPLOAD_FILE_SIZE_BYTES, isFileSizeWithinLimit } from "@/lib/manuals/upload-limits";
import { buildConfirmedManualsPayload, type ManualUploadPreview } from "@/lib/manuals/build-manual-preview";

type Step = "upload" | "review";

// 화면에 보여주는 지원 형식. input accept 값과 반드시 일치시킨다.
const SUPPORTED_EXTENSIONS = [".txt", ".md", ".docx", ".csv", ".xlsx", ".xls"];
const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_FILE_SIZE_BYTES / (1024 * 1024));

// 지점 매뉴얼 관리 화면(app/boss/store-manuals/page.tsx)과 같은 키를 사용한다.
const STORE_MANUAL_NOTICE_KEY = "ilitda:store-manual-upload-notice";

const STEPS = ["파일 올리기", "내용 확인", "저장"] as const;

function setUploadNotice(message: string) {
  try {
    sessionStorage.setItem(STORE_MANUAL_NOTICE_KEY, message);
  } catch {
    // 저장소를 쓸 수 없는 환경이면 알림 없이 이동한다.
  }
}

/**
 * 점주용 매뉴얼 미리보기 업로드 화면. HQ 화면(app/hq/manuals/onboarding)과 같은 파싱·분류·
 * 미리보기 편집 컴포넌트(ManualPreviewEditor)를 그대로 재사용하되, storeId는 서버가
 * requireStoreOwner로 재검증한 값만 신뢰한다 - 이 화면은 sessionStorage의 storeId를 그냥
 * "표시용 후보"로만 쓰고, 실제 접근 가능 여부는 /api/store-manuals/preview 응답(403 여부)으로
 * 판단한다.
 */
export default function StoreManualUploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isLeavingRef = useRef(false);
  const isSubmittingRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [userName, setUserName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeId, setStoreId] = useState("");
  const [step, setStep] = useState<Step>("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [preview, setPreview] = useState<ManualUploadPreview | null>(null);
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});
  const [manualEdits, setManualEdits] = useState<Record<string, ManualEditState>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [pendingLeave, setPendingLeave] = useState<{ title: string; run: () => void } | null>(null);

  useEffect(() => {
    const checkAuthAndStore = async () => {
      try {
        const supabase = createClient();
        const profile = await getAuthenticatedProfile(supabase);

        if (profile?.role !== "owner") {
          router.push("/");
          return;
        }
        if (profile.approvalStatus !== "approved") {
          router.push("/signup/approval-status");
          return;
        }

        const name = profile.user.user_metadata?.name || "점주";
        setUserName(name);

        const storedStoreId = sessionStorage.getItem("selectedStoreId") || "";
        const storedStoreName = sessionStorage.getItem("selectedStoreName") || "";

        const response = await fetch("/api/signup/store-membership", { credentials: "include" });
        const result = (await response.json()) as {
          data?: Array<{ storeId: string; storeName: string; status: string; role: string }>;
        };
        const approvedStores = (result.data ?? []).filter((m) => m.status === "approved" && m.role === "owner");

        if (approvedStores.length === 0) {
          setError("승인된 지점이 없습니다.");
          setIsReady(true);
          return;
        }

        const matched = approvedStores.find((s) => s.storeId === storedStoreId);
        if (matched) {
          setStoreId(matched.storeId);
          setStoreName(storedStoreName || matched.storeName);
        } else {
          setStoreId(approvedStores[0].storeId);
          setStoreName(approvedStores[0].storeName);
        }

        setIsReady(true);
      } catch (e) {
        console.error("점주 인증/지점 확인 실패:", e);
        router.push("/");
      }
    };

    checkAuthAndStore();
  }, [router]);

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

  const confirmIfUnsaved = (title: string, run: () => void) => {
    if (step === "review" && !isSaving) {
      setPendingLeave({ title, run });
      return;
    }
    run();
  };

  const handleFile = useCallback(
    async (file: File) => {
      if (isAnalyzing || !storeId) return;

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

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("storeId", storeId);

        const response = await fetch("/api/store-manuals/preview", {
          method: "POST",
          body: formData,
        });
        const data = (await response.json()) as { preview?: ManualUploadPreview; error?: string };

        if (!response.ok || !data.preview) {
          throw new Error(data.error || "파일을 분석하는 중 오류가 발생했습니다.");
        }

        const nextPreview = data.preview;
        setPreview(nextPreview);
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
    [isAnalyzing, storeId],
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
    if (file) handleFile(file);
  };

  const resetToUpload = () => {
    setPreview(null);
    setCategoryLabels({});
    setManualEdits({});
    setCollapsedCategories(new Set());
    setError("");
    setStep("upload");
  };

  const handleBack = () => confirmIfUnsaved("지점 매뉴얼 관리로 돌아갈까요?", () => leaveTo("/boss/store-manuals"));
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
    if (!preview || !storeId || isSubmittingRef.current) return;

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
      const response = await fetch("/api/store-manuals/preview/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, manuals: payloadManuals }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "매뉴얼 저장 중 오류가 발생했습니다.");
      }

      setUploadNotice(`세부 매뉴얼 ${includedCount}개를 저장했어요. 검색 준비 상태를 확인해 주세요.`);
      isLeavingRef.current = true;
      router.replace("/boss/store-manuals");
    } catch (e) {
      setError(e instanceof Error ? e.message : "매뉴얼 저장 중 오류가 발생했습니다.");
      setIsSaving(false);
      isSubmittingRef.current = false;
    }
  };

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
    } catch (e) {
      console.error("Logout failed:", e);
      router.push("/");
    }
  };

  if (!isReady) {
    return null;
  }

  const currentStepIndex = step === "upload" ? 0 : 1;
  const includedManualCount = preview
    ? preview.manuals.filter((manual) => !(manualEdits[manual.tempId]?.excluded ?? false)).length
    : 0;

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <OwnerSidebar activeMenu="manual-store" onLogout={handleLogout} />

      <div className="lg:ml-[240px]">
        <OwnerHeader userName={userName} storeName={storeName} />

        <main className="p-6 lg:p-8 max-w-4xl mx-auto">
          <button
            type="button"
            onClick={handleBack}
            className="mb-6 flex items-center gap-1 text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <ArrowLeft size={16} /> 지점 매뉴얼 관리
          </button>

          <ol className="mb-8 flex items-center justify-center gap-2 sm:gap-3" aria-label="진행 단계">
            {STEPS.map((label, index) => {
              const isDone = index < currentStepIndex;
              const isCurrent = index === currentStepIndex;
              return (
                <li key={label} className="flex items-center gap-2 sm:gap-3">
                  <span
                    aria-current={isCurrent ? "step" : undefined}
                    className={`flex items-center gap-2 text-sm font-semibold ${
                      isCurrent || isDone ? "text-[var(--color-primary)]" : "text-[var(--color-text-tertiary)]"
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
                <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text-primary)] mb-3">
                  {storeName || "우리 지점"} 매뉴얼 파일을 올려주세요
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
                  {isAnalyzing ? "잠시만 기다려주세요." : "클릭하거나 파일을 이 영역으로 드래그하세요."}
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
                    e.target.value = "";
                    if (file) handleFile(file);
                  }}
                />
              </div>

              {error && (
                <p role="alert" className="mt-4 text-center text-sm text-[var(--color-status-error)] break-keep">
                  {error}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="text-center mb-8 break-keep">
                <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text-primary)] mb-3">
                  매뉴얼을 정리했어요
                </h1>
                {preview && (
                  <div className="text-[var(--color-text-secondary)] space-y-1">
                    <p>세부 매뉴얼 {preview.totalDetailManualCount}개를 찾았습니다.</p>
                    <p>{preview.topCategoryCount}개의 항목으로 정리했습니다.</p>
                    <p className="font-semibold text-[var(--color-text-primary)]">
                      내용을 확인한 후 저장해 주세요.
                    </p>
                  </div>
                )}
              </div>

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
        </main>
      </div>

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
              아직 저장하지 않아서, 지금 나가면 정리하고 수정한 내용이 모두 사라져요.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPendingLeave(null)} autoFocus>
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
