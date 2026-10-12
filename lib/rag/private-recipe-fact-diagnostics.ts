import { appendFileSync, mkdirSync, openSync, closeSync, accessSync, constants, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import type { RecipeFactDiagnostic, VerifiedRecipeSourceFact } from "@/lib/rag/recipe-fact-verification";

export const PRIVATE_RECIPE_FACT_PATH = "local-data/rag-recipe-fact-diagnostics.jsonl";
export const PRIVATE_RECIPE_EXECUTION_PATH = "local-data/rag-recipe-execution-diagnostics.jsonl";
export type RecipeProviderUsage = { service: "embedding" | "generation"; httpStatus: number; inputTokens: number | null; outputTokens: number | null };
export function preparePrivateRecipeExecutionCapture(directory = process.cwd()) {
  execFileSync("git", ["check-ignore", "-q", "--", PRIVATE_RECIPE_EXECUTION_PATH], { cwd: directory, stdio: "ignore" });
  accessSync(path.join(directory, PRIVATE_RECIPE_FACT_PATH), constants.R_OK | constants.W_OK);
  const file = path.join(directory, PRIVATE_RECIPE_EXECUTION_PATH);
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file) && !statSync(file).isFile()) throw new Error("PRIVATE_EXECUTION_PATH_INVALID");
  const descriptor = openSync(file, "a", 0o600);
  closeSync(descriptor);
}
const label = (value: unknown): value is string => typeof value === "string" && /^[가-힣A-Za-z ]{1,80}$/u.test(value);
const numericFragment = /^(?:약\s*)?(?:섭씨\s*)?\d{1,5}(?:\.\d{1,4})?(?:\s*(?:℃|°C|도)?\s*(?:[~～–-]|에서)\s*\d{1,5}(?:\.\d{1,4})?)?\s*(?:ml|g|℃|°C|도|%)$/iu;
const rules = new Set(["MATCH", "MISSING", "VALUE_OR_RANGE_MISMATCH", "UNIT_MISMATCH", "BASIS_MISMATCH", "APPROXIMATION_MISMATCH"]);

function valueProjection(value: RecipeFactDiagnostic["expected"]) {
  if (!value || typeof value.quantity !== "string" || !/^(?:약 )?\d{1,5}(?:\.\d{1,4})?(?:[~～-]\d{1,5}(?:\.\d{1,4})?)?$/u.test(value.quantity)
    || !["ml", "g", "℃", "%"].includes(value.unit) || typeof value.approximate !== "boolean"
    || !Number.isFinite(value.lower) || !Number.isFinite(value.upper) || Math.abs(value.lower) > 100000 || Math.abs(value.upper) > 100000
    || value.basis !== undefined && !label(value.basis)) throw new Error("PRIVATE_FACT_SHAPE_INVALID");
  return { quantity: value.quantity, unit: value.unit, approximate: value.approximate, lower: value.lower, upper: value.upper,
    ...(value.basis ? { basis: value.basis } : {}) };
}

