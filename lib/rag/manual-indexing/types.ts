/**
 * Normalized manual indexing input/output contract.
 *
 * This is the UI/file-format-independent boundary between upstream manual
 * parsing (Excel/CSV/TXT/MD/PDF parsing + category classification, owned by
 * a teammate) and this repo's indexing pipeline core (validate -> persist
 * manual -> chunk -> embed -> persist chunks -> finalize).
 *
 * category/parent-child relationships are always upstream decisions: this
 * pipeline stores them as given and never re-derives or re-classifies them.
 */

export type ManualScopeType = "hq" | "store";
export type ManualStatus = "draft" | "approved";

export interface NormalizedManualInput {
  /** Upstream correlation key for this call only; never persisted to the DB. */
  externalId: string;
  /**
   * Real public.manuals.id from a previous run, when the caller wants to
   * update/re-index an already-persisted manual instead of inserting a new
   * row. This is the only way this pipeline can be idempotent at the manual
   * (not just chunk) level without a new migration/unique column.
   */
  existingManualId?: string | null;
  title: string;
  /** Preserved exactly as received; this pipeline never classifies or renames it. */
  category: string;
  content: string;
  scopeType: ManualScopeType;
  /** Required when scopeType === "store"; ignored (normalized to null) when scopeType === "hq". */
  storeId?: string | null;
  /** References another item's externalId within the SAME batch, or null/undefined for a root item. */
  parentExternalId?: string | null;
  status: ManualStatus;
  franchiseId?: string | null;
  brandName?: string | null;
}

export type ManualIndexingStage =
  | "validate"
  | "persist_manual"
  | "chunk"
  | "embedding"
  | "persist_chunks";

/** Fixed, safe validation error codes. No manual content, UUIDs, or file names are ever included. */
export type ValidationErrorCode =
  | "TITLE_REQUIRED"
  | "CONTENT_REQUIRED"
  | "INVALID_STATUS"
  | "INVALID_SCOPE_TYPE"
  | "STORE_ID_REQUIRED_FOR_STORE_SCOPE"
  | "EXTERNAL_ID_REQUIRED"
  | "DUPLICATE_EXTERNAL_ID"
  | "INVALID_EXISTING_MANUAL_ID"
  | "PARENT_REFERENCE_SELF"
  | "PARENT_REFERENCE_NOT_FOUND"
  | "PARENT_MUST_BE_ROOT";

/** Fixed, safe pipeline failure codes (persist/chunk/embedding stages). */
export type PipelineErrorCode =
  | "MANUAL_PERSIST_FAILED"
  | "EXISTING_MANUAL_NOT_FOUND"
  | "CHUNKING_FAILED"
  | "EMBEDDING_FAILED"
  | "EMBEDDING_COUNT_MISMATCH"
  | "CHUNK_PERSIST_FAILED";

export type ManualIndexingErrorCode = ValidationErrorCode | PipelineErrorCode;

export interface ValidationIssue {
  stage: "validate";
  externalId: string | null;
  code: ValidationErrorCode;
}

export type ManualIndexingItemStatus = "indexed" | "skipped" | "failed";

export interface ManualIndexingItemResult {
  externalId: string;
  manualId: string | null;
  status: ManualIndexingItemStatus;
  chunkCount: number;
  /** Present only when status is "skipped" or "failed". */
  stage?: ManualIndexingStage;
  code?: ManualIndexingErrorCode;
}

export interface ManualIndexingResult {
  success: boolean;
  manualCount: number;
  chunkCount: number;
  indexedCount: number;
  skippedCount: number;
  failedCount: number;
  errorCodes: ManualIndexingErrorCode[];
  items: ManualIndexingItemResult[];
}
