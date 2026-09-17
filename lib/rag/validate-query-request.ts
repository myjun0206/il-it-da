import type { RagQueryRequest } from "@/lib/rag/types";

const MAX_QUESTION_LENGTH = 2_000;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type QueryRequestValidationResult =
  | { success: true; data: RagQueryRequest }
  | { success: false; error: string; status: 400 | 413 };

export function validateQueryRequest(body: unknown): QueryRequestValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { success: false, error: "Invalid JSON body.", status: 400 };
  }

  const record = body as Record<string, unknown>;
  const question = typeof record.question === "string" ? record.question.trim() : "";
  const storeId = typeof record.storeId === "string" ? record.storeId.trim() : "";

  if (!question) {
    return { success: false, error: "question is required.", status: 400 };
  }

  if (!UUID_REGEX.test(storeId)) {
    return { success: false, error: "storeId must be a valid UUID.", status: 400 };
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    return {
      success: false,
      error: `question must be ${MAX_QUESTION_LENGTH} characters or fewer.`,
      status: 413,
    };
  }

  return { success: true, data: { question, storeId } };
}