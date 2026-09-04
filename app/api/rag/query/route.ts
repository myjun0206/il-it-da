import { Pinecone } from "@pinecone-database/pinecone";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type QueryBody = {
  question?: unknown;
};

type OpenAiEmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

function getServerEnv(name: "OPENAI_API_KEY" | "PINECONE_API_KEY") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}.`);
  }

  return value;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QueryBody;
    const question = typeof body.question === "string" ? body.question.trim() : "";

    if (!question) {
      return NextResponse.json({ error: "question is required." }, { status: 400 });
    }

    if (question.length > 2_000) {
      return NextResponse.json({ error: "question must be 2,000 characters or fewer." }, { status: 413 });
    }

    const openAiApiKey = getServerEnv("OPENAI_API_KEY");
    const pineconeApiKey = getServerEnv("PINECONE_API_KEY");
    const embedding = await createEmbedding(question, openAiApiKey);
    const pinecone = new Pinecone({ apiKey: pineconeApiKey });
    const results = await pinecone.index("il-it-da-index").query({
      vector: embedding,
      topK: 3,
      includeMetadata: true,
    });
    const matches = results.matches ?? [];
    const context = matches
      .map((match, index) => {
        const text = getMetadataText(match.metadata);
        return text ? `[가이드 ${index + 1}]\n${text}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
    const answer = await createAnswer(question, context, openAiApiKey);

    return NextResponse.json({
      answer,
      sources: matches.map((match) => ({ id: match.id, score: match.score })),
    });
  } catch (error) {
    console.error("RAG query failed:", error);
    return NextResponse.json({ error: "Unable to answer the question." }, { status: 500 });
  }
}

async function createEmbedding(input: string, apiKey: string) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input, model: "text-embedding-3-small", encoding_format: "float" }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI embedding request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as OpenAiEmbeddingResponse;
  const embedding = payload.data?.[0]?.embedding;

  if (!embedding) {
    throw new Error("OpenAI returned an invalid embedding.");
  }

  return embedding;
}

async function createAnswer(question: string, context: string, apiKey: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "당신은 매장 알바생을 돕는 친절한 업무 안내 AI입니다. 제공된 매장 가이드만 근거로 답변하세요. 근거가 없으면 모른다고 말하고 사장님에게 확인하도록 안내하세요. 답변은 한국어로 짧고 명확하게 작성하세요.",
        },
        {
          role: "user",
          content: `매장 가이드 문맥:\n${context || "검색된 매장 가이드가 없습니다."}\n\n알바생 질문:\n${question}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI chat request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as OpenAiChatResponse;
  const answer = payload.choices?.[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error("OpenAI returned an empty answer.");
  }

  return answer;
}

function getMetadataText(metadata: Record<string, unknown> | undefined) {
  const text = metadata?.text;
  return typeof text === "string" ? text : "";
}