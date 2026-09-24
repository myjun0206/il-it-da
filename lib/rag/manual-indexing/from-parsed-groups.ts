import type { ManualScopeType, ManualStatus, NormalizedManualInput } from "./types";

export interface ParsedManualItem {
  title: string;
  content: string;
}

export interface ParsedManualGroup {
  topic: string;
  items: ParsedManualItem[];
}

export interface ManualIndexingScopeContext {
  scopeType: ManualScopeType;
  storeId?: string | null;
  franchiseId?: string | null;
  brandName?: string | null;
  status?: ManualStatus;
}

/**
 * Adapter: converts already-parsed parser output (a topic + normalized
 * {title, content} items, e.g. the groups produced by
 * app/api/manuals/upload/route.ts's rowsToGroups/parseTxtGroups) into this
 * pipeline's NormalizedManualInput contract. It never re-classifies
 * category or parent/child — topic/items are trusted exactly as parsed
 * upstream. scope/franchise/brand always come from the caller-supplied
 * context (the authenticated HQ session), never from request-body values,
 * because this function has no request-body parameter at all.
 */
export function fromParsedManualGroup(
  group: ParsedManualGroup,
  context: ManualIndexingScopeContext,
  externalIdPrefix: string,
): NormalizedManualInput[] {
  const status = context.status ?? "approved";
  const storeId = context.scopeType === "store" ? (context.storeId ?? null) : null;
  const parentExternalId = `${externalIdPrefix}-topic`;

  const parent: NormalizedManualInput = {
    externalId: parentExternalId,
    title: group.topic,
    category: group.topic,
    content: `${group.items.length}개 항목`,
    scopeType: context.scopeType,
    storeId,
    status,
    franchiseId: context.franchiseId ?? null,
    brandName: context.brandName ?? null,
  };

  const children: NormalizedManualInput[] = group.items.map((item, index) => ({
    externalId: `${externalIdPrefix}-item-${index}`,
    parentExternalId,
    title: item.title || group.topic,
    category: group.topic,
    content: item.content,
    scopeType: context.scopeType,
    storeId,
    status,
    franchiseId: context.franchiseId ?? null,
    brandName: context.brandName ?? null,
  }));

  return [parent, ...children];
}
