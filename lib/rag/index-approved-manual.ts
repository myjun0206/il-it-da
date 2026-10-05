import type { SupabaseClient } from "@supabase/supabase-js";

import { chunkManualText } from "@/lib/rag/chunk-manual";
import { createEmbeddings } from "@/lib/rag/openai-embeddings";
import { requireManualWriteContract, sameManualRevision, type ManualWriteContext } from "@/lib/manuals/manual-write-contract";

export type IndexApprovedManualResult = {
  manualId: string;
  chunkCount: number;
};

const MAX_CHUNK_COUNT = 100;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ApprovedManualRow = {
  id: string;
  brand_name: string;
  title: string;
  category: string;
  content: string;
  status: string;
  updated_at: string;
  franchise_id: string | null;
  store_id: string | null;
  scope_type: string | null;
  parent_manual_id: string | null;
};

function validateManualId(manualId: unknown): string {
  if (typeof manualId !== "string") {
    throw new Error("manualId must be a string.");
  }

  const normalized = manualId.trim();
  if (!normalized) {
    throw new Error("manualId cannot be empty.");
  }

  if (!UUID_REGEX.test(normalized)) {
    throw new Error("manualId must be a valid UUID.");
  }

  return normalized;
}

function isApprovedManualRow(value: unknown): value is ApprovedManualRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    typeof record.brand_name === "string" &&
    typeof record.title === "string" &&
    typeof record.category === "string" &&
    typeof record.content === "string" &&
    typeof record.status === "string" &&
    typeof record.updated_at === "string" &&
    ["franchise_id", "store_id", "scope_type", "parent_manual_id"].every((field) => record[field] === null || typeof record[field] === "string")
  );
}

async function fetchApprovedManual(
  supabase: SupabaseClient,
  manualId: string,
): Promise<ApprovedManualRow> {
  const { data, error } = await supabase
    .from("manuals")
    .select("id, brand_name, title, category, content, status, updated_at, franchise_id, store_id, scope_type, parent_manual_id")
    .eq("id", manualId)
    .eq("status", "approved")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch manual: ${error.message}`);
  }

  if (!data) {
    throw new Error("Approved manual not found.");
  }

  if (!isApprovedManualRow(data)) {
    throw new Error("Manual record has an unexpected shape.");
  }

  if (data.status !== "approved") {
    throw new Error("Manual is not approved.");
  }

  return data;
}

export async function indexApprovedManual(
  manualId: string,
  client?: SupabaseClient,
  embed: (inputs: string[]) => Promise<number[][]> = createEmbeddings,
  expectedUpdatedAt?: string,
  context?: ManualWriteContext,
): Promise<IndexApprovedManualResult> {
  if (typeof window !== "undefined") {
    throw new Error("Manual indexing is only available on the server.");
  }

  const supabase = client ?? (await import("@/lib/supabase/admin")).createAdminClient();
  if (!context || context.client !== supabase) await requireManualWriteContract(supabase);
  const normalizedManualId = validateManualId(manualId);
  const manual = await fetchApprovedManual(supabase, normalizedManualId);
  if (expectedUpdatedAt && !sameManualRevision(manual.updated_at, expectedUpdatedAt)) {
    throw new Error("MANUAL_INDEX_CONFLICT");
  }

  const chunks = chunkManualText(manual.content);

  if (chunks.length === 0) {
    throw new Error("Manual produced no chunks to index.");
  }

  if (chunks.length > MAX_CHUNK_COUNT) {
    throw new Error(`Manual produced too many chunks: limit is ${MAX_CHUNK_COUNT}.`);
  }

  const embeddingInputs = chunks.map(
    (chunk) =>
      `브랜드: ${manual.brand_name}\n제목: ${manual.title}\n카테고리: ${manual.category}\n내용: ${chunk}`,
  );

  const embeddings = await embed(embeddingInputs);

  if (embeddings.length !== chunks.length) {
    throw new Error("Embedding count does not match chunk count.");
  }

  const rows = chunks.map((chunk, index) => ({
    manual_id: manual.id,
    chunk_index: index,
    content: chunk,
    embedding: embeddings[index],
  }));

  const { error: publishError } = await supabase.rpc("replace_manual_chunks_if_current", {
    p_manual_id: manual.id,
    p_expected_snapshot: manual,
    p_chunks: rows,
  });
  if (publishError) {
    throw new Error(publishError.code === "40001" ? "MANUAL_INDEX_CONFLICT" : "MANUAL_INDEX_PUBLISH_FAILED");
  }

  return {
    manualId: manual.id,
    chunkCount: chunks.length,
  };
}
