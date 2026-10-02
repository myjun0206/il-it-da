export interface NoticeContentUpdateRequest {
  id: string;
  title: string;
  content: string;
}

export interface NoticeDeleteRequest {
  id: string;
}

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateNoticeContentUpdateRequest(value: unknown): ValidationResult<NoticeContentUpdateRequest> {
  if (!isRecord(value) || Object.keys(value).some((key) => !["id", "title", "content"].includes(key))) {
    return { success: false };
  }

  if (typeof value.id !== "string" || typeof value.title !== "string" || typeof value.content !== "string") {
    return { success: false };
  }

  return { success: true, data: { id: value.id, title: value.title, content: value.content } };
}

export function validateNoticeDeleteRequest(value: unknown): ValidationResult<NoticeDeleteRequest> {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "id") || typeof value.id !== "string") {
    return { success: false };
  }

  return { success: true, data: { id: value.id } };
}