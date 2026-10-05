import { chunkManualText } from "@/lib/rag/chunk-manual";

export type ManualEditInput = {
  title?: unknown;
  category?: unknown;
  content?: unknown;
};

export function validateManualEdit(input: ManualEditInput):
  | { valid: true; update: Record<string, string> }
  | { valid: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, error: "제목·카테고리·본문을 객체 형식으로 보내 주세요." };
  }
  const update: Record<string, string> = {};
  const labels = { title: "제목", category: "카테고리", content: "본문" } as const;
  for (const field of ["title", "category", "content"] as const) {
    if (input[field] === undefined) continue;
    const value = input[field];
    if (typeof value !== "string" || !value.trim()) {
      return { valid: false, error: `${labels[field]}은(는) 빈 내용 없이 문자열로 입력해 주세요.` };
    }
    if (field === "content") {
      try { chunkManualText(value); }
      catch { return { valid: false, error: "본문은 비어 있지 않은 내용으로, 공백 정리 후 50,000자 이내로 입력해 주세요." }; }
    }
    update[field] = value.trim();
  }
  if (Object.keys(update).length === 0) {
    return { valid: false, error: "수정할 내용이 없습니다." };
  }
  return { valid: true, update };
}