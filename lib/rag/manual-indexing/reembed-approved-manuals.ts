export interface ReembeddableManual {
  id: string;
  status: string;
  updated_at?: string;
}

export type IndexManualFn = (manualId: string, expectedUpdatedAt?: string) => Promise<unknown>;
export type LogErrorFn = (code: string, error: unknown) => void;

// 고정 오류 코드와 안전한 error name만 남기고, message/UUID/본문은 출력하지 않는다.
const defaultLogError: LogErrorFn = (code, error) => {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(`[MANUALS] ${code}`, { name });
};

/**
 * Re-embeds each already-approved manual via the injected indexManual
 * function (skips draft). Per-manual failures are logged and swallowed so
 * one bad manual never blocks the rest of the batch or the caller's own
 * success response. Zero cross-file imports on purpose: directly testable
 * with `node --test` and fake dependencies.
 */
export async function reembedApprovedManuals(
  manuals: readonly ReembeddableManual[],
  indexManual: IndexManualFn,
  logError: LogErrorFn = defaultLogError,
): Promise<{ manualId: string; status: "ready" | "failed" | "not_searchable" }[]> {
  const results: { manualId: string; status: "ready" | "failed" | "not_searchable" }[] = [];
  for (const manual of manuals) {
    if (manual.status !== "approved") {
      results.push({ manualId: manual.id, status: "not_searchable" });
      continue;
    }
    try {
      await indexManual(manual.id, manual.updated_at);
      results.push({ manualId: manual.id, status: "ready" });
    } catch (error) {
      results.push({ manualId: manual.id, status: "failed" });
      logError("MANUAL_EMBEDDING_FAILED", error);
    }
  }
  return results;
}
