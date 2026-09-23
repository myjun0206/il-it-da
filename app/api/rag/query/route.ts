import { NextResponse } from "next/server";

import { buildAnswerPromptMessages, buildManualContext } from "@/lib/rag/answer-prompt";
import { authorizeRagStoreAccessForRequest } from "@/lib/rag/authorize-rag-store-access";
import { finalizeRagQueryResponse } from "@/lib/rag/finalize-rag-query-response";
import { saveQuestionLog } from "@/lib/rag/save-question-log";
import { searchManualChunks } from "@/lib/rag/search-manual-chunks";
import { validateQueryRequest } from "@/lib/rag/validate-query-request";
import type {
  ManualChunkMatch,
  RagQueryResponse,
  RagSource,
  RagStatus,
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

// 최고 유사도 점수를 3단계 상태로 판정
function resolveStatus(similarity: number): RagStatus {
  if (similarity >= ANSWERED_THRESHOLD) {
    return "answered";
  }
  if (similarity >= CAUTIOUS_THRESHOLD) {
    return "cautious";
  }
  return "insufficient";
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
    const searchResults = await searchManualChunks(question, storeId); // Supabase Pgvector 기반 매뉴얼 청크 검색

    if (searchResults.length === 0) {
      const response = await finalizeRagQueryResponse({
        httpStatus: 200,
        question,
        response: {
          answer: NO_MANUAL_ANSWER,
          similarity: null,
          source: null,
          status: "insufficient",
          matches: [],
        },
      }, saveQuestionLog);
      return NextResponse.json(response);
    }

    const topMatch = searchResults[0];
    const matches = searchResults.map((match) => ({
      title: match.title,
      category: match.category,
      similarity: match.similarity_score,
      rawSimilarity: match.raw_similarity_score,
      keywordBoost: match.keyword_boost,
    }));

    const status = resolveStatus(topMatch.similarity_score);

    console.info("RAG search result", {
      questionLength: question.length,
      status,
      matchCount: matches.length,
      rawSimilarity: topMatch.raw_similarity_score,
      keywordBoost: topMatch.keyword_boost,
      finalSimilarity: topMatch.similarity_score,
    });

    if (status === "insufficient") {
      // 유사도가 낮으면 추측 답변을 막기 위해 GPT를 호출하지 않음
      const response = await finalizeRagQueryResponse({
        httpStatus: 200,
        question,
        response: {
          answer: NO_MANUAL_ANSWER,
          similarity: topMatch.similarity_score,
          source: null,
          status: "insufficient",
          matches,
        },
      }, saveQuestionLog);
      return NextResponse.json(response);
    }

    const context = buildManualContext(searchResults); // 검색된 청크들을 GPT 프롬프트용 컨텍스트 문자열로 조합

    let answer = await createAnswer(question, context); // GPT-4o 호출로 근거 기반 답변 생성

    if (status === "cautious") {
      answer += CAUTION_NOTICE;
    }

    const response = await finalizeRagQueryResponse({
      httpStatus: 200,
      question,
      response: {
        answer,
        similarity: topMatch.similarity_score,
        source: toRagSource(topMatch), // searchManualChunks() 스네이크 필드명 -> 응답 규격 필드명 명시적 매핑
        status,
        matches,
      },
    }, saveQuestionLog);
    return NextResponse.json(response);
  } catch (error) {
    console.error("RAG query failed:", getSafeErrorDetails(error));
    return NextResponse.json({ error: "Unable to answer the question." }, { status: 500 });
  }
}

// searchManualChunks()의 snake_case 필드를 응답 규격의 camelCase RagSource로 변환
function toRagSource(match: ManualChunkMatch): RagSource {
  return {
    manualId: match.manual_id,
    title: match.title,
    category: match.category,
  };
}

async function createAnswer(question: string, context: string): Promise<string> { // OpenAI Chat Completions API로 매뉴얼 근거 답변 생성
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
        messages: buildAnswerPromptMessages(question, context),
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