export type ProviderUsage = {
  service: "embedding" | "generation" | "interpretation";
  model: string;
  httpStatus: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export function recordProviderUsage(usage: ProviderUsage) {
  const token = (value: number | null) => value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const inputTokens = token(usage.inputTokens);
  const outputTokens = token(usage.outputTokens);
  const record = {
    observedAt: new Date().toISOString(), service: usage.service, model: usage.model,
    httpStatus: usage.httpStatus, inputTokens, outputTokens,
    usageVerified: inputTokens !== null && outputTokens !== null,
    estimatedUsd: inputTokens === null || outputTokens === null ? null
      : (inputTokens * (usage.service === "embedding" ? .02 : 2.5) + outputTokens * 10) / 1e6,
  };
  try { console.info("[RAG_USAGE]", JSON.stringify(record)); } catch {}
  return record;
}