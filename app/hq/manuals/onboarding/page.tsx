"use client";

import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { createClient } from "@/lib/supabase/client";
import type { ManualSectionDraft } from "@/lib/types/manual";

type Step = "upload" | "review";

// 실제 AI 분석 대신, 업로드한 텍스트를 문단 단위로 나눠 대주제/소주제 초안을 만드는 간단한 규칙 기반 파서.
async function analyzeManualFile(file: File): Promise<ManualSectionDraft[]> {
  let text = "";

  try {
    text = await file.text();
  } catch {
    text = "";
  }

  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (paragraphs.length === 0) {
    return [
      {
        id: crypto.randomUUID(),
        category: "화장실",
        title: "청소 관리법",
        content: "여기에 매뉴얼 내용을 입력해주세요.",
      },
    ];
  }

  return paragraphs.map((paragraph, index) => {
    const [firstLine, ...rest] = paragraph.split(/\r?\n/);
    return {
      id: crypto.randomUUID(),
      category: `구역 ${index + 1}`,
      title: (firstLine || `항목 ${index + 1}`).slice(0, 40),
      content: rest.join("\n").trim() || paragraph,
    };
  });
}

export default function ManualOnboardingPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sections, setSections] = useState<ManualSectionDraft[]>([]);
  const [groupTopic, setGroupTopic] = useState("");
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();

      if (!data.session?.user || data.session.user.user_metadata?.role !== "hq") {
        router.push("/");
      }
    };

    checkAuth();
  }, [router]);

  const handleFile = useCallback(
    async (file: File) => {
      setError("");

      const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();

      // 엑셀/CSV는 이미 행 구조화된 데이터라 서버에서 바로 파싱/저장하고 대시보드로 돌아간다.
      if (extension === ".xlsx" || extension === ".xls" || extension === ".csv") {
        setIsAnalyzing(true);

        try {
          const formData = new FormData();
          formData.append("file", file);

          const response = await fetch("/api/manuals/upload", {
            method: "POST",
            body: formData,
          });
          const data = (await response.json()) as { error?: string };

          if (!response.ok) {
            throw new Error(data.error || "파일을 분석하는 중 오류가 발생했습니다.");
          }

          router.push("/hq/manuals");
        } catch (e) {
          setError(e instanceof Error ? e.message : "파일을 분석하는 중 오류가 발생했습니다.");
        } finally {
          setIsAnalyzing(false);
        }

        return;
      }

      setIsAnalyzing(true);

      try {
        const parsed = await analyzeManualFile(file);
        setSections(parsed);
        setGroupTopic(file.name.replace(/\.[^/.]+$/, "") || "업로드 매뉴얼");
        setStep("review");
      } catch {
        setError("파일을 분석하는 중 오류가 발생했습니다.");
      } finally {
        setIsAnalyzing(false);
      }
    },
    [router],
  );

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleSkip = () => {
    router.push("/hq/manuals");
  };

  const handleSectionChange = (id: string, field: keyof ManualSectionDraft, value: string) => {
    setSections((prev) =>
      prev.map((section) => (section.id === id ? { ...section, [field]: value } : section)),
    );
  };

  const handleRemoveSection = (id: string) => {
    setSections((prev) => prev.filter((section) => section.id !== id));
  };

  const handleAddSection = () => {
    setSections((prev) => [
      ...prev,
      { id: crypto.randomUUID(), category: "", title: "", content: "" },
    ]);
  };

  const handleApprove = async () => {
    setError("");

    if (!groupTopic.trim()) {
      setError("매뉴얼 주제를 입력해주세요.");
      return;
    }

    if (sections.length === 0) {
      setError("승인할 매뉴얼 항목이 없습니다.");
      return;
    }

    const invalid = sections.some((s) => !s.content.trim());
    if (invalid) {
      setError("모든 항목의 내용을 입력해주세요.");
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/manuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: groupTopic,
          items: sections.map((s) => s.content),
        }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "매뉴얼 저장 중 오류가 발생했습니다.");
      }

      router.push("/hq/manuals");
    } catch (e) {
      setError(e instanceof Error ? e.message : "매뉴얼 저장 중 오류가 발생했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <header className="flex items-center justify-between px-6 h-16 border-b border-[var(--color-border)] bg-white">
        <button
          onClick={handleSkip}
          className="text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          사용 안하기
        </button>
        <img src="/logo/ilitda-wordmark.png" alt="일잇다" className="h-7 object-contain" />
        <div className="w-20" />
      </header>

      <main className="flex items-center justify-center px-4 py-16">
        {step === "upload" ? (
          <div className="w-full max-w-xl">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                매뉴얼 파일을 올려주세요
              </h1>
              <p className="text-[var(--color-text-secondary)]">
                업로드한 파일 내용을 분석해 매뉴얼 항목을 자동으로 정리해드려요.
              </p>
            </div>

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`bg-white rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition-colors shadow-sm ${
                isDragging
                  ? "border-[var(--color-primary)] bg-[var(--color-bg-surface)]"
                  : "border-[var(--color-border)] hover:border-[var(--color-primary)]"
              }`}
            >
              <UploadCloud size={40} className="mx-auto mb-4 text-[var(--color-primary)]" />
              <p className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                {isAnalyzing ? "분석 중입니다..." : "파일을 올려주세요."}
              </p>
              <p className="text-sm text-[var(--color-text-secondary)]">
                클릭하거나 파일을 이 영역으로 드래그하세요. (텍스트, .xlsx, .csv 지원)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleFile(file);
                  }
                }}
              />
            </div>

            {error && (
              <p className="mt-4 text-center text-sm text-[var(--color-status-error)]">{error}</p>
            )}
          </div>
        ) : (
          <div className="w-full max-w-3xl">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                메뉴얼 정리를 하였습니다.
              </h1>
              <p className="text-[var(--color-text-secondary)]">
                아래 내용을 확인하고 필요한 부분을 직접 수정해주세요.
              </p>
            </div>

            <div className="bg-white rounded-xl border border-[var(--color-border)] shadow-sm p-6 space-y-6">
              <Input
                label="매뉴얼 주제"
                placeholder="예: 매장 운영 매뉴얼"
                value={groupTopic}
                onChange={(e) => setGroupTopic(e.target.value)}
              />

              {sections.map((section, index) => (
                <div
                  key={section.id}
                  className="border border-[var(--color-border)] rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <label className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
                        내용 {index + 1}
                      </label>
                      <textarea
                        value={section.content}
                        onChange={(e) => handleSectionChange(section.id, "content", e.target.value)}
                        rows={4}
                        className="w-full px-4 py-3 rounded-lg border-2 border-[var(--color-border)] text-base text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary-accent)] focus:ring-2 focus:ring-[var(--color-primary-accent)]/30"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveSection(section.id)}
                      className="mt-8 p-2 rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-status-error)] hover:bg-red-50 transition-colors"
                      aria-label="항목 삭제"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={handleAddSection}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed border-[var(--color-border)] text-sm font-semibold text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
              >
                <Plus size={16} /> 내용 항목 추가
              </button>
            </div>

            {error && (
              <p className="mt-4 text-center text-sm text-[var(--color-status-error)]">{error}</p>
            )}

            <div className="flex justify-center mt-8">
              <Button
                variant="primary"
                size="lg"
                isLoading={isSaving}
                onClick={handleApprove}
                className="w-full sm:w-auto px-12"
              >
                승인
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
