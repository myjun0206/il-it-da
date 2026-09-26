import type { AnalyzedManualGroup } from "@/lib/manuals/analyze-manual-with-ai";
import { classifyManualGroups, type ManualClassificationMethod } from "@/lib/manuals/manual-category-rules";

export interface PreviewManualItem {
  /** Only valid inside this preview response - never a real manuals.id / DB UUID. */
  tempId: string;
  title: string;
  content: string;
}

export interface PreviewManualDetail {
  /** Only valid inside this preview response - never a real manuals.id / DB UUID. */
  tempId: string;
  title: string;
  originalCategory: string;
  topCategoryTempId: string;
  topCategoryLabel: string;
  scopeType: "hq" | "store";
  classification: ManualClassificationMethod;
  warnings: string[];
  items: PreviewManualItem[];
  /** Display-only join of `items` for a simple read view; never re-parsed back into items. */
  content: string;
  /** true = user chose to skip this detail manual at save time (default false). */
  excluded: boolean;
}

export interface PreviewTopCategory {
  /** Only valid inside this preview response - never a real DB id. */
  tempId: string;
  label: string;
  manualCount: number;
}

export interface ManualUploadPreview {
  totalDetailManualCount: number;
  topCategoryCount: number;
  categories: PreviewTopCategory[];
  manuals: PreviewManualDetail[];
  warnings: string[];
}

export interface BuildManualPreviewContext {
  /** Presence of a storeId means this upload will save as scope_type "store"; absence means "hq". */
  storeId?: string | null;
}

const NO_CONTENT_WARNING = "본문 내용이 비어 있어요. 저장 전에 내용을 입력해주세요.";
const UNCLASSIFIED_WARNING = "자동으로 분류하지 못했어요. 어울리는 항목으로 직접 옮겨주세요.";

/**
 * Builds the preview DTO shown to the HQ user before anything is written to Supabase.
 * Pure function: takes already-parsed groups (see lib/manuals/extract-manual-groups.ts) and
 * already-classified categories (see lib/manuals/manual-category-rules.ts) and only reshapes
 * them for display - it never calls Supabase/OpenAI and never mutates title/content/items.
 */
export function buildManualPreview(
  groups: readonly AnalyzedManualGroup[],
  context: BuildManualPreviewContext = {},
): ManualUploadPreview {
  const scopeType: "hq" | "store" = context.storeId ? "store" : "hq";
  const classified = classifyManualGroups(groups);

  const categoryOrder: string[] = [];
  const categoryTempIdByKey = new Map<string, string>();
  const manualCountByKey = new Map<string, number>();
  const labelByKey = new Map<string, string>();

  classified.forEach((group) => {
    if (!categoryTempIdByKey.has(group.topCategoryKey)) {
      const tempId = `preview-category-${categoryOrder.length}`;
      categoryTempIdByKey.set(group.topCategoryKey, tempId);
      labelByKey.set(group.topCategoryKey, group.topCategoryLabel);
      categoryOrder.push(group.topCategoryKey);
    }
    manualCountByKey.set(group.topCategoryKey, (manualCountByKey.get(group.topCategoryKey) ?? 0) + 1);
  });

  const categories: PreviewTopCategory[] = categoryOrder.map((key) => ({
    tempId: categoryTempIdByKey.get(key) as string,
    label: labelByKey.get(key) as string,
    manualCount: manualCountByKey.get(key) ?? 0,
  }));

  const manualWarnings: string[] = [];

  const manuals: PreviewManualDetail[] = classified.map((group, index) => {
    const items: PreviewManualItem[] = group.items.map((content, itemIndex) => ({
      tempId: `preview-item-${index}-${itemIndex}`,
      title: group.topic,
      content,
    }));

    const warnings: string[] = [];
    if (group.classification === "unclassified") {
      warnings.push(UNCLASSIFIED_WARNING);
    }
    if (items.length === 0 || items.every((item) => !item.content.trim())) {
      warnings.push(NO_CONTENT_WARNING);
    }
    manualWarnings.push(...warnings);

    return {
      tempId: `preview-manual-${index}`,
      title: group.topic,
      originalCategory: group.category,
      topCategoryTempId: categoryTempIdByKey.get(group.topCategoryKey) as string,
      topCategoryLabel: group.topCategoryLabel,
      scopeType,
      classification: group.classification,
      warnings,
      items,
      content: items.map((item) => item.content).join("\n\n"),
      excluded: false,
    };
  });

  return {
    totalDetailManualCount: manuals.length,
    topCategoryCount: categories.length,
    categories,
    manuals,
    warnings: manualWarnings,
  };
}

export interface PreviewManualEdit {
  title?: string;
  topCategoryTempId?: string;
  excluded?: boolean;
}

export interface ConfirmedManualPayload {
  title: string;
  topCategoryLabel: string;
  items: { content: string }[];
  excluded: boolean;
}

/**
 * Shared by the HQ and store preview screens: turns the preview plus the user's edits
 * (category renames, moves between categories, title edits, exclusions) into the confirm
 * request body. tempIds are resolved to labels here and never sent to the server.
 */
export function buildConfirmedManualsPayload(
  preview: Pick<ManualUploadPreview, "manuals">,
  categoryLabels: Readonly<Record<string, string>>,
  manualEdits: Readonly<Record<string, PreviewManualEdit | undefined>>,
): ConfirmedManualPayload[] {
  return preview.manuals.map((manual) => {
    const edit = manualEdits[manual.tempId];
    const topCategoryTempId = edit?.topCategoryTempId ?? manual.topCategoryTempId;
    return {
      title: (edit?.title ?? manual.title).trim(),
      topCategoryLabel: (categoryLabels[topCategoryTempId] ?? manual.topCategoryLabel).trim(),
      items: manual.items.map((item) => ({ content: item.content })),
      excluded: edit?.excluded ?? false,
    };
  });
}
