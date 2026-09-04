import { Pinecone } from "@pinecone-database/pinecone";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type UploadBody = {
  text?: unknown;
  metadata?: unknown;
  namespace?: unknown;
};

type PineconeMetadata = Record<string, string | number | boolean | string[]>;

function getServerEnv(name: "OPENAI_API_KEY" | "PINECONE_API_KEY") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}.`);
  }

  return value;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as UploadBody;
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!text) {
      return NextResponse.json({ error: "text is required." }, { status: 400 });
    }

    if (text.length > 50_000) {
      return NextResponse.json({ error: "text must be 50,000 characters or fewer." }, { status: 413 });
    }

    const metadata = isMetadata(body.metadata) ? body.metadata : {};
    const namespace = typeof body.namespace === "string" ? body.namespace : "default";
    const openAiApiKey = getServerEnv("OPENAI_API_KEY");
    const pineconeApiKey = getServerEnv("PINECONE_API_KEY");

    const embeddingResponse = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: text,
        model: "text-embedding-3-small",
        encoding_format: "float",
      }),
    });

    if (!embeddingResponse.ok) {
      return NextResponse.json({ error: "Failed to create embedding." }, { status: 502 });
    }

    const embeddingPayload = (await embeddingResponse.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = embeddingPayload.data?.[0]?.embedding;

    if (!embedding) {
      return NextResponse.json({ error: "Embedding response was invalid." }, { status: 502 });
    }

    const pinecone = new Pinecone({ apiKey: pineconeApiKey });
    const index = pinecone.index("il-it-da-index");
    await index.namespace(namespace).upsert({
      records: [
        {
          id: crypto.randomUUID(),
          values: embedding,
          metadata: { ...metadata, text },
        },
      ],
    });

    return NextResponse.json({ success: true, namespace }, { status: 201 });
  } catch (error) {
    console.error("RAG upload failed:", error);
    return NextResponse.json({ error: "Unable to upload the guide." }, { status: 500 });
  }
}

function isMetadata(value: unknown): value is PineconeMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((item) => {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      return true;
    }

    return Array.isArray(item) && item.every((entry) => typeof entry === "string");
  });
}