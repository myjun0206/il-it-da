import type { ManualChunkRow } from "./persist-chunks";
import type { ManualBatchValidationResult, ValidatedManualInput } from "./validate";
import type {
  ManualIndexingErrorCode,
  ManualIndexingItemResult,
  ManualIndexingResult,
  ManualIndexingStage,
  ManualStatus,
  NormalizedManualInput,
} from "./types";

// 고정 오류 코드와 안전한 error name만 남기고, 매뉴얼 본문/UUID/이메일/raw error는 출력하지 않는다.
function logSafePipelineError(code: string, error: unknown): void {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(`[MANUAL_INDEXING] ${code}`, { name });
}

export interface PersistManualArgs {
  existingManualId: string | null;
  parentManualId: string | null;
  title: string;
  category: string;
  content: string;
  status: ManualStatus;
  scopeType: NormalizedManualInput["scopeType"];
  storeId: string | null;
  franchiseId: string | null;
  brandName: string | null;
}

export interface PersistedManual {
  id: string;
}

export type PersistManualFn = (args: PersistManualArgs) => Promise<PersistedManual>;
export type CreateEmbeddingsFn = (inputs: string[]) => Promise<number[][]>;
export type PersistChunksFn = (manualId: string, chunks: ManualChunkRow[]) => Promise<{ chunkCount: number }>;
export type ChunkTextFn = (text: string) => string[];
export type ValidateFn = (inputs: readonly NormalizedManualInput[]) => ManualBatchValidationResult;

/**
 * This module has zero cross-file value imports on purpose (only type-only
 * imports, which are erased at runtime) so it can be unit tested with
 * `node --test` and fake dependencies, without needing Supabase/OpenAI or
 * the Next.js "@/" path alias to resolve. Real wiring (validateManualBatch,
 * chunkManualText, OpenAI embeddings, Supabase reads/writes) lives in
 * supabase-deps.ts.
 */
export interface ManualIndexingDeps {
  validate: ValidateFn;
  persistManual: PersistManualFn;
  createEmbeddings: CreateEmbeddingsFn;
  persistChunks: PersistChunksFn;
  chunkText: ChunkTextFn;
  logError?: (code: string, error: unknown) => void;
}

function isChildOf(item: ValidatedManualInput): boolean {
  return item.parentExternalId != null && item.parentExternalId !== "";
}

/**
 * Mirrors lib/rag/save-manual-sections.ts's existing contract: a manual that
 * acts purely as a parent/topic container for other manuals in this batch is
 * not chunked; every other persisted manual (a child, or a standalone manual
 * with no children) is chunked, but only when approved (never draft).
 */
function isChunkEligible(
  item: ValidatedManualInput,
  childCountByExternalId: Map<string, number>,
): boolean {
  if (item.status !== "approved") {
    return false;
  }
  const childCount = childCountByExternalId.get(item.externalId) ?? 0;
  return isChildOf(item) || childCount === 0;
}

function toEmbeddingInput(brandName: string | null, title: string, category: string, chunk: string): string {
  return `브랜드: ${brandName ?? ""}\n제목: ${title}\n카테고리: ${category}\n내용: ${chunk}`;
}

