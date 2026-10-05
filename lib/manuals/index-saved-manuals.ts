import type { ManualRecord } from "@/lib/types/manual";
import { indexManualById } from "@/lib/rag/index-manual";
import { reembedApprovedManuals } from "@/lib/rag/manual-indexing/reembed-approved-manuals";
import type { ManualWriteContext } from "@/lib/manuals/manual-write-contract";
import { manualSaveResult } from "@/lib/manuals/manual-save-result";

export async function indexSavedManuals(manuals: ManualRecord[], context: ManualWriteContext, index = indexManualById) {
  const { data, error } = await context.client.from("manuals").select("parent_manual_id")
    .in("parent_manual_id", manuals.map((manual) => manual.id));
  if (error) {
    for (const manual of manuals) manual.search_status = "unknown";
    return manualSaveResult(manuals);
  }
  const parents = new Set((data ?? []).map((row) => row.parent_manual_id));
  const results = await reembedApprovedManuals(manuals.filter((manual) => !parents.has(manual.id)),
    (id, revision) => index(id, revision, context));
  for (const manual of manuals) manual.search_status = parents.has(manual.id) ? "parent_only"
    : results.find((item) => item.manualId === manual.id)?.status ?? "unknown";
  return manualSaveResult(manuals);
}