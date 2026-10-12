import { NextResponse } from "next/server";

import { POST as ragQuery } from "@/app/api/rag/query/route";
import { buildConversationTitle, isMissingConversationTable, isMissingResponseKindColumn } from "@/lib/staff/conversations";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { conversationTraceTag } from "@/lib/rag/trace-identifiers";
import { parseRecipeEvidenceSupport, recipeSupportStorageEnabled, type RecipeEvidenceSupport } from "@/lib/rag/recipe-fact-verification";

export const runtime = "nodejs";

type ChatBody = { question?: unknown; storeId?: unknown; conversationId?: unknown };

/**
 * 직원 AI 질문 + 대화 기록 저장.
 * - conversationId가 있으면: 본인 대화인지 확인하고, 매장은 "대화에 저장된 store_id"만 사용한다(요청 storeId 무시).
 * - 없으면: 요청 storeId로 새 대화를 시작하고, 답변이 성공한 뒤에야 대화를 만든다(빈 대화 row 없음).
 * - 답변은 기존 /api/rag/query 로직을 그대로 호출한다. 그 안에서 로그인 사용자 + 해당 매장 approved staff
 *   membership을 서버에서 다시 검증하고, 해당 매장/프랜차이즈 범위의 매뉴얼만 검색한다.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const executionBody = await request.clone().json().catch(() => null);
  if (request.headers.has("X-RAG-E2E") || request.headers.has("X-RAG-Retest")
    || executionBody && Object.prototype.hasOwnProperty.call(executionBody, "e2eExecution")) {
    return NextResponse.json({ error: "Private verification is unavailable on the application route.", code: "E2E_EXECUTION_STOPPED" }, { status: 409 });
  }
  return handleChat(request);
}

async function handleChat(request: Request): Promise<NextResponse> {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const serverClient = await createClient();
  const { data: userData, error: userError } = await serverClient.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const userId = userData.user.id;
  const question = typeof body.question === "string" ? body.question : "";
  const adminClient = createAdminClient();

  let conversationId: string | null = typeof body.conversationId === "string" && body.conversationId ? body.conversationId : null;
  let storeId = typeof body.storeId === "string" ? body.storeId : "";
  let historyAvailable = true;

  if (conversationId) {
    const { data: conversation, error } = await adminClient
      .from("conversations")
      .select("id, store_id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle<{ id: string; store_id: string }>();

    if (error && !isMissingConversationTable(error)) {
      return NextResponse.json({ error: "대화를 불러오지 못했습니다." }, { status: 500 });
    }
    if (!conversation) {
      return NextResponse.json({ error: "대화를 찾을 수 없습니다.", code: "CONVERSATION_NOT_FOUND" }, { status: 404 });
    }
    storeId = conversation.store_id;
  }

  if (process.env.NODE_ENV === "development" && process.env.RAG_TRACE === "1") {
    console.info("[STAFF_CHAT_TRACE]", { requestOrigin: new URL(request.url).origin,
      phase: "request", conversationTag: conversationTraceTag(conversationId),
      requestedStoreId: typeof body.storeId === "string" && /^[0-9a-f-]{36}$/i.test(body.storeId) ? body.storeId : null,
      effectiveStoreId: /^[0-9a-f-]{36}$/i.test(storeId) ? storeId : null, storeSource: conversationId ? "saved_conversation" : "new_request",
    });
  }

  // 기존 RAG 경로 재사용 (인증/매장 승인 검증/검색/답변/질문 로그)
  const ragResponse = await ragQuery(
    new Request(new URL("/api/rag/query", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, storeId, conversationId }),
    }),
  );
  const ragBody = (await ragResponse.json()) as {
    evidenceSupport?: RecipeEvidenceSupport | null;
    responseKind?: "answer" | "clarification";
    answer?: string;
    status?: "answered" | "cautious" | "insufficient";
    source?: { title?: string; category?: string } | null;
    sources?: { manualId?: string; title?: string; category?: string }[];
    similarity?: number | null;
    questionLogSaveError?: "QUESTION_LOG_SAVE_FAILED";
    error?: string;
    code?: string;
  };
  const traceId = ragResponse.headers.get("X-RAG-Trace-ID");
  const diagnosticHeaders = process.env.NODE_ENV === "development"
    && traceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(traceId)
    ? { "X-RAG-Trace-ID": traceId } : undefined;

  if (!ragResponse.ok || !ragBody.answer) {
    const safeCode = ["SEARCH_FAILED", "GENERATION_FAILED", "GENERATION_UNPARSABLE", "RAG_QUERY_FAILED"].includes(ragBody.code ?? "") ? ragBody.code : undefined;
    return NextResponse.json(
      { error: ragBody.error ?? "답변을 받지 못했어요.", code: ragResponse.status === 403 ? "STORE_FORBIDDEN" : safeCode },
      { status: ragResponse.status, headers: diagnosticHeaders },
    );
  }

  // 대화 저장 (실패해도 답변은 돌려준다)
  let saveError: string | null = null;
  const evidenceSupport = recipeSupportStorageEnabled() ? parseRecipeEvidenceSupport(ragBody.evidenceSupport) : null;
  let isNewConversation = false;
  try {
    const now = new Date().toISOString();
    if (!conversationId) {
      isNewConversation = true;
      const { data: created, error: createError } = await adminClient
        .from("conversations")
        .insert({ user_id: userId, store_id: storeId, title: buildConversationTitle(question), created_at: now, updated_at: now })
        .select("id")
        .single<{ id: string }>();
      if (createError) {
        throw new Error(`Failed to create conversation: ${JSON.stringify({ code: createError.code, message: createError.message })}`);
      }
      conversationId = created.id;
    }

    const messageRows = [
      { conversation_id: conversationId, role: "user", content: question.trim(), created_at: now },
      {
        conversation_id: conversationId,
        role: "assistant",
        response_kind: ragBody.responseKind === "answer" || ragBody.responseKind === "clarification" ? ragBody.responseKind : null,
        content: ragBody.answer,
        status: ragBody.status ?? null,
        source_title: ragBody.source?.title ?? null,
        source_category: ragBody.source?.category ?? null,
        similarity: typeof ragBody.similarity === "number" ? ragBody.similarity : null,
        ...(recipeSupportStorageEnabled() ? { evidence_support: evidenceSupport } : {}),
        created_at: new Date(Date.now() + 1).toISOString(),
      },
    ];
    let { error: messageError } = await adminClient.from("conversation_messages").insert(messageRows);
    if (isMissingResponseKindColumn(messageError)) {
      const legacyRows = messageRows.map(row => {
        const legacy: Record<string, unknown> = { ...row };
        delete legacy.response_kind;
        return legacy;
      });
      ({ error: messageError } = await adminClient.from("conversation_messages").insert(legacyRows));
    }
    if (messageError) {
      throw new Error(`Failed to insert messages: ${JSON.stringify({ code: messageError.code, message: messageError.message })}`);
    }

    const { error: updateError } = await adminClient
      .from("conversations")
      .update({ updated_at: now })
      .eq("id", conversationId)
      .eq("user_id", userId);
    if (updateError) {
      throw new Error(`Failed to update conversation: ${JSON.stringify({ code: updateError.code, message: updateError.message })}`);
    }
  } catch (error) {
    historyAvailable = false;
    // 새 대화 생성 중 실패했다면 conversationId 초기화
    if (isNewConversation) {
      conversationId = null;
    }
    // 모든 경우에 saveError 설정 (새 대화든 기존 대화든)
    saveError = "대화 기록 저장에 실패했습니다. 다시 시도해 주세요.";
    const isMissing = isMissingConversationTable(error as { code?: string });
    if (!isMissing) {
      console.error("[POST /api/staff/chat] Save error:", {
        isNewConversation,
        reason: "CONVERSATION_SAVE_FAILED",
      });
    }
  }

  if (process.env.NODE_ENV === "development" && process.env.RAG_TRACE === "1") {
    console.info("[STAFF_CHAT_TRACE]", { phase: "response", conversationTag: conversationTraceTag(conversationId),
      storeId, historyAvailable, newConversation: isNewConversation, status: ragBody.status, traceId: diagnosticHeaders ? traceId : null });
  }
  return NextResponse.json({
    responseKind: ["answer", "clarification"].includes(ragBody.responseKind ?? "") ? ragBody.responseKind : undefined,
    ...(recipeSupportStorageEnabled() && !saveError ? { evidenceSupport } : {}),
    answer: ragBody.answer,
    status: ragBody.status,
    source: ragBody.source ?? null,
    sources: ragBody.sources ?? [],
    similarity: ragBody.similarity ?? null,
    conversationId,
    storeId,
    historyAvailable,
    saveError,
    questionLogSaveError: ragBody.questionLogSaveError === "QUESTION_LOG_SAVE_FAILED" ? ragBody.questionLogSaveError : undefined,
  }, { headers: diagnosticHeaders });
}
