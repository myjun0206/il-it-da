import { randomUUID } from "node:crypto";

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const EMAIL_PATTERN = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const BEARER_PATTERN = /\bBearer\s+\S+/gi;
const PHONE_PATTERN = /\+?\d[\d ().-]{7,}\d/g;

type UnknownErrorFields = {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  stack?: unknown;
};

export interface DiagnosticErrorContext {
  requestId: string;
  stage: string;
  userId?: string | null;
  role?: string;
  storeId?: string | null;
  franchiseId?: string | null;
  storeName?: string | null;
  userName?: string | null;
  sessionPresent?: boolean;
  [key: string]: string | number | boolean | null | undefined;
}

export function createDiagnosticRequestId(): string {
  return randomUUID();
}

function maskIdentifier(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return `…${value.slice(-6)}`;
}

function redactText(value: unknown, sensitiveValues: string[]): string | undefined {
  if (typeof value !== "string" || !value) return undefined;

  let redacted = value;
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue.length >= 3) {
      redacted = redacted.split(sensitiveValue).join("[redacted]");
    }
  }

  return redacted
    .replace(JWT_PATTERN, "[redacted-jwt]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(UUID_PATTERN, "[redacted-id]")
    .replace(PHONE_PATTERN, "[redacted-phone]")
    .slice(0, 3000);
}

export function logDiagnosticError(
  scope: string,
  stage: string,
  error: unknown,
  context: Omit<DiagnosticErrorContext, "stage">,
): void {
  const errorFields = (error && typeof error === "object" ? error : {}) as UnknownErrorFields;
  const sensitiveValues = [context.userId, context.storeId, context.franchiseId, context.storeName, context.userName]
    .filter((value): value is string => typeof value === "string");
  const { userId, storeId, franchiseId, storeName, userName, ...safeContext } = context;

  console.error(`[${scope}] ${stage}`, {
    timestamp: new Date().toISOString(),
    ...safeContext,
    userRef: maskIdentifier(typeof userId === "string" ? userId : undefined),
    storeRef: maskIdentifier(typeof storeId === "string" ? storeId : undefined),
    franchiseRef: maskIdentifier(typeof franchiseId === "string" ? franchiseId : undefined),
    hasStoreName: Boolean(storeName),
    hasUserName: Boolean(userName),
    error: {
      name: typeof errorFields.name === "string" ? errorFields.name : "UnknownError",
      code: typeof errorFields.code === "string" ? errorFields.code : undefined,
      message: redactText(errorFields.message, sensitiveValues),
      details: redactText(errorFields.details, sensitiveValues),
      hint: redactText(errorFields.hint, sensitiveValues),
      stack: redactText(errorFields.stack, sensitiveValues),
    },
  });
}