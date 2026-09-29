import type { RagStatus } from "./types";

export type SaveQuestionLogInput = {
  question: string;
  answer: string;
  similarityScore: number | null;
  status: RagStatus;
  sourceManualId: string | null;
  /** 서버가 이미 멤버십으로 검증한 매장 id. 요청 body 값을 그대로 넣지 않는다. */
  storeId: string | null;
};

export type QuestionLogPayload = {
  question: string;
  answer: string;
  similarity_score: number | null;
  status: RagStatus;
  source_manual_id: string | null;
  store_id: string | null;
};

export type QuestionLogWriterResult = {
  error: unknown | null;
  /** insert된 question_logs 행 id. 단건 에스컬레이션이 이 값으로 로그를 지목한다. */
  id?: string | null;
};

export type QuestionLogWriter = (
  payload: QuestionLogPayload,
) => Promise<QuestionLogWriterResult>;

export type SaveQuestionLogResult =
  | { saved: true; questionLogId: string | null }
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

/** 매장 id가 UUID 형식이 아니면 로그 자체를 버리지 않고 store_id만 비워 둔다. */
function normalizeStoreId(value: unknown): string | null {
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
    store_id: normalizeStoreId(candidate.storeId),
  };
}

/**
 * 022(question_logs.store_id)가 아직 적용되지 않은 DB에서는 store_id를 모르는 컬럼으로 거부한다.
 * 그 때 answered/cautious 로그까지 함께 유실되지 않도록 store_id 없이 한 번 더 시도한다.
 */
function isMissingStoreIdColumn(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code !== "42703" && code !== "PGRST204") {
    return false;
  }
  const message = (error as { message?: string } | null)?.message ?? "";
  return message.includes("store_id");
}

/** insert에 필요한 최소 표면만 받는다. 가짜 client로 022 미적용 상황까지 검증하기 위함이다. */
export type QuestionLogInsertClient = {
  from(table: string): {
    insert(payload: Record<string, unknown>): {
      select(columns: string): {
        single(): Promise<{ data: { id?: string } | null; error: unknown }>;
      };
    };
  };
};

export function createQuestionLogWriter(client: QuestionLogInsertClient): QuestionLogWriter {
  return async (payload) => {
    const inserted = await client.from("question_logs").insert(payload).select("id").single();

    if (!inserted.error) {
      return { error: null, id: inserted.data?.id ?? null };
    }

    if (isMissingStoreIdColumn(inserted.error)) {
      const { store_id: _unusedStoreId, ...legacyPayload } = payload;
      const retried = await client.from("question_logs").insert(legacyPayload).select("id").single();
      return { error: retried.error, id: retried.data?.id ?? null };
    }

    return { error: inserted.error, id: null };
  };
}

const defaultQuestionLogWriter: QuestionLogWriter = async (payload) => {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const client = createAdminClient() as unknown as QuestionLogInsertClient;
  return createQuestionLogWriter(client)(payload);
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

    return { saved: true, questionLogId: result.id ?? null };
  } catch {
    return { saved: false, code: "QUESTION_LOG_SAVE_FAILED" };
  }
}