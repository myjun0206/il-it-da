export type PresentationPolicy =
  | { enabled: false }
  | { enabled: true; userIds: readonly string[]; storeId: string; expiresAt: number };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readPresentationPolicy(env: Record<string, string | undefined>): PresentationPolicy {
  if (env.PRESENTATION_MODE !== "1") return { enabled: false };
  const userIds = (env.PRESENTATION_USER_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const validIds = userIds.length === 2 && new Set(userIds).size === 2
    && userIds.every(value => uuidPattern.test(value));
  const storeId = env.PRESENTATION_STORE_ID ?? "";
  const expiresAt = Date.parse(env.PRESENTATION_EXPIRES_AT ?? "");
  return { enabled: true, userIds: validIds ? userIds : [], storeId: uuidPattern.test(storeId) ? storeId : "", expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0 };
}

export function presentationAccess(
  policy: PresentationPolicy,
  pathname: string,
  method: string,
  userId: string | null,
  now = Date.now(),
): "allow" | "unauthenticated" | "forbidden" | "unavailable" {
  if (!policy.enabled) return "allow";
  if (policy.userIds.length !== 2 || !policy.storeId || now >= policy.expiresAt) return "unavailable";
  if (/^\/(?:signup|auth\/callback|find-account|change-password)(?:\/|$)/.test(pathname)
    || /^\/api\/(?:signup|stores\/search|auth\/(?:signup|oauth|oauth-onboarding|send-verification|find-|change-password))/.test(pathname)
    || /^\/(?:staff|boss)\/stores\/(?:add|requests)(?:\/|$)/.test(pathname)) return "forbidden";
  if (pathname === "/" && method === "GET") return "allow";
  if (["/api/auth/login", "/api/auth/session"].includes(pathname) && ["GET", "POST", "DELETE"].includes(method)) return "allow";
  if (!userId) return "unauthenticated";
  if (!policy.userIds.includes(userId)) return "forbidden";
  if (method === "GET" || method === "HEAD") return "allow";
  if (method === "POST" && pathname === "/api/staff/chat") return "allow";
  if (pathname === "/api/store-manuals" && method === "POST") return "allow";
  if (/^\/api\/store-manuals\/[^/]+$/.test(pathname) && method === "PATCH") return "allow";
  if (/^\/api\/notifications\/[^/]+\/(?:mark-read|mark-unread)$/.test(pathname) && method === "POST") return "allow";
  if (/^\/api\/notices\/[^/]+\/read$/.test(pathname) && method === "POST") return "allow";
  if (pathname === "/api/boss/question-logs" && method === "PATCH") return "allow";
  return "forbidden";
}

export function presentationOperation(pathname: string, method: string): "chat" | "manual" | null {
  if (pathname === "/api/staff/chat" && method === "POST") return "chat";
  if (method === "POST" && pathname === "/api/store-manuals") return "manual";
  if (method === "PATCH" && /^\/api\/store-manuals\/[^/]+$/.test(pathname)) return "manual";
  return null;
}

export function validPresentationBody(body: unknown, operation: "chat" | "manual", storeId: string): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  if (value.storeId !== storeId) return false;
  if (operation === "chat") {
    return typeof value.question === "string" && value.question.trim().length > 0 && value.question.length <= 500
      && (value.conversationId == null || typeof value.conversationId === "string" && uuidPattern.test(value.conversationId));
  }
  if (value.category !== "PRESENTATION") return false;
  if (typeof value.content === "string") return value.content.trim().length > 0 && value.content.length <= 1000;
  if (!Array.isArray(value.items) || value.items.length !== 1) return false;
  const item = value.items[0];
  const content = typeof item === "string" ? item : item && typeof item === "object" ? item.content : null;
  return typeof content === "string" && content.trim().length > 0 && content.length <= 1000;
}

export async function reservePresentationOperation(
  reserve: (args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>,
  args: Record<string, unknown>,
): Promise<"allow" | "limited" | "unavailable"> {
  try {
    const { data, error } = await reserve(args);
    if (error || typeof data !== "boolean") return "unavailable";
    return data ? "allow" : "limited";
  } catch {
    return "unavailable";
  }
}

export async function readPresentationBody(request: Request): Promise<unknown> {
  const reader = request.clone().body?.getReader();
  if (!reader) throw new Error("PRESENTATION_BODY_REQUIRED");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 8000) throw new Error("PRESENTATION_BODY_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}