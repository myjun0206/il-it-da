import { createHash } from "node:crypto";

export function conversationTraceTag(value: unknown): string | null {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return null;
  return createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 16);
}