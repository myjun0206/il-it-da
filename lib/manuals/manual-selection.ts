import { getNumberedManualItemHeading, splitTextIntoManualItems } from "@/lib/manuals/detect-manual-item";
import { STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT } from "@/lib/manuals/constants";
import type { ManualRecord } from "@/lib/types/manual";

export type ManualSelectionOption = {
  manual: ManualRecord;
  title: string;
  parentTitle: string | null;
  label: string;
};

export function buildManualSelectionGroups(rows: ManualRecord[], storeId: string) {
  const scoped = rows.filter((manual) => manual.store_id === storeId);
  const byId = new Map(scoped.map((manual) => [manual.id, manual]));
  const parentIds = new Set(scoped.map((manual) => manual.parent_manual_id).filter(Boolean));
  const groups = new Map<string, { id: string; label: string; options: ManualSelectionOption[] }>();

  for (const manual of scoped) {
    if (parentIds.has(manual.id) || (!manual.parent_manual_id && manual.status === "draft"
      && manual.content === STORE_MANUAL_CATEGORY_PLACEHOLDER_CONTENT)) continue;
    const parent = manual.parent_manual_id ? byId.get(manual.parent_manual_id) : null;
    const firstItem = splitTextIntoManualItems(manual.content)[0];
    const title = getNumberedManualItemHeading(manual.content)
      || (parent && manual.title === parent.title ? firstItem?.split(/\r?\n/)[0]?.trim() : manual.title)
      || manual.title;
    const parentTitle = parent?.title ?? null;
    const category = manual.category?.trim() || "미분류";
    const groupId = parent?.id ?? `standalone:${category}`;
    const label = parentTitle ? `${title} · ${parentTitle}` : title;
    if (!groups.has(groupId)) groups.set(groupId, {
      id: groupId,
      label: parentTitle ? `${category} · ${parentTitle}` : `${category} · 개별 매뉴얼`,
      options: [],
    });
    groups.get(groupId)!.options.push({ manual, title, parentTitle, label });
  }

  const options = [...groups.values()].flatMap((group) => group.options);
  const labelCounts = new Map<string, number>();
  for (const option of options) labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1);
  for (const option of options) {
    if ((labelCounts.get(option.label) ?? 0) > 1) {
      option.title = `${option.title} · ID ${option.manual.id}`;
    }
  }
  for (const option of options) option.label = option.parentTitle ? `${option.title} · ${option.parentTitle}` : option.title;
  return [...groups.values()];
}