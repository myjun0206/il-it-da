export type ProviderSystemErrorCode = "PROVIDER_QUOTA_EXCEEDED" | "PROVIDER_RATE_LIMITED" | "PROVIDER_AUTH_FAILED" | "PROVIDER_PERMISSION_DENIED" | "PROVIDER_UNAVAILABLE";

export function createProviderTransportError(service: "embedding" | "generation" | "interpretation") {
  return Object.assign(new Error(`OpenAI ${service} transport failed or timed out.`), {
    diagnosticService: service, diagnosticProviderCode: "PROVIDER_UNAVAILABLE",
  });
}

function safeMessage(value: unknown) {
  if (typeof value !== "string") return null;
  let message = value;
  const secret = process.env.OPENAI_API_KEY?.trim();
  if (secret) message = message.split(secret).join("[REDACTED]");
  return message.replace(/sk-[A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+/g, "[REDACTED]")
    .replace(/(?:Bearer\s+\S+|(?:authorization|cookie|token|api[_ -]?key)\s*[:=]\s*[^\r\n]+)/gi, "[REDACTED]").slice(0, 600);
}

function safeLabel(value: unknown) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,79}$/i.test(value) && safeMessage(value) === value ? value : null;
}

export function getProviderFailure(error: unknown): { code: ProviderSystemErrorCode; providerRequestId?: string } | null {
  if (!error || typeof error !== "object") return null;
  const failure = error as { diagnosticProviderCode?: unknown; diagnosticHttpStatus?: unknown; diagnosticProviderRequestId?: unknown };
  const codes: readonly unknown[] = ["PROVIDER_QUOTA_EXCEEDED", "PROVIDER_RATE_LIMITED", "PROVIDER_AUTH_FAILED", "PROVIDER_PERMISSION_DENIED", "PROVIDER_UNAVAILABLE"];
  const status = failure.diagnosticHttpStatus;
  const code = codes.includes(failure.diagnosticProviderCode) ? failure.diagnosticProviderCode as ProviderSystemErrorCode
    : status === 401 ? "PROVIDER_AUTH_FAILED" : status === 403 ? "PROVIDER_PERMISSION_DENIED"
    : typeof status === "number" && status >= 400 && status <= 599 ? "PROVIDER_UNAVAILABLE" : null;
  if (!code) return null;
  const requestId = failure.diagnosticProviderRequestId;
  return { code, ...(typeof requestId === "string" && /^req_[a-z0-9_-]{1,160}$/i.test(requestId) && safeMessage(requestId) === requestId
    ? { providerRequestId: requestId } : {}) };
}

export async function createProviderHttpError(response: Response, service: "embedding" | "generation" | "interpretation", model: string) {
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = null; }
  const error = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
  const fields = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const errorCode = safeLabel(fields.code);
  const errorType = safeLabel(fields.type);
  const quota = [errorCode, errorType].some(value => value === "insufficient_quota" || value === "billing_hard_limit_reached");
  const code: ProviderSystemErrorCode = response.status === 401 ? "PROVIDER_AUTH_FAILED"
    : response.status === 403 ? "PROVIDER_PERMISSION_DENIED"
    : response.status === 429 && quota ? "PROVIDER_QUOTA_EXCEEDED"
    : response.status === 429 && (errorCode === "rate_limit_exceeded" || errorType === "rate_limit_exceeded") ? "PROVIDER_RATE_LIMITED"
    : "PROVIDER_UNAVAILABLE";
  const rawRequestId = response.headers?.get("x-request-id");
  const rawRetry = response.headers?.get("retry-after");
  const rawRetryMs = response.headers?.get("retry-after-ms");
  const retrySeconds = rawRetry && /^\d+(?:\.\d+)?$/.test(rawRetry) ? Number(rawRetry) : null;
  const retryDate = rawRetry && retrySeconds === null ? Date.parse(rawRetry) : NaN;
  const retryAfterMs = rawRetryMs && /^\d+(?:\.\d+)?$/.test(rawRetryMs) ? Number(rawRetryMs)
    : retrySeconds !== null ? retrySeconds * 1000 : Number.isFinite(retryDate) ? Math.max(0, retryDate - Date.now()) : null;
  const reset = (name: string) => {
    const value = response.headers?.get(name);
    return value && value.length <= 64 && /^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(value) ? value : null;
  };
  const record = {
    observedAt: new Date().toISOString(), service, model, httpStatus: response.status, code,
    errorType, errorCode, message: safeMessage(fields.message),
    requestId: rawRequestId && /^req_[a-z0-9_-]{1,160}$/i.test(rawRequestId) && safeMessage(rawRequestId) === rawRequestId ? rawRequestId : null,
    retryAfterMs: retryAfterMs !== null && Number.isFinite(retryAfterMs) ? retryAfterMs : null,
    resetRequests: reset("x-ratelimit-reset-requests"), resetTokens: reset("x-ratelimit-reset-tokens"),
  };
  try { console.error("[RAG_PROVIDER_ERROR]", JSON.stringify(record)); } catch {}
  return Object.assign(new Error(`OpenAI ${service} request failed with status ${response.status}. ${code}`), {
    diagnosticService: service, diagnosticHttpStatus: response.status, diagnosticProviderCode: code, diagnosticProviderRequestId: record.requestId,
  });
}