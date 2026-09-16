import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { indexManualById } from "@/lib/rag/index-manual";

export const runtime = "nodejs";

type WebhookRecord = {
  id?: unknown;
  status?: unknown;
};

type SupabaseWebhookPayload = {
  type?: unknown;
  record?: unknown;
  old_record?: unknown;
};

type WebhookResponse = {
  success: boolean;
  manualId?: string;
  skipped?: boolean;
  error?: string;
};

function isAuthorized(request: Request): boolean {
  const expectedSecret = process.env.WEBHOOK_SECRET;
  const providedSecret = request.headers.get("x-webhook-secret");

  if (!expectedSecret || !providedSecret) return false;

  const expectedBuffer = Buffer.from(expectedSecret, "utf8");
  const providedBuffer = Buffer.from(providedSecret, "utf8");

  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

function parseRecord(value: unknown): WebhookRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as WebhookRecord;
}

function getSafeErrorDetails(error: unknown): { name: string; message: string } {
  const name = error instanceof Error ? error.name : "UnknownError";
  const rawMessage = error instanceof Error ? error.message : "Unknown error";
  const message = rawMessage
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(api[_ -]?key|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");

  return { name, message };
}

export async function POST(
  request: Request,
): Promise<NextResponse<WebhookResponse>> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  let payload: SupabaseWebhookPayload;

  try {
    payload = (await request.json()) as SupabaseWebhookPayload;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const record = parseRecord(payload.record);
  const isSupportedEvent = payload.type === "INSERT" || payload.type === "UPDATE";

  if (!isSupportedEvent || record?.status !== "approved") {
    return NextResponse.json({ success: true, skipped: true }, { status: 200 });
  }

  if (typeof record.id !== "string" || !record.id.trim()) {
    return NextResponse.json(
      { success: false, error: "Approved record id is required." },
      { status: 400 },
    );
  }

  const manualId = record.id.trim();

  try {
    await indexManualById(manualId);
    return NextResponse.json({ success: true, manualId }, { status: 200 });
  } catch (error) {
    console.error("Manual indexing webhook failed", {
      manualId,
      ...getSafeErrorDetails(error),
    });

    return NextResponse.json(
      { success: false, manualId, error: "Manual indexing was not completed." },
      { status: 200 },
    );
  }
}