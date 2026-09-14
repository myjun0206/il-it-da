import { NextResponse } from "next/server";

import { searchManualChunks } from "@/lib/rag/search-manual-chunks";
import type { ManualChunkMatch, RagQueryResponse, RagSource } from "@/lib/rag/types";

export const runtime = "nodejs";

const MAX_QUESTION_LENGTH = 2_000;
const NO_MANUAL_ANSWER =
  "해당 질문에 관한 매뉴얼 내용을 찾지 못했습니다. 매장 관리자에게 문의해 주세요.";
const SYSTEM_PROMPT =
  "너는 프랜차이즈 매장 현장 직원을 돕는 AI 도우미이다. 오직 제공된 [참고 매뉴얼] 내용만을 근거로 간결하고 친절한 한국어로 답변하라. 매뉴얼 내용에 없는 정보는 절대 추측하거나 지어내지 말고, 정보가 부족하여 답변할 수 없음을 안내하고 매장 관리자에게 확인하도록 안내하라.";

type QueryBody = { //사용자가 보낸 질문 양식
  question?: unknown;
};

type OpenAiChatResponse = { //답변글
  choices?: Array<{ message?: { content?: string | null } }>;
};

function getOpenAiApiKey() { // OPENAI_API_KEY 환경변수 존재 여부 확인 후 반환
  const value = process.env.OPENAI_API_KEY;

  if (!value) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  return value;
} // api key 안전하게 가져오는 함수

export async function POST(request: Request): Promise<NextResponse<RagQueryResponse>> { // 직원 질문을 받아 매뉴얼 검색 후 GPT-4o 답변을 반환하는 API
  let body: QueryBody;

  try {
    body = (await request.json()) as QueryBody; // 요청 본문을 JSON으로 파싱
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : ""; // question 타입 검증 및 공백 제거

  if (!question) {
    return NextResponse.json({ error: "question is required." }, { status: 400 });
  }

  if (question.length > MAX_QUESTION_LENGTH) { // 질문 길이가 허용 범위를 초과하는지 검사
    return NextResponse.json(
      { error: `question must be ${MAX_QUESTION_LENGTH} characters or fewer.` },
      { status: 413 },
    );
  }

  try {
    const searchResults = await searchManualChunks(question); // Supabase Pgvector 기반 매뉴얼 청크 검색

    if (searchResults.length === 0) {
      return NextResponse.json({
        answer: NO_MANUAL_ANSWER,
        similarity: null,
        source: null,
        status: "answered",
      });
    }

    const context = searchResults // 검색된 청크들을 GPT 프롬프트용 컨텍스트 문자열로 조합
      .map((chunk, index) => `[매뉴얼 ${index + 1}: ${chunk.title}]\n${chunk.content}`)
      .join("\n\n");

    const answer = await createAnswer(question, context); // GPT-4o 호출로 근거 기반 답변 생성
    const topMatch = searchResults[0];

    return NextResponse.json({
      answer,
      similarity: topMatch.similarity_score,
      source: toRagSource(topMatch), // searchManualChunks() 스네이크 필드명 -> 응답 규격 필드명 명시적 매핑
      status: "answered",
    });
  } catch (error) {
    console.error("RAG query failed:", error instanceof Error ? error.message : "Unknown error");
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

  const response = await fetch("https://api.openai.com/v1/chat/completions", { // gpt-4o 모델에 system/user 프롬프트 전달
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `[참고 매뉴얼]\n${context}\n\n[직원 질문]\n${question}`,
        },
      ],
    }),
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
}