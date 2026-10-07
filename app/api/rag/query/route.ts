import { NextResponse } from "next/server";

import { buildGroundedAnswerMessages } from "@/lib/rag/answer-prompt";
import {
  authorizeRagStoreAccessForRequest,
  resolveRagStoreFranchiseForRequest,
} from "@/lib/rag/authorize-rag-store-access";
import { finalizeRagQueryResponse } from "@/lib/rag/finalize-rag-query-response";
import { resolveRagAnswer } from "@/lib/rag/resolve-rag-answer";
import { saveQuestionLog } from "@/lib/rag/save-question-log";
import { createQuestionLogFollowUp } from "@/lib/notifications/notify-repeated-question";
import { createAdminClient } from "@/lib/supabase/admin";
import { searchManualChunks } from "@/lib/rag/search-manual-chunks";
import { validateQueryRequest } from "@/lib/rag/validate-query-request";
import { canUseFamilyPackHistory, priorFamilyPackVariant } from "@/lib/rag/manual-menu-intent";
import { createClient } from "@/lib/supabase/server";
import { conversationTraceTag } from "@/lib/rag/trace-identifiers";
import type {
  ManualChunkMatch,
  RagQueryResponse,
} from "@/lib/rag/types";

export const runtime = "nodejs";

const ANSWERED_THRESHOLD = 0.60;
const CAUTIOUS_THRESHOLD = 0.40;
const GPT_TIMEOUT_MS = 30_000;
const GPT_MAX_OUTPUT_TOKENS = 500; // 현장 직원용 간결한 답변에 맞춘 보수적 상한
const NO_MANUAL_ANSWER =
  "해당 질문에 관한 매뉴얼 내용을 찾지 못했습니다. 매장 관리자에게 문의해 주세요.";
const CAUTION_NOTICE =
  "\n\n※ 검색 신뢰도가 낮은 답변이니, 정확한 확인을 위해 매장 관리자에게 다시 문의해 주세요.";

type OpenAiChatResponse = { //답변글
  choices?: Array<{ message?: { content?: string | null } }>;
};

function getSafeErrorDetails(error: unknown): { name: string; message: string } {
  const name = error instanceof Error ? error.name : "UnknownError";
  const rawMessage = error instanceof Error ? error.message : "Unknown error";
  const message = rawMessage
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(api[_ -]?key|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");

  return { name, message };
}

function getOpenAiApiKey() { // OPENAI_API_KEY 환경변수 존재 여부 확인 후 반환
  const value = process.env.OPENAI_API_KEY?.trim();

  if (!value) {
    const message = "Missing OPENAI_API_KEY. Set it in .env.local at the project root (or in the process environment), then restart the server.";
    console.error(`[RAG configuration] ${message}`);
    throw new Error(message);
  }

  return value;
}

// 최고 유사도 점수를 3단계 상태로 판정 (applyEvidenceGate가 같은 임계값을 쓴다)
const GATE_THRESHOLDS = { answered: ANSWERED_THRESHOLD, cautious: CAUTIOUS_THRESHOLD };

async function confirmedFamilyPackVariant(body: unknown, question: string, storeId: string,
  trace: (event: { stage: string; [key: string]: unknown }) => void): Promise<string | undefined> {
  const conversationId = (body as { conversationId?: unknown })?.conversationId;
  if (!canUseFamilyPackHistory(question) || typeof conversationId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
    trace({ stage: "history", reason: !canUseFamilyPackHistory(question) ? "NOT_A_CONTEXT_FOLLOW_UP" : "NO_VALID_CONVERSATION_ID" });
    return undefined;
  }
  try {
    const session = await createClient();
    const user = await session.auth.getUser();
    if (user.error || !user.data.user) { trace({ stage: "history", reason: "SESSION_UNAVAILABLE" }); return undefined; }
    const client = createAdminClient();
    const conversation = await client.from("conversations").select("id")
      .eq("id", conversationId).eq("user_id", user.data.user.id).eq("store_id", storeId).maybeSingle();
    if (conversation.error || !conversation.data) {
      trace({ stage: "history", reason: conversation.error ? "CONVERSATION_LOOKUP_FAILED" : "OWNED_STORE_CONVERSATION_NOT_FOUND" });
      return undefined;
    }
    const previous = await client.from("conversation_messages").select("content")
      .eq("conversation_id", conversationId).eq("role", "user").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (previous.error || typeof previous.data?.content !== "string") {
      trace({ stage: "history", reason: previous.error ? "PREVIOUS_USER_LOOKUP_FAILED" : "NO_PREVIOUS_USER_QUESTION" });
      return undefined;
    }
    const variant = priorFamilyPackVariant(previous.data.content);
    trace({ stage: "history", reason: variant ? "VERIFIED_PREVIOUS_USER_TARGET" : "PREVIOUS_USER_TARGET_UNRESOLVED",
      previousUserQuestionFound: true, previousQuestionLength: previous.data.content.length, variantFound: Boolean(variant), variantIsB: variant === "B" });
    return variant;
  } catch { trace({ stage: "history", reason: "HISTORY_LOOKUP_EXCEPTION" }); return undefined; }
}

export async function POST(request: Request): Promise<NextResponse<RagQueryResponse>> { // 직원 질문을 받아 매뉴얼 검색 후 GPT-4o 답변을 반환하는 API
  let body: unknown;

  try {
    body = await request.json(); // 요청 본문을 JSON으로 파싱
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validation = validateQueryRequest(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }
  const { question, storeId } = validation.data;
  const traceEnabled = process.env.NODE_ENV === "development" && process.env.RAG_TRACE === "1";
  const conversationTag = conversationTraceTag((body as { conversationId?: unknown }).conversationId);
  const trace = (event: { stage: string; [key: string]: unknown }) => {
    if (traceEnabled) {
      try { console.info("[RAG_TRACE]", { ...event, conversationTag, requestOrigin: new URL(request.url).origin, storeId }); } catch {}
    }
  };
  trace({ stage: "request", traceVersion: "follow-up-trace-v1", conversationPresent: Boolean(conversationTag) });

  try {
    const authorization = await authorizeRagStoreAccessForRequest(storeId);

    if (authorization.status === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (authorization.status === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // 인증된 storeId로만 franchise 범위를 서버에서 결정한다(요청 body의 franchiseId는 신뢰하지 않음).
    // 확인할 수 없으면 검색 자체를 실행하지 않는다(fail-closed).
    const franchiseScope = await resolveRagStoreFranchiseForRequest(storeId);
    if (franchiseScope.status !== "RESOLVED") {
      throw new Error("Unable to resolve store franchise scope.");
    }

    const familyPackVariant = await confirmedFamilyPackVariant(body, question, storeId, trace);
    const outcome = await resolveRagAnswer(
      {
        question,
        familyPackVariant,
        thresholds: GATE_THRESHOLDS,
        noManualAnswer: NO_MANUAL_ANSWER,
        cautionNotice: CAUTION_NOTICE,
      },
      {
        search: async (userQuestion) => {
          trace({ stage: "search_input", augmented: userQuestion !== question, originalLength: question.length,
            searchInputLength: userQuestion.length, confirmedTargetIncluded: Boolean(familyPackVariant && userQuestion.includes(`${familyPackVariant} 패밀리팩`)),
            includesBFamilyPack: /B\s*패밀리\s*팩/u.test(userQuestion), franchiseId: franchiseScope.franchiseId });
          try { return await searchManualChunks(userQuestion, storeId, franchiseScope.franchiseId); }
          catch (error) {
            console.error("RAG search failed:", getSafeErrorDetails(error));
            const failure = error as { diagnosticService?: unknown; diagnosticHttpStatus?: unknown };
            trace({ stage: "external_api", service: failure?.diagnosticService === "embedding" ? "embedding" : failure?.diagnosticService === "search_rpc" ? "search_rpc" : "search_unknown",
              httpStatus: typeof failure?.diagnosticHttpStatus === "number" ? failure.diagnosticHttpStatus : null, reason: "REQUEST_FAILED" });
            throw error;
          }
        },
        generate: async (rawQuestion, chunks, variant) => {
          try {
            return await createGroundedAnswer(rawQuestion, chunks, variant, trace);
          } catch (error) {
            console.error("RAG generation failed:", getSafeErrorDetails(error));
            throw error;
          }
        },
        onDiagnostic: traceEnabled ? trace : undefined,
      },
    );

    // 검색·생성 장애는 근거 부족이 아니다. 로그·점주 알림 없이 기존 500 계약을 그대로 쓴다.
    if (outcome.kind === "system_error") {
      console.error("RAG query failed:", { code: outcome.code });
      return NextResponse.json({ error: "Unable to answer the question." }, { status: 500 });
    }

    console.info("RAG answer decision", {
      questionLength: question.length,
      status: outcome.response.status,
      matchCount: outcome.response.matches.length,
      usedSourceCount: outcome.response.sources?.length ?? 0,
      finalSimilarity: outcome.response.similarity,
    });

    const response = await finalizeRagQueryResponse({
      httpStatus: 200,
      question,
      storeId,
      response: outcome.response,
      // 단건 보류 알림은 insufficient일 때만, 반복 질문 알림은 모든 status에서 검사한다(응답 전 await, 실패해도 답변 유지).
      afterQuestionLogSaved: createQuestionLogFollowUp({
        storeId,
        escalate: outcome.escalate,
        getClient: createAdminClient,
      }),
    }, saveQuestionLog);
    return NextResponse.json(response);
  } catch (error) {
    console.error("RAG query failed:", getSafeErrorDetails(error));
    return NextResponse.json({ error: "Unable to answer the question." }, { status: 500 });
  }
}

async function createGroundedAnswer(question: string, chunks: ManualChunkMatch[], familyPackVariant?: string,
  trace?: (event: { stage: string; [key: string]: unknown }) => void): Promise<string> { // OpenAI Chat Completions API로 매뉴얼 근거 답변 생성
  const apiKey = getOpenAiApiKey();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GPT_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", { // gpt-4o 모델에 system/user 프롬프트 전달
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.2,
        max_tokens: GPT_MAX_OUTPUT_TOKENS,
        response_format: { type: "json_object" },
        messages: buildGroundedAnswerMessages(question, chunks, familyPackVariant),
      }),
      signal: controller.signal,
    });

    trace?.({ stage: "external_api", service: "answer", httpStatus: response.status, reason: response.ok ? "RESPONSE_OK" : "REQUEST_FAILED" });
    if (!response.ok) {
      // 응답 body/헤더는 포함하지 않고 status만 기록해 API 키 등 민감정보 노출 방지
      const guidance = response.status === 401 ? "Check OPENAI_API_KEY." : response.status === 429 ? "Check OpenAI quota and rate limits." : "Check OpenAI service availability and model access.";
      throw new Error(`OpenAI chat request failed with status ${response.status}. ${guidance}`);
    }

    const payload = (await response.json()) as OpenAiChatResponse;
    const answer = payload.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      throw new Error("OpenAI returned an empty answer.");
    }

    return answer;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenAI chat request timed out.");
    }
    if (error instanceof TypeError) {
      throw new Error("OpenAI chat request or response failed. Check network, DNS, proxy and TLS settings, then retry.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}