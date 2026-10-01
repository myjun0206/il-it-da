/**
 * 생성 단계의 구조화 응답 파싱·검증.
 *
 * "모르겠습니다" 같은 문구를 정규식으로 찾지 않고, 모델이 answerable 필드로 직접 답한다.
 * 다만 모델이 answerable=true라고 해도 usedChunkIds가 실제로 건네준 청크에 속하는지
 * 서버에서 다시 대조한다(없는 근거를 지어내면 답변으로 쓰지 않는다).
 */

export class StructuredAnswerParseError extends Error {
  constructor() {
    super("Structured answer could not be parsed.");
    this.name = "StructuredAnswerParseError";
  }
}

export type StructuredAnswer = {
  answerable: boolean;
  answer: string;
  usedChunkIds: string[];
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

/** 파싱 실패는 근거 부족이 아니라 시스템 오류다. 호출부가 구분할 수 있도록 예외를 던진다. */
export function parseStructuredAnswer(raw: unknown): StructuredAnswer {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new StructuredAnswerParseError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StructuredAnswerParseError();
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StructuredAnswerParseError();
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.answerable !== "boolean") {
    throw new StructuredAnswerParseError();
  }

  const answer = typeof record.answer === "string" ? record.answer.trim() : "";

  if (record.answerable && !answer) {
    throw new StructuredAnswerParseError();
  }

  return { answerable: record.answerable, answer, usedChunkIds: toStringArray(record.usedChunkIds) };
}

/** 모델이 돌려준 근거 id 중 실제로 제공한 청크만 남긴다(순서는 제공 순서를 따른다). */
export function selectProvidedChunkIds(
  usedChunkIds: readonly string[],
  providedChunkIds: readonly string[],
): string[] {
  const used = new Set(usedChunkIds);
  return providedChunkIds.filter((chunkId) => used.has(chunkId));
}
