import type { SaveQuestionLogInput, SaveQuestionLogResult } from "./save-question-log";
import type { RagQueryResponse, RagQuerySuccessResponse, RagStatus } from "./types";

export type QuestionLogSaverInput = SaveQuestionLogInput;
export type RagQueryFinalizationInput = {
  httpStatus: number;
  question: string;
  /** 서버가 이미 멤버십으로 검증한 매장 id. */
  storeId: string | null;
  response: RagQueryResponse;
  /**
   * 로그 저장이 끝난 뒤 이어서 실행하는 후속 작업(단건 에스컬레이션 등).
   * 서버리스에서 응답 후 작업이 잘리지 않도록 await하되, 실패해도 응답을 바꾸지 않는다.
   */
  afterQuestionLogSaved?: (result: SaveQuestionLogResult) => Promise<void>;
};
export type RagQueryFinalizationSaver = (
  input: QuestionLogSaverInput,
) => Promise<SaveQuestionLogResult>;

function isSuccessfulRagResponse(
  response: RagQueryFinalizationInput["response"],
): response is RagQuerySuccessResponse & { status: RagStatus } {
  return "answer" in response
    && typeof response.answer === "string"
    && (response.status === "answered" || response.status === "cautious" || response.status === "insufficient");
}

export function toQuestionLogInput(
  question: string,
  response: RagQuerySuccessResponse & { status: RagStatus },
  storeId: string | null,
): QuestionLogSaverInput {
  return {
    question,
    answer: response.answer,
    similarityScore: response.similarity,
    status: response.status,
    sourceManualId: response.source?.manualId ?? null,
    storeId,
  };
}

export async function finalizeRagQueryResponse(
  input: RagQueryFinalizationInput,
  saver: RagQueryFinalizationSaver,
): Promise<RagQueryFinalizationInput["response"]> {
  if (input.httpStatus !== 200 || !isSuccessfulRagResponse(input.response)) {
    return input.response;
  }

  let saveResult: SaveQuestionLogResult = { saved: false, code: "QUESTION_LOG_SAVE_FAILED" };

  try {
    saveResult = await saver(toQuestionLogInput(input.question, input.response, input.storeId));
  } catch {
    // Question-log persistence is best-effort and must never alter the RAG response.
  }

  if (input.afterQuestionLogSaved) {
    try {
      await input.afterQuestionLogSaved(saveResult);
    } catch {
      // Follow-up work is best-effort and must never alter the RAG response.
    }
  }

  return input.response;
}
