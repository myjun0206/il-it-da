export interface OwnerNoticeCreateRequest {
  storeId: string;
  title: string;
  content: string;
}

type OwnerNoticeCreateRequestResult =
  | { success: true; data: OwnerNoticeCreateRequest }
  | { success: false; reason: "invalid_body" | "unsupported_field" | "missing_field" };

const ALLOWED_FIELDS = new Set(["storeId", "title", "content"]);

export function validateOwnerNoticeCreateRequest(value: unknown): OwnerNoticeCreateRequestResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { success: false, reason: "invalid_body" };
  }

  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !ALLOWED_FIELDS.has(key))) {
    return { success: false, reason: "unsupported_field" };
  }

  if (
    typeof body.storeId !== "string"
    || typeof body.title !== "string"
    || typeof body.content !== "string"
  ) {
    return { success: false, reason: "missing_field" };
  }

  return {
    success: true,
    data: {
      storeId: body.storeId,
      title: body.title,
      content: body.content,
    },
  };
}