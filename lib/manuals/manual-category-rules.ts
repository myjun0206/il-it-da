import type { AnalyzedManualGroup } from "@/lib/manuals/analyze-manual-with-ai";

// Single source of truth for "raw title/category -> user-facing top category" classification.
// docs/manual-category-taxonomy.md and tests/fixtures/manual-categories/m-coffee-common-taxonomy.json
// describe this same contract in prose/data form; tests/manuals/manual-category-rules.test.ts
// cross-checks this module against that fixture so the two can never silently drift apart.
//
// This module is 100% deterministic, rule-based, and calls no AI/OpenAI/Vision/OCR API.

export type ManualClassificationMethod = "exact_title" | "existing_category" | "keyword" | "unclassified";

export interface ClassifiedManualGroup extends AnalyzedManualGroup {
  /** Stable machine key for the resolved top category (e.g. "opening_closing"), or "unclassified". */
  topCategoryKey: string;
  /** User-facing Korean label for the resolved top category (never "UNCLASSIFIED" literally). */
  topCategoryLabel: string;
  classification: ManualClassificationMethod;
}

const UNCLASSIFIED_KEY = "unclassified";
const UNCLASSIFIED_LABEL = "분류 확인 필요";

// The 6 top categories are DATA, not a hard limit - adding a 7th category later only means
// adding another entry here plus matching rules below, never changing this module's contract.
const CATEGORY_DEFINITIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "store_operations_staff", label: "매장 운영 및 직원 업무" },
  { key: "opening_closing", label: "오픈 및 마감" },
  { key: "ordering_payment_customer_service", label: "주문·결제 및 고객 응대" },
  { key: "menu_recipe", label: "메뉴 제조 및 레시피" },
  { key: "inventory_ordering_equipment", label: "재고·발주 및 장비" },
  { key: "hygiene_safety_emergency", label: "위생·안전 및 비상 대응" },
];

const LABEL_BY_KEY = new Map(CATEGORY_DEFINITIONS.map((def) => [def.key, def.label]));

function labelForKey(key: string): string {
  return LABEL_BY_KEY.get(key) ?? UNCLASSIFIED_LABEL;
}

// Priority 1: exact title match. Seeded with the M Coffee common-manual taxonomy
// (tests/fixtures/manual-categories/m-coffee-common-taxonomy.json) - the 19 titles there must
// map onto these same 6 keys with no omission and no duplication.
const EXACT_TITLE_RULES: ReadonlyMap<string, string> = new Map([
  ["프랜차이즈 매뉴얼 적용 원칙", "store_operations_staff"],
  ["신규 직원 업무 안내", "store_operations_staff"],
  ["교대 및 인수인계", "store_operations_staff"],
  ["교대 인수인계 체크리스트", "store_operations_staff"],
  ["오픈 운영", "opening_closing"],
  ["마감 운영", "opening_closing"],
  ["고객 응대 및 주문 처리", "ordering_payment_customer_service"],
  ["POS 및 결제 관리", "ordering_payment_customer_service"],
  ["환불·취소·보상 처리 기준", "ordering_payment_customer_service"],
  ["주문·포장·픽업 처리", "ordering_payment_customer_service"],
  ["쿠폰·포인트·프로모션 관리", "ordering_payment_customer_service"],
  ["분실물 및 고객 물품 대응", "ordering_payment_customer_service"],
  ["음료 제조 및 레시피 관리", "menu_recipe"],
  ["재고 관리", "inventory_ordering_equipment"],
  ["재고 발주 기준", "inventory_ordering_equipment"],
  ["장비 세척 및 관리", "inventory_ordering_equipment"],
  ["위생 및 청소 관리", "hygiene_safety_emergency"],
  ["긴급 상황 대응", "hygiene_safety_emergency"],
  ["식품 안전 및 이물질 대응", "hygiene_safety_emergency"],
]);

// Priority 2: existing (coarser) Excel category values, normalized onto the 6 top categories.
// docs/manual-category-taxonomy.md section 6 documents this same table.
const EXISTING_CATEGORY_RULES: ReadonlyMap<string, string> = new Map([
  ["주문·결제", "ordering_payment_customer_service"],
  ["고객응대", "ordering_payment_customer_service"],
  ["음료제조", "menu_recipe"],
  ["메뉴제조", "menu_recipe"],
  ["재고·발주", "inventory_ordering_equipment"],
  ["장비관리", "inventory_ordering_equipment"],
  ["위생·안전", "hygiene_safety_emergency"],
]);

// "매장운영" needs a title-based tie-break instead of a single fixed key.
const STORE_OPERATIONS_RAW_CATEGORY = "매장운영";
const OPENING_CLOSING_TITLES = new Set(["오픈 운영", "마감 운영"]);

// Priority 3: a deliberately small, fixed keyword list (not NLP/AI). Checked only when neither
// an exact title nor an existing-category rule matched.
const KEYWORD_RULES: ReadonlyArray<{ pattern: RegExp; key: string }> = [
  { pattern: /오픈|마감/, key: "opening_closing" },
  { pattern: /직원|인수인계|프랜차이즈/, key: "store_operations_staff" },
  { pattern: /주문|결제|고객|환불|취소|보상|쿠폰|포인트|프로모션|분실|픽업|포장/, key: "ordering_payment_customer_service" },
  { pattern: /레시피|제조|메뉴|음료/, key: "menu_recipe" },
  { pattern: /재고|발주|장비/, key: "inventory_ordering_equipment" },
  { pattern: /위생|청소|안전|긴급|이물질/, key: "hygiene_safety_emergency" },
];

function classifyOne(group: AnalyzedManualGroup): { key: string; method: ManualClassificationMethod } {
  const title = group.topic.trim();
  const rawCategory = group.category.trim();

  const exactTitleKey = EXACT_TITLE_RULES.get(title);
  if (exactTitleKey) {
    return { key: exactTitleKey, method: "exact_title" };
  }

  if (rawCategory === STORE_OPERATIONS_RAW_CATEGORY) {
    return {
      key: OPENING_CLOSING_TITLES.has(title) ? "opening_closing" : "store_operations_staff",
      method: "existing_category",
    };
  }

  const existingCategoryKey = EXISTING_CATEGORY_RULES.get(rawCategory);
  if (existingCategoryKey) {
    return { key: existingCategoryKey, method: "existing_category" };
  }

  const keywordSource = `${rawCategory} ${title}`;
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(keywordSource)) {
      return { key: rule.key, method: "keyword" };
    }
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
      topCategoryLabel: labelForKey(key),
      classification: method,
    };
  });
}

export function isUnclassified(group: Pick<ClassifiedManualGroup, "topCategoryKey">): boolean {
  return group.topCategoryKey === UNCLASSIFIED_KEY;
}

export { CATEGORY_DEFINITIONS, UNCLASSIFIED_KEY, UNCLASSIFIED_LABEL };
