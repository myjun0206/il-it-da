import { NextResponse } from "next/server";

import { buildGroundedAnswerMessages } from "@/lib/rag/answer-prompt";
import {
  authorizeRagStoreAccessForRequest,
  resolveRagStoreFranchiseForRequest,
} from "@/lib/rag/authorize-rag-store-access";
import { finalizeRagQueryResponse } from "@/lib/rag/finalize-rag-query-response";
import { resolveRagAnswer } from "@/lib/rag/resolve-rag-answer";
import { saveQuestionLog, type SaveQuestionLogResult } from "@/lib/rag/save-question-log";
import { escalateQuestionLogToStoreOwners } from "@/lib/notifications/escalate-question-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { searchManualChunks } from "@/lib/rag/search-manual-chunks";
import { validateQueryRequest } from "@/lib/rag/validate-query-request";
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
  const value = process.env.OPENAI_API_KEY;

  if (!value) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  return value;
}

// 최고 유사도 점수를 3단계 상태로 판정 (applyEvidenceGate가 같은 임계값을 쓴다)
const GATE_THRESHOLDS = { answered: ANSWERED_THRESHOLD, cautious: CAUTIOUS_THRESHOLD };

/**
 * 근거를 못 찾은 질문을 그 매장의 승인 점주에게 한 번만 알린다.
 *
 * storeId는 authorizeRagStoreAccessForRequest를 통과한 값만 넘긴다(body의 franchiseId는 쓰지 않는다).
 * 응답 전에 await하므로 서버리스에서 작업이 잘리지 않고, 실패해도 답변과 HTTP 상태는 그대로다.
 */
function escalateInsufficientQuestion(storeId: string) {
  return async (logResult: SaveQuestionLogResult): Promise<void> => {
    if (!logResult.saved || !logResult.questionLogId) {
      return;
    }

    const result = await escalateQuestionLogToStoreOwners(createAdminClient(), {
      questionLogId: logResult.questionLogId,
      storeId,
    });

    if (result.status === "failed") {
      console.error("[RAG] QUESTION_ESCALATION_FAILED", { status: result.status });
    }
  };
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

  const authorization = await authorizeRagStoreAccessForRequest(storeId);

  if (authorization.status === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (authorization.status === "FORBIDDEN") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    // 인증된 storeId로만 franchise 범위를 서버에서 결정한다(요청 body의 franchiseId는 신뢰하지 않음).
    // 확인할 수 없으면 검색 자체를 실행하지 않는다(fail-closed).
    const franchiseScope = await resolveRagStoreFranchiseForRequest(storeId);
    if (franchiseScope.status !== "RESOLVED") {
      throw new Error("Unable to resolve store franchise scope.");
    }

    const outcome = await resolveRagAnswer(
      {
        question,
        thresholds: GATE_THRESHOLDS,
        noManualAnswer: NO_MANUAL_ANSWER,
        cautionNotice: CAUTION_NOTICE,
      },
      {
        search: (userQuestion) =>
          searchManualChunks(userQuestion, storeId, franchiseScope.franchiseId),
        generate: createGroundedAnswer,
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
      afterQuestionLogSaved: outcome.escalate ? escalateInsufficientQuestion(storeId) : undefined,
    }, saveQuestionLog);
    return NextResponse.json(response);
  } catch (error) {
    console.error("RAG query failed:", getSafeErrorDetails(error));
    return NextResponse.json({ error: "Unable to answer the question." }, { status: 500 });
  }
}

async function createGroundedAnswer(question: string, chunks: ManualChunkMatch[]): Promise<string> { // OpenAI Chat Completions API로 매뉴얼 근거 답변 생성
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
        messages: buildGroundedAnswerMessages(question, chunks),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // 응답 body/헤더는 포함하지 않고 status만 기록해 API 키 등 민감정보 노출 방지
      throw new Error(`OpenAI chat request failed with status ${response.status}.`);
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
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}