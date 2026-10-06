import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";

export type QuestionManualSource = {
  id: string; title: string; content: string; category: string; editable: boolean; status: string;
};
export type QuestionManualContext = {
  answer: string | null;
  source: QuestionManualSource | null;
  sourceState: "available" | "none" | "unavailable";
};

export async function fetchOwnerQuestionManualContext(
  client: SupabaseClient,
  input: { userId: string; storeId: string; questionId: string },
): Promise<{ status: number; body: { context?: QuestionManualContext; error?: string } }> {
  try {
    const auth = await requireStoreOwner(client, input.userId, input.storeId);
    if (!auth) return { status: 403, body: { error: "이 매장의 질문을 볼 권한이 없습니다." } };
    const { data: log, error } = await client.from("question_logs")
      .select("id, store_id, answer, source_manual_id")
      .eq("id", input.questionId).eq("store_id", auth.storeId).maybeSingle();
    if (error) return { status: 500, body: { error: "기존 답변을 불러오지 못했습니다." } };
    if (!log || log.store_id !== auth.storeId) return { status: 404, body: { error: "질문을 찾을 수 없습니다." } };
    const context: QuestionManualContext = {
      answer: typeof log.answer === "string" ? log.answer : null,
      source: null, sourceState: log.source_manual_id ? "unavailable" : "none",
    };
    if (typeof log.source_manual_id === "string") {
      const { data: manual, error: sourceError } = await client.from("manuals")
        .select("id, title, category, content, status, store_id, franchise_id")
        .eq("id", log.source_manual_id).eq("franchise_id", auth.franchiseId).maybeSingle();
      if (!sourceError && manual && manual.franchise_id === auth.franchiseId
        && (manual.store_id === auth.storeId || (manual.store_id === null && manual.status === "approved"))) {
        context.source = { id: manual.id, title: manual.title, category: manual.category,
          content: manual.content, status: manual.status, editable: manual.store_id === auth.storeId };
        context.sourceState = "available";
      }
    }
    return { status: 200, body: { context } };
  } catch {
    return { status: 500, body: { error: "질문과 매뉴얼 정보를 불러오지 못했습니다." } };
  }
}

export function buildQuestionManualEditUrl(storeId: string, questionId: string, manualId?: string): string {
  const query = new URLSearchParams({ storeId, questionId });
  if (manualId) query.set("manualId", manualId);
  return `/boss/store-manuals?${query.toString()}`;
}