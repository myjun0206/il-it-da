import type { ManualGroupInput } from "@/lib/rag/save-manual-sections";
import { UNCLASSIFIED_KEY, UNCLASSIFIED_LABEL } from "@/lib/manuals/manual-category-rules";
import {
  MAX_CONFIRM_CATEGORY_LENGTH,
  MAX_CONFIRM_ITEM_CONTENT_LENGTH,
  MAX_CONFIRM_MANUAL_COUNT,
  MAX_CONFIRM_TITLE_LENGTH,
  MAX_CONFIRM_TOTAL_ITEM_COUNT,
} from "@/lib/manuals/upload-limits";

type ConfirmManualItemInput = {
  content?: unknown;
};

type ConfirmManualDetailInput = {
  title?: unknown;
  topCategoryLabel?: unknown;
  items?: unknown;
  excluded?: unknown;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Shared by both /api/manuals/preview/confirm (HQ) and /api/store-manuals/preview/confirm
 * (store owner) so the "what did the user actually confirm in the preview screen" parsing
 * rule lives in exactly one place. tempId/scopeType/classification are display-only preview
 * fields and are intentionally ignored here - only title/topCategoryLabel/items (and the
 * excluded flag) feed into the existing saveManualGroupsWithChunks contract.
 */
export function parseConfirmedManualGroups(manuals: unknown): ManualGroupInput[] | null {
  if (!Array.isArray(manuals) || manuals.length === 0 || manuals.length > MAX_CONFIRM_MANUAL_COUNT) {
    return null;
  }

  const groups: ManualGroupInput[] = [];
  let totalItemCount = 0;

  for (const raw of manuals as ConfirmManualDetailInput[]) {
    if (raw?.excluded === true) {
      continue;
    }

    const topic = getString(raw?.title);
    const rawCategory = getString(raw?.topCategoryLabel);

    if (!topic || !rawCategory || !Array.isArray(raw?.items)) {
      return null;
    }

    if (topic.length > MAX_CONFIRM_TITLE_LENGTH || rawCategory.length > MAX_CONFIRM_CATEGORY_LENGTH) {
      return null;
    }

    // 내부 분류 키가 그대로 들어오면 DB에는 사용자용 라벨로만 저장한다.
    const category = rawCategory.toLowerCase() === UNCLASSIFIED_KEY ? UNCLASSIFIED_LABEL : rawCategory;

    const items = (raw.items as ConfirmManualItemInput[])
      .map((item) => getString(item?.content))
      .filter((content): content is string => Boolean(content));

    if (items.length === 0 || items.some((content) => content.length > MAX_CONFIRM_ITEM_CONTENT_LENGTH)) {
      return null;
    }

    totalItemCount += items.length;
    if (totalItemCount > MAX_CONFIRM_TOTAL_ITEM_COUNT) {
      return null;
    }

    groups.push({ category, topic, items });
  }

  return groups.length > 0 ? groups : null;
}