export function recordPrivateRecipeFactDiagnostic(traceId: string, diagnostic: RecipeFactDiagnostic,
  options: { development: boolean; directory?: string }): boolean {
  if (!options.development) return false;
  try {
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(traceId) || diagnostic.version !== 1
      || !label(diagnostic.menu) || !label(diagnostic.ingredient) || !["HOT", "ICE"].includes(diagnostic.temperature)
      || typeof diagnostic.requested !== "boolean" || !rules.has(diagnostic.rule)
      || diagnostic.numericFragment !== null && !numericFragment.test(diagnostic.numericFragment)) return false;
    const directory = options.directory ?? process.cwd();
    execFileSync("git", ["check-ignore", "-q", "--", PRIVATE_RECIPE_FACT_PATH], { cwd: directory, stdio: "ignore" });
    const record = { traceId, observedAt: new Date().toISOString(), version: 1, menu: diagnostic.menu, temperature: diagnostic.temperature,
      ingredient: diagnostic.ingredient, requested: diagnostic.requested, expected: valueProjection(diagnostic.expected),
      extracted: diagnostic.extracted ? valueProjection(diagnostic.extracted) : null, rule: diagnostic.rule, numericFragment: diagnostic.numericFragment };
    const file = path.join(directory, PRIVATE_RECIPE_FACT_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(record) + "\n", { encoding: "utf8", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export function recordPrivateRecipeExecutionEvent(traceId: string, event:
  | ({ stage: "provider_usage" } & RecipeProviderUsage)
  | { stage: "source_rendering"; facts: readonly VerifiedRecipeSourceFact[]; renderedAnswer: string }
  | { stage: "final_output"; answer: string; status: string; similarity: number | null },
  options: { development: boolean; directory?: string }): Record<string, unknown> | null {
  if (!options.development) return null;
  try {
    const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
    if (!uuid.test(traceId)) return null;
    const hash = (text: string) => createHash("sha256").update(text).digest("hex");
    let projection: Record<string, unknown>;
    if (event.stage === "provider_usage") {
      const validToken = (value: number | null) => value === null || Number.isSafeInteger(value) && value >= 0;
      if (!["embedding", "generation"].includes(event.service) || !Number.isInteger(event.httpStatus)
        || event.httpStatus < 100 || event.httpStatus > 599 || !validToken(event.inputTokens) || !validToken(event.outputTokens)) return null;
      projection = { stage: event.stage, service: event.service, httpStatus: event.httpStatus, inputTokens: event.inputTokens, outputTokens: event.outputTokens,
        usageVerified: event.inputTokens !== null && event.outputTokens !== null,
        estimatedUsd: event.inputTokens === null || event.outputTokens === null ? null
          : (event.inputTokens * (event.service === "embedding" ? .02 : 2.5) + event.outputTokens * 10) / 1e6 };
    } else if (event.stage === "source_rendering") {
      if (!event.facts.length || event.facts.length > 16) return null;
      const facts = event.facts.map(fact => {
        if (!uuid.test(fact.source.manualId) || !uuid.test(fact.source.chunkId) || !["HOT", "ICE"].includes(fact.temperature)
          || !/^\d+oz$/iu.test(fact.serving) || ![fact.source.sectionStart, fact.source.factStart, fact.source.factEnd].every(value => Number.isSafeInteger(value) && value >= 0)
          || fact.source.factEnd <= fact.source.factStart) throw new Error("PRIVATE_SPAN_INVALID");
        const { basis, ...numeric } = valueProjection(fact);
        return { ...numeric, ...(basis ? { basisTag: hash(basis) } : {}), menuTag: hash(fact.menu), ingredientTag: hash(fact.ingredient), temperature: fact.temperature, serving: fact.serving,
          source: { manualId: fact.source.manualId, chunkId: fact.source.chunkId, sectionStart: fact.source.sectionStart, factStart: fact.source.factStart,
            factEnd: fact.source.factEnd, originalSpanHash: hash(fact.originalText), citationHash: hash(fact.source.citationQuote) } };
      });
      projection = { stage: event.stage, facts, renderedAnswerHash: hash(event.renderedAnswer) };
    } else {
      if (!["answered", "cautious", "insufficient"].includes(event.status) || event.similarity !== null
        && (!Number.isFinite(event.similarity) || event.similarity < 0 || event.similarity > 1)) return null;
      projection = { stage: event.stage, answerHash: hash(event.answer), status: event.status, similarity: event.similarity };
    }
    const directory = options.directory ?? process.cwd();
    execFileSync("git", ["check-ignore", "-q", "--", PRIVATE_RECIPE_EXECUTION_PATH], { cwd: directory, stdio: "ignore" });
    const record = { traceId, observedAt: new Date().toISOString(), ...projection };
    const file = path.join(directory, PRIVATE_RECIPE_EXECUTION_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(record) + "\n", { encoding: "utf8", mode: 0o600 });
    return record;
  } catch {
    return null;
  }
}