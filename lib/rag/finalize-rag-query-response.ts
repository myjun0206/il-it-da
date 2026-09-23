import type { SaveQuestionLogInput, SaveQuestionLogResult } from "./save-question-log";
import type { RagQueryResponse, RagQuerySuccessResponse, RagStatus } from "./types";

export type QuestionLogSaverInput = SaveQuestionLogInput;
export type RagQueryFinalizationInput = {
  httpStatus: number;
  question: string;
  response: RagQueryResponse;
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
): QuestionLogSaverInput {
  return {
    question,
    answer: response.answer,
    similarityScore: response.similarity,
    status: response.status,
    sourceManualId: response.source?.manualId ?? null,
  };
}

export async function finalizeRagQueryResponse(
  input: RagQueryFinalizationInput,
  saver: RagQueryFinalizationSaver,
): Promise<RagQueryFinalizationInput["response"]> {
  if (input.httpStatus !== 200 || !isSuccessfulRagResponse(input.response)) {
    return input.response;
  }

  try {
    await saver(toQuestionLogInput(input.question, input.response));
  } catch {
    // Question-log persistence is best-effort and must never alter the RAG response.
  }

  return input.response;
}
