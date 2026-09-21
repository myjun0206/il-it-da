import type { RagStatus } from "./types";

export type SaveQuestionLogInput = {
  question: string;
  answer: string;
  similarityScore: number | null;
  status: RagStatus;
  sourceManualId: string | null;
};

export type QuestionLogPayload = {
  question: string;
  answer: string;
  similarity_score: number | null;
  status: RagStatus;
  source_manual_id: string | null;
};

export type QuestionLogWriterResult = {
  error: unknown | null;
};

export type QuestionLogWriter = (
  payload: QuestionLogPayload,
) => Promise<QuestionLogWriterResult>;

export type SaveQuestionLogResult =
  | { saved: true }
  | {
      saved: false;
      code: "INVALID_INPUT" | "QUESTION_LOG_SAVE_FAILED";
    };

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRagStatus(value: unknown): value is RagStatus {
  return value === "answered" || value === "cautious" || value === "insufficient";
}

function normalizeSimilarity(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -1 || value > 1) {
    return null;
  }

  return value;
}

function normalizeSourceManualId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return UUID_REGEX.test(normalized) ? normalized : null;
}

function buildQuestionLogPayload(input: SaveQuestionLogInput): QuestionLogPayload | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const candidate = input as unknown as Record<string, unknown>;
  if (typeof candidate.question !== "string" || typeof candidate.answer !== "string") {
    return null;
  }

  const question = candidate.question.trim();
  const answer = candidate.answer.trim();

  if (!question || !answer || !isRagStatus(candidate.status)) {
    return null;
  }

  return {
    question,
    answer,
    similarity_score: normalizeSimilarity(candidate.similarityScore),
    status: candidate.status,
    source_manual_id: normalizeSourceManualId(candidate.sourceManualId),
  };
}

const defaultQuestionLogWriter: QuestionLogWriter = async (payload) => {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { error } = await createAdminClient().from("question_logs").insert(payload);

  return { error };
};

export async function saveQuestionLog(
  input: SaveQuestionLogInput,
  writer: QuestionLogWriter = defaultQuestionLogWriter,
): Promise<SaveQuestionLogResult> {
  if (typeof window !== "undefined") {
    return { saved: false, code: "QUESTION_LOG_SAVE_FAILED" };
  }

  const payload = buildQuestionLogPayload(input);
  if (!payload) {
    return { saved: false, code: "INVALID_INPUT" };
  }

  try {
    const result = await writer(payload);
    if (result.error) {
      return { saved: false, code: "QUESTION_LOG_SAVE_FAILED" };
    }

    return { saved: true };
  } catch {
    return { saved: false, code: "QUESTION_LOG_SAVE_FAILED" };
  }
}