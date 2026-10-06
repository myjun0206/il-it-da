export type MarkNoticeAsReadResult =
  | { succeeded: true; alreadyRead: boolean }
  | { succeeded: false; alreadyRead: false };

export function getNoticeViewCountIncrement(result: MarkNoticeAsReadResult): number {
  return result.succeeded && !result.alreadyRead ? 1 : 0;
}

export async function markNoticeAsRead(noticeId: string): Promise<MarkNoticeAsReadResult> {
  try {
    const response = await fetch(`/api/notices/${encodeURIComponent(noticeId)}/read`, {
      method: "POST",
      credentials: "include",
    });

    if (!response.ok) {
      console.warn("[NOTICES] READ_MARK_FAILED", { status: response.status });
      return { succeeded: false, alreadyRead: false };
    }

    const payload: unknown = await response.json();
    if (
      typeof payload !== "object"
      || payload === null
      || !("success" in payload)
      || payload.success !== true
      || !("alreadyRead" in payload)
      || typeof payload.alreadyRead !== "boolean"
    ) {
      console.warn("[NOTICES] READ_MARK_FAILED", { reason: "invalid_response" });
      return { succeeded: false, alreadyRead: false };
    }

    return { succeeded: true, alreadyRead: payload.alreadyRead };
  } catch (error) {
    console.warn("[NOTICES] READ_MARK_FAILED", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { succeeded: false, alreadyRead: false };
  }
}