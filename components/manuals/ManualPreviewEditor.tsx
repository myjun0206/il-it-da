"use client";

import React from "react";
import { ChevronDown, ChevronUp, AlertTriangle, Ban, RotateCcw } from "lucide-react";
import type { ManualUploadPreview } from "@/lib/manuals/build-manual-preview";

// 미리보기 화면 안에서만 쓰는 편집 상태. tempId는 DB id가 아니다.
export type ManualEditState = { title: string; topCategoryTempId: string; excluded: boolean };

export interface ManualPreviewEditorProps {
  preview: ManualUploadPreview;
  categoryLabels: Record<string, string>;
  manualEdits: Record<string, ManualEditState>;
  collapsedCategories: Set<string>;
  onCategoryLabelChange: (tempId: string, value: string) => void;
  onManualTitleChange: (tempId: string, value: string) => void;
  onManualCategoryMove: (tempId: string, topCategoryTempId: string) => void;
  onManualExcludeToggle: (tempId: string) => void;
  onToggleCategoryCollapsed: (tempId: string) => void;
}

/**
 * 상위 카테고리별로 세부 매뉴얼을 접기/펼치기, 이름/제목 수정, 카테고리 이동, 제외/복구를
 * 할 수 있는 미리보기 편집 UI. HQ(app/hq/manuals/onboarding)와 점주
 * (app/boss/store-manuals/upload) 업로드 화면이 이 컴포넌트를 그대로 공유한다 - 인증/저장
 * 경계는 각 페이지가 각자 책임지고, 이 컴포넌트는 이미 받은 preview를 화면에 그리고
 * 편집 이벤트만 위로 올려보낸다(자체적으로 API를 호출하지 않는다).
 */
export function ManualPreviewEditor({
  preview,
  categoryLabels,
  manualEdits,
  collapsedCategories,
  onCategoryLabelChange,
  onManualTitleChange,
  onManualCategoryMove,
  onManualExcludeToggle,
  onToggleCategoryCollapsed,
}: ManualPreviewEditorProps) {
  return (
    <div className="space-y-4">
      {preview.categories.map((category) => {
        const manualsInCategory = preview.manuals.filter(
          (manual) => (manualEdits[manual.tempId]?.topCategoryTempId ?? manual.topCategoryTempId) === category.tempId,
        );
        const isCollapsed = collapsedCategories.has(category.tempId);
        const isUnclassified = manualsInCategory.some((manual) => manual.classification === "unclassified");

        return (
          <section
            key={category.tempId}
            className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${
              isUnclassified ? "border-[var(--color-status-error)]" : "border-[var(--color-border)]"
            }`}
          >
            <div className="flex items-center gap-3 p-4 sm:p-5 border-b border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => onToggleCategoryCollapsed(category.tempId)}
                aria-expanded={!isCollapsed}
                aria-label={`${categoryLabels[category.tempId] ?? category.label} 그룹 ${isCollapsed ? "펼치기" : "접기"}`}
                className="p-2 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-default)] transition-colors"
              >
                {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
              </button>

              {isUnclassified && (
                <AlertTriangle size={20} className="shrink-0 text-[var(--color-status-error)]" aria-hidden />
              )}

              <label className="sr-only" htmlFor={`category-label-${category.tempId}`}>
                카테고리 이름
              </label>
              <input
                id={`category-label-${category.tempId}`}
                type="text"
                value={categoryLabels[category.tempId] ?? category.label}
                onChange={(e) => onCategoryLabelChange(category.tempId, e.target.value)}
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border-2 border-transparent bg-transparent text-lg font-bold text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary-accent)] focus:bg-white"
              />

              <span className="shrink-0 text-sm font-medium text-[var(--color-text-tertiary)]">
                {manualsInCategory.length}개
              </span>
            </div>

            {!isCollapsed && (
              <div className="p-4 sm:p-5 space-y-4">
                {manualsInCategory.map((manual) => {
                  const edit = manualEdits[manual.tempId];
                  const isExcluded = edit?.excluded ?? false;
                  return (
                    <div
                      key={manual.tempId}
                      className={`border rounded-lg p-4 space-y-3 ${
                        isExcluded
                          ? "border-dashed border-[var(--color-text-tertiary)] opacity-60"
                          : "border-[var(--color-border)]"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="sr-only" htmlFor={`manual-title-${manual.tempId}`}>
                          세부 매뉴얼 제목
                        </label>
                        <input
                          id={`manual-title-${manual.tempId}`}
                          type="text"
                          value={edit?.title ?? manual.title}
                          onChange={(e) => onManualTitleChange(manual.tempId, e.target.value)}
                          disabled={isExcluded}
                          className="flex-1 min-w-0 px-4 py-3 rounded-lg border-2 border-[var(--color-border)] text-base font-semibold text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary-accent)] focus:ring-2 focus:ring-[var(--color-primary-accent)]/30 disabled:bg-[var(--color-bg-default)]"
                        />

                        <button
                          type="button"
                          onClick={() => onManualExcludeToggle(manual.tempId)}
                          aria-pressed={isExcluded}
                          aria-label={isExcluded ? "이 항목 다시 포함하기" : "이 항목 저장에서 빼기"}
                          className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-default)] transition-colors"
                        >
                          {isExcluded ? <RotateCcw size={16} /> : <Ban size={16} />}
                          {isExcluded ? "다시 포함" : "제외"}
                        </button>
                      </div>

                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        원래 분류: {manual.originalCategory || "없음"}
                      </p>

                      <div>
                        <label
                          className="mb-1 block text-xs font-semibold text-[var(--color-text-secondary)]"
                          htmlFor={`manual-move-${manual.tempId}`}
                        >
                          항목 위치
                        </label>
                        <select
                          id={`manual-move-${manual.tempId}`}
                          value={edit?.topCategoryTempId ?? manual.topCategoryTempId}
                          onChange={(e) => onManualCategoryMove(manual.tempId, e.target.value)}
                          disabled={isExcluded}
                          className="w-full px-4 py-3 rounded-lg border-2 border-[var(--color-border)] text-base text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary-accent)] focus:ring-2 focus:ring-[var(--color-primary-accent)]/30 disabled:bg-[var(--color-bg-default)]"
                        >
                          {preview.categories.map((option) => (
                            <option key={option.tempId} value={option.tempId}>
                              {categoryLabels[option.tempId] ?? option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {manual.warnings.length > 0 && (
                        <div
                          role="status"
                          className="flex items-start gap-2 rounded-lg border border-[var(--color-status-error)] bg-red-50 p-3 text-sm text-[var(--color-status-error)]"
                        >
                          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
                          <span>{manual.warnings.join(" ")}</span>
                        </div>
                      )}

                      <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap break-keep">
                        {manual.content || "(내용 없음)"}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
