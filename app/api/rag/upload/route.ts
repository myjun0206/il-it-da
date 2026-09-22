import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { indexApprovedManual } from "@/lib/rag/index-approved-manual";

export const runtime = "nodejs";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UploadRequestBody = {
  manualId?: unknown;
};

type UploadSuccessResponse = {
  manualId: string;
  chunkCount: number;
};

type UploadErrorResponse = {
  error: string;
};

export type UploadResponse = UploadSuccessResponse | UploadErrorResponse;

function verifyAuth(request: Request): { authorized: boolean; missingSecret?: boolean } {
  const secret = process.env.RAG_INDEXING_SECRET;

  // In development, allow without auth for testing
  if (process.env.NODE_ENV === "development" && (!secret || secret.length < 32)) {
    return { authorized: true };
  }

  if (!secret || secret.length < 32) {
    return { authorized: false, missingSecret: true };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { authorized: false };
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return { authorized: false };
  }

  const tokenBuffer = Buffer.from(token, "utf8");
  const secretBuffer = Buffer.from(secret, "utf8");

  if (tokenBuffer.length !== secretBuffer.length) {
    return { authorized: false };
  }

  if (!timingSafeEqual(tokenBuffer, secretBuffer)) {
    return { authorized: false };
  }

  return { authorized: true };
}

export async function POST(
  request: Request,
): Promise<NextResponse<UploadResponse>> {
  const auth = verifyAuth(request);

  if (auth.missingSecret) {
    console.error("RAG indexing authentication secret is not configured on the server.");
    return NextResponse.json(
      { error: "Server authentication is not configured." },
      { status: 500 },
    );
  }

  if (!auth.authorized) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: UploadRequestBody;

  try {
    body = (await request.json()) as UploadRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.manualId !== "string"
  ) {
    return NextResponse.json({ error: "manualId is required." }, { status: 400 });
  }

  const manualId = body.manualId.trim();

  if (!manualId) {
    return NextResponse.json({ error: "manualId cannot be empty." }, { status: 400 });
  }

  if (!UUID_REGEX.test(manualId)) {
    return NextResponse.json({ error: "manualId must be a valid UUID." }, { status: 400 });
  }

  try {
    const result = await indexApprovedManual(manualId);

    return NextResponse.json(
      {
        manualId: result.manualId,
        chunkCount: result.chunkCount,
      },
      { status: 200 },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "";

    if (
      errorMessage === "Approved manual not found." ||
      errorMessage === "Manual is not approved."
    ) {
      return NextResponse.json(
        { error: "Approved manual not found." },
        { status: 404 },
      );
    }

    console.error("Failed to index approved manual.");
    return NextResponse.json(
      { error: "Failed to index manual." },
      { status: 500 },
    );
  }
}
