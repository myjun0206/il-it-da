import type {
  ManualScopeType,
  ManualStatus,
  NormalizedManualInput,
  ValidationErrorCode,
  ValidationIssue,
} from "./types";

// Standard RFC 4122 UUID (v1-v5); used only to sanity-check an already-persisted manual id.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_SCOPE_TYPES: readonly ManualScopeType[] = ["hq", "store"];
const ALLOWED_STATUSES: readonly ManualStatus[] = ["draft", "approved"];

export interface ValidatedManualInput extends NormalizedManualInput {
  /** hq-scope inputs always have storeId normalized to null here, regardless of what upstream sent. */
  storeId: string | null;
}

export interface ManualBatchValidationResult {
  items: ValidatedManualInput[];
  issues: ValidationIssue[];
}

function issue(externalId: string | null, code: ValidationErrorCode): ValidationIssue {
  return { stage: "validate", externalId, code };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Structural validation only. Content-length limits are intentionally not
 * re-implemented here: they are enforced by reusing chunkManualText's own
 * limit at the chunk stage, so the threshold lives in exactly one place.
 */
export function validateManualBatch(inputs: readonly NormalizedManualInput[]): ManualBatchValidationResult {
  const issues: ValidationIssue[] = [];
  const structurallyValid: NormalizedManualInput[] = [];

  for (const input of inputs) {
    const externalId = isNonEmptyString(input?.externalId) ? input.externalId.trim() : null;

    if (!externalId) {
      issues.push(issue(null, "EXTERNAL_ID_REQUIRED"));
      continue;
    }

    if (!isNonEmptyString(input.title)) {
      issues.push(issue(externalId, "TITLE_REQUIRED"));
      continue;
    }

    if (!isNonEmptyString(input.content)) {
      issues.push(issue(externalId, "CONTENT_REQUIRED"));
      continue;
    }

    if (!ALLOWED_STATUSES.includes(input.status)) {
      issues.push(issue(externalId, "INVALID_STATUS"));
      continue;
    }

    if (!ALLOWED_SCOPE_TYPES.includes(input.scopeType)) {
      issues.push(issue(externalId, "INVALID_SCOPE_TYPE"));
      continue;
    }

    if (input.scopeType === "store" && !isNonEmptyString(input.storeId)) {
      issues.push(issue(externalId, "STORE_ID_REQUIRED_FOR_STORE_SCOPE"));
      continue;
    }

    if (input.existingManualId != null && !UUID_REGEX.test(String(input.existingManualId))) {
      issues.push(issue(externalId, "INVALID_EXISTING_MANUAL_ID"));
      continue;
    }

    structurallyValid.push({ ...input, externalId });
  }

  // Duplicate externalId within this batch: reject every occurrence, not just the extras,
  // since there is no safe way to decide which copy is authoritative.
  const occurrences = new Map<string, number>();
  for (const input of structurallyValid) {
    occurrences.set(input.externalId, (occurrences.get(input.externalId) ?? 0) + 1);
  }

  const deduped = structurallyValid.filter((input) => {
    if ((occurrences.get(input.externalId) ?? 0) > 1) {
      issues.push(issue(input.externalId, "DUPLICATE_EXTERNAL_ID"));
      return false;
    }
    return true;
  });

  const byExternalId = new Map(deduped.map((input) => [input.externalId, input]));

  const withValidParents = deduped.filter((input) => {
    if (input.parentExternalId == null || input.parentExternalId === "") {
      return true;
    }

    if (input.parentExternalId === input.externalId) {
      issues.push(issue(input.externalId, "PARENT_REFERENCE_SELF"));
      return false;
    }

    const parent = byExternalId.get(input.parentExternalId);
    if (!parent) {
      issues.push(issue(input.externalId, "PARENT_REFERENCE_NOT_FOUND"));
      return false;
    }

    // Only one level of parent/child is supported (mirrors the existing
    // topic-card/detail-item contract); deeper chains are rejected explicitly
    // instead of silently mis-linking.
    if (parent.parentExternalId) {
      issues.push(issue(input.externalId, "PARENT_MUST_BE_ROOT"));
      return false;
    }

    return true;
  });

  const items: ValidatedManualInput[] = withValidParents.map((input) => ({
    ...input,
    storeId: input.scopeType === "store" ? (input.storeId ?? null) : null,
  }));

  return { items, issues };
}
