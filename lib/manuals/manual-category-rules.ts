import type { AnalyzedManualGroup } from "@/lib/manuals/analyze-manual-with-ai";

// Single source of truth for "raw title/category -> user-facing top category" classification.
// docs/manual-category-taxonomy.md and tests/fixtures/manual-categories/m-coffee-common-taxonomy.json
// describe this same contract in prose/data form; tests/manuals/manual-category-rules.test.ts
// cross-checks this module against that fixture so the two can never silently drift apart.
//
// This module is 100% deterministic, rule-based, and calls no AI/OpenAI/Vision/OCR API.

export type ManualClassificationMethod = "dynamic_category" | "unclassified";

export interface ClassifiedManualGroup extends AnalyzedManualGroup {
  /** Stable machine key for the resolved top category (e.g. "opening_closing"), or "unclassified". */
  topCategoryKey: string;
  /** User-facing Korean label for the resolved top category (never "UNCLASSIFIED" literally). */
  topCategoryLabel: string;
  classification: ManualClassificationMethod;
}

const UNCLASSIFIED_KEY = "unclassified";
const UNCLASSIFIED_LABEL = "분류 확인 필요";

// Categories are supplied by the uploaded data. This export remains for API compatibility;
// it is intentionally empty so no fixed category list can constrain Excel uploads.
const CATEGORY_DEFINITIONS: ReadonlyArray<{ key: string; label: string }> = [];

function dynamicCategoryKey(category: string): string {
  return `category:${category.normalize("NFC").replace(/\s+/g, " ").toLocaleLowerCase("ko-KR")}`;
}

function classifyOne(group: AnalyzedManualGroup): { key: string; method: ManualClassificationMethod } {
  const rawCategory = group.category.trim();

  if (rawCategory) {
    return { key: dynamicCategoryKey(rawCategory), method: "dynamic_category" };
  }

  return { key: UNCLASSIFIED_KEY, method: "unclassified" };
}

/**
 * Classifies each parsed manual group (one group = one detail manual: a parent/topic card plus
 * its child items) into a user-facing top category. Deterministic and side-effect free: the
 * same input always produces the same output, and no group is ever assigned to more than one
 * top category. Titles/content are never modified, summarized, or merged across groups.
 */
export function classifyManualGroups(groups: readonly AnalyzedManualGroup[]): ClassifiedManualGroup[] {
  return groups.map((group) => {
    const { key, method } = classifyOne(group);
    return {
      ...group,
      topCategoryKey: key,
      topCategoryLabel: group.category.trim() || UNCLASSIFIED_LABEL,
      classification: method,
    };
  });
}

export function isUnclassified(group: Pick<ClassifiedManualGroup, "topCategoryKey">): boolean {
  return group.topCategoryKey === UNCLASSIFIED_KEY;
}

export { CATEGORY_DEFINITIONS, UNCLASSIFIED_KEY, UNCLASSIFIED_LABEL };