export async function runManualIndexingPipeline(
  inputs: readonly NormalizedManualInput[],
  deps: ManualIndexingDeps,
): Promise<ManualIndexingResult> {
  const logError = deps.logError ?? logSafePipelineError;

  // Stage: validate
  const { items: validated, issues } = deps.validate(inputs);

  const items: ManualIndexingItemResult[] = issues.map((iss) => ({
    externalId: iss.externalId ?? "unknown",
    manualId: null,
    status: "failed",
    chunkCount: 0,
    stage: "validate",
    code: iss.code,
  }));

  const childCountByExternalId = new Map<string, number>();
  for (const item of validated) {
    if (item.parentExternalId) {
      childCountByExternalId.set(item.parentExternalId, (childCountByExternalId.get(item.parentExternalId) ?? 0) + 1);
    }
  }

  const persistedIdByExternalId = new Map<string, string>();

  // Root items first, then children, so a child's parentExternalId always
  // resolves to an already-persisted real manuals.id before it is inserted.
  const roots = validated.filter((item) => !isChildOf(item));
  const children = validated.filter((item) => isChildOf(item));

  for (const item of [...roots, ...children]) {
    // Stage: persist manual
    let manualId: string;
    try {
      const parentManualId = item.parentExternalId
        ? (persistedIdByExternalId.get(item.parentExternalId) ?? null)
        : null;

      const persisted = await deps.persistManual({
        existingManualId: item.existingManualId ?? null,
        parentManualId,
        title: item.title,
        category: item.category,
        content: item.content,
        status: item.status,
        scopeType: item.scopeType,
        storeId: item.storeId,
        franchiseId: item.franchiseId ?? null,
        brandName: item.brandName ?? null,
      });
      manualId = persisted.id;
      persistedIdByExternalId.set(item.externalId, manualId);
    } catch (error) {
      const code = toPipelineErrorCode(error, "MANUAL_PERSIST_FAILED");
      logError(code, error);
      items.push({ externalId: item.externalId, manualId: null, status: "failed", chunkCount: 0, stage: "persist_manual", code });
      continue;
    }

    if (!isChunkEligible(item, childCountByExternalId)) {
      items.push({ externalId: item.externalId, manualId, status: "skipped", chunkCount: 0 });
      continue;
    }

    // Stage: chunk
    let chunks: string[];
    try {
      chunks = deps.chunkText(item.content);
    } catch (error) {
      const code: ManualIndexingErrorCode = "CHUNKING_FAILED";
      logError(code, error);
      items.push({ externalId: item.externalId, manualId, status: "failed", chunkCount: 0, stage: "chunk", code });
      continue;
    }

    if (chunks.length === 0) {
      items.push({ externalId: item.externalId, manualId, status: "skipped", chunkCount: 0 });
      continue;
    }

    // Stage: generate embeddings
    let embeddings: number[][];
    try {
      const embeddingInputs = chunks.map((chunk) => toEmbeddingInput(item.brandName ?? null, item.title, item.category, chunk));
      embeddings = await deps.createEmbeddings(embeddingInputs);
    } catch (error) {
      const code: ManualIndexingErrorCode = "EMBEDDING_FAILED";
      logError(code, error);
      items.push({ externalId: item.externalId, manualId, status: "failed", chunkCount: 0, stage: "embedding", code });
      continue;
    }

    if (embeddings.length !== chunks.length) {
      const code: ManualIndexingErrorCode = "EMBEDDING_COUNT_MISMATCH";
      logError(code, new Error(code));
      items.push({ externalId: item.externalId, manualId, status: "failed", chunkCount: 0, stage: "embedding", code });
      continue;
    }

    // Stage: persist chunks
    try {
      const chunkRows: ManualChunkRow[] = chunks.map((content, index) => ({ content, embedding: embeddings[index] }));
      const { chunkCount } = await deps.persistChunks(manualId, chunkRows);
      items.push({ externalId: item.externalId, manualId, status: "indexed", chunkCount });
    } catch (error) {
      const code: ManualIndexingErrorCode = "CHUNK_PERSIST_FAILED";
      logError(code, error);
      items.push({ externalId: item.externalId, manualId, status: "failed", chunkCount: 0, stage: "persist_chunks", code });
    }
  }

  // Stage: finalize result
  return finalizeManualIndexingResult(items);
}

function toPipelineErrorCode(error: unknown, fallback: ManualIndexingErrorCode): ManualIndexingErrorCode {
  const message = error instanceof Error ? error.message : "";
  if (message === "EXISTING_MANUAL_NOT_FOUND") {
    return "EXISTING_MANUAL_NOT_FOUND";
  }
  return fallback;
}

function finalizeManualIndexingResult(items: ManualIndexingItemResult[]): ManualIndexingResult {
  const manualCount = items.filter((item) => item.manualId !== null).length;
  const chunkCount = items.reduce((sum, item) => sum + item.chunkCount, 0);
  const indexedCount = items.filter((item) => item.status === "indexed").length;
  const skippedCount = items.filter((item) => item.status === "skipped").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const errorCodes = [...new Set(items.map((item) => item.code).filter((code): code is ManualIndexingErrorCode => Boolean(code)))];

  return {
    success: failedCount === 0,
    manualCount,
    chunkCount,
    indexedCount,
    skippedCount,
    failedCount,
    errorCodes,
    items,
  };
}

export type { ManualStatus, ManualIndexingStage };
