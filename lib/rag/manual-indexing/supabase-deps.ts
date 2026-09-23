import type { SupabaseClient } from "@supabase/supabase-js";

import { chunkManualText } from "@/lib/rag/chunk-manual";
import { createEmbeddings } from "@/lib/rag/openai-embeddings";

import { persistManualChunks } from "./persist-chunks";
import { validateManualBatch } from "./validate";
import type { ManualIndexingDeps, PersistManualFn } from "./pipeline";

const MANUAL_SELECT_COLUMNS =
  "id, franchise_id, store_id, parent_manual_id, title, category, content, status";

/**
 * Real production wiring for ManualIndexingDeps (chunkManualText, OpenAI
 * embeddings, Supabase manuals/manual_chunks reads+writes). Not called by
 * any route yet — wiring a real route is a follow-up step — but a future
 * route can do `runManualIndexingPipeline(inputs, createSupabaseManualIndexingDeps(createAdminClient()))`
 * without re-deriving this wiring. Kept separate from pipeline.ts so the
 * orchestrator itself stays free of Supabase/OpenAI/"@/" imports and can be
 * unit tested with `node --test` and fake dependencies.
 */
export function createSupabaseManualIndexingDeps(supabase: SupabaseClient): ManualIndexingDeps {
  const persistManual: PersistManualFn = async (args) => {
    const row = {
      franchise_id: args.franchiseId,
      store_id: args.storeId,
      scope_type: args.scopeType,
      parent_manual_id: args.parentManualId,
      brand_name: args.brandName,
      title: args.title,
      category: args.category,
      content: args.content,
      status: args.status,
    };

    if (args.existingManualId) {
      const { data, error } = await supabase
        .from("manuals")
        .update(row)
        .eq("id", args.existingManualId)
        .select(MANUAL_SELECT_COLUMNS)
        .maybeSingle();

      if (error) {
        throw new Error("MANUAL_PERSIST_FAILED");
      }
      if (!data) {
        throw new Error("EXISTING_MANUAL_NOT_FOUND");
      }
      return { id: data.id as string };
    }

    const { data, error } = await supabase
      .from("manuals")
      .insert(row)
      .select(MANUAL_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error("MANUAL_PERSIST_FAILED");
    }
    return { id: data.id as string };
  };

  return {
    validate: validateManualBatch,
    persistManual,
    createEmbeddings,
    persistChunks: (manualId, chunks) => persistManualChunks(supabase, manualId, chunks),
    chunkText: chunkManualText,
  };
}
