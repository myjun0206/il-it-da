// 직원 AI 대화 기록 공통 유틸 (server 전용 API에서 사용)

export const CONVERSATION_TITLE_MAX_LENGTH = 36;

/** 첫 질문으로 대화 제목을 만든다. (별도 AI 호출 없이 공백 정리 + 길이 제한) */
export function buildConversationTitle(question: string): string {
  const normalized = question.replace(/\s+/g, " ").trim();
  if (normalized.length <= CONVERSATION_TITLE_MAX_LENGTH) return normalized || "새 대화";
  return `${normalized.slice(0, CONVERSATION_TITLE_MAX_LENGTH).trimEnd()}…`;
}

/** migration 022(conversations 테이블)이 아직 적용되지 않은 환경 */
export function isMissingConversationTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export interface ConversationMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "answered" | "cautious" | "insufficient" | null;
  sourceTitle: string | null;
  sourceCategory: string | null;
  similarity: number | null;
  createdAt: string;
}

export interface ConversationSummaryDto {
  id: string;
  title: string;
  storeId: string;
  storeName: string;
  updatedAt: string;
}
