import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { applyEvidenceGate, scoreChunk, MIN_SEMANTIC_SIMILARITY, KEYWORD_SUPPORT_CAP } from "@/lib/rag/evidence-gate";
import { extractSearchKeywords, formatSearchEmbeddingInput } from "@/lib/rag/search-query";
import { buildGroundedAnswerMessages } from "@/lib/rag/answer-prompt";
import { resolveRagAnswer } from "@/lib/rag/resolve-rag-answer";
import { buildMenuClarification, candidateMenuNames, selectMenuCandidates } from "@/lib/rag/manual-menu-intent";
import { parseStructuredAnswer, selectProvidedChunkIds } from "@/lib/rag/structured-answer";
import type { ManualChunkMatch } from "@/lib/rag/types";

const THRESHOLDS = { answered: 0.60, cautious: 0.40 };
const NO_MANUAL_ANSWER = "매뉴얼 근거가 없어 매장 관리자 확인이 필요합니다.";
const CAUTION_NOTICE = "\n\n※ 검색 신뢰도가 낮은 답변입니다.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DiagnosticMatch = ManualChunkMatch & {
  store_id?: string | null;
  franchise_id?: string | null;
  scope_type?: string;
  status?: string;
  parent_manual_id?: string | null;
  has_children?: boolean;
};
type DiagnosticCase = { question: string; matches?: DiagnosticMatch[]; generation?: string; source?: "live" | "fixture" };
type DiagnosticTarget = { storeId: string; franchiseId: string };
type DiagnosticInput = { storeId: string; franchiseId?: string; cases: DiagnosticCase[] };

function scopeVerification(match: DiagnosticMatch, target: DiagnosticTarget) {
  if (match.store_id === undefined || match.franchise_id === undefined || match.scope_type === undefined || match.status === undefined) return "not_checked";
  if (match.status !== "approved" || match.franchise_id !== target.franchiseId) return "denied";
  return (match.scope_type === "store" && match.store_id === target.storeId)
    || (match.scope_type === "hq" && match.store_id === null) ? "matched" : "denied";
}

export async function diagnoseRagCase(
  entry: DiagnosticCase,
  target: DiagnosticTarget,
  generate?: (question: string, matches: ManualChunkMatch[]) => Promise<string>,
) {
  const question = entry.question.trim();
  if (!question || question.length > 2000) throw new Error("INVALID_QUESTION");
  const matches = entry.matches ?? [];
  const menuSelection = selectMenuCandidates(question, matches);
  const gate = applyEvidenceGate(menuSelection.matches, THRESHOLDS);
  const clarification = buildMenuClarification(question, gate.usableChunks.map((chunk) => chunk.match));
  let usedIds: string[] = [];
  let generatedAnswerable: boolean | null = null;
  let generationExecuted = false;
  let final = null;
  const metadataComplete = entry.matches !== undefined && matches.every((match) => scopeVerification(match, target) !== "not_checked");
  const scopeDenied = matches.some((match) => scopeVerification(match, target) === "denied");
  if (entry.matches !== undefined && !scopeDenied && (entry.generation !== undefined || generate)) {
    const outcome = await resolveRagAnswer({ question, thresholds: THRESHOLDS, noManualAnswer: NO_MANUAL_ANSWER, cautionNotice: CAUTION_NOTICE }, {
      search: async () => matches,
      generate: async (rawQuestion, provided) => {
        generationExecuted = true;
        const raw = generate ? await generate(rawQuestion, provided) : entry.generation!;
        try {
          const structured = parseStructuredAnswer(raw);
          generatedAnswerable = structured.answerable;
          usedIds = structured.answerable ? selectProvidedChunkIds(structured.usedChunkIds, provided.map((match) => match.chunk_id)) : [];
        } catch { generatedAnswerable = null; usedIds = []; }
        return raw;
      },
    });
    if (outcome.kind === "resolved" && clarification && !generationExecuted && outcome.response.status !== "insufficient") {
      usedIds = clarification.usedChunkIds;
    }
    final = outcome.kind === "resolved" ? {
      status: outcome.response.status,
      evidenceScore: outcome.response.similarity,
      displayPercent: outcome.response.similarity === null ? null : Math.round(outcome.response.similarity * 100),
      selectedChunkIds: usedIds,
      selectedSources: outcome.response.sources,
      generatedAnswerable,
      escalate: outcome.escalate,
    } : { errorCode: outcome.code };
  }
  return {
    mode: entry.matches === undefined ? "query_only" : entry.source === "live" ? generate ? "live_generation" : "live_search_only" : "fixture",
    question,
    embeddingInput: formatSearchEmbeddingInput(question),
    keywords: extractSearchKeywords(question),
    target,
    thresholds: THRESHOLDS,
    semanticFloor: MIN_SEMANTIC_SIMILARITY,
    keywordSupportCap: KEYWORD_SUPPORT_CAP,
    searchStatus: entry.matches === undefined ? null : gate.searchStatus,
    topCandidateEvidenceScore: entry.matches === undefined ? null : gate.topEvidenceScore,
    scopeDenied,
    metadataComplete,
    generationExecuted,
    requestedMenus: menuSelection.requestedMenus,
    requestedPackVariants: menuSelection.requestedPackVariants,
    menuClarificationAvailable: clarification?.answerable === true,
    menuClarificationUsed: final !== null && clarification !== null && !generationExecuted && usedIds.length > 0,
    candidates: matches.map((match, index) => {
      const scored = scoreChunk(match);
      const menuRejected = menuSelection.rejectedChunkIds.includes(match.chunk_id);
      const admitted = scored.evidenceScore >= THRESHOLDS.cautious && !menuRejected;
      return {
        rpcPosition: index + 1,
        manualId: match.manual_id,
        chunkId: match.chunk_id,
        title: match.title,
        category: match.category,
        scope: { storeId: match.store_id ?? null, franchiseId: match.franchise_id ?? null, type: match.scope_type ?? null, status: match.status ?? null },
        scopeVerification: scopeVerification(match, target),
        parentManualId: match.parent_manual_id ?? null,
        hasChildren: match.has_children ?? null,
        structuralWarning: match.has_children ? "parent_card_with_children_returned" : null,
        contentLength: match.content.length,
        itemMenus: candidateMenuNames(match),
        menuRejected,
        rawSimilarity: match.raw_similarity_score,
        rpcKeywordBoost: match.keyword_boost,
        rpcRankScore: match.similarity_score,
        appKeywordSupport: scored.keywordSupport,
        evidenceScore: scored.evidenceScore,
        admittedByGate: admitted,
        gateReason: menuRejected ? "explicit_menu_conflict" : admitted ? "at_or_above_cautious" : match.raw_similarity_score < MIN_SEMANTIC_SIMILARITY ? "semantic_floor_no_keyword_support_and_below_cautious" : "below_cautious",
        selected: usedIds.includes(match.chunk_id),
        selectionReason: scopeDenied ? "scope_rejected_before_generation" : menuRejected ? "explicit_menu_conflict" : final === null ? "generation_not_run" : usedIds.includes(match.chunk_id) ? clarification && !generationExecuted ? "supports_menu_clarification" : "cited_by_generator" : admitted ? "not_cited_or_not_answerable" : "not_provided_to_generator",
      };
    }),
    final,
  };
}

export function redactDiagnostic(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") {
    let safe = value;
    for (const secret of secrets.filter(Boolean)) safe = safe.replaceAll(secret, "[REDACTED]");
    return safe.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
      .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
      .replace(/(?:Cookie|Set-Cookie)\s*:[^\r\n]+/gi, "Cookie: [REDACTED]");
  }
  if (Array.isArray(value)) return value.map((item) => redactDiagnostic(item, secrets));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDiagnostic(item, secrets)]));
  return value;
}

async function generateLive(question: string, matches: ManualChunkMatch[]): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", temperature: 0.2, max_tokens: 500, response_format: { type: "json_object" }, messages: buildGroundedAnswerMessages(question, matches) }),
  });
  if (!response.ok) throw new Error("GENERATION_REQUEST_FAILED");
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  if (!body.choices?.[0]?.message?.content) throw new Error("GENERATION_RESPONSE_INVALID");
  return body.choices[0].message.content;
}

export async function runDiagnostic(argv: readonly string[]) {
  if (typeof window !== "undefined" || process.env.NODE_ENV === "production") throw new Error("DEVELOPMENT_ONLY");
  const live = argv.includes("--live");
  const generate = argv.includes("--generate");
  const inputIndex = argv.indexOf("--input");
  if (inputIndex < 0 || !argv[inputIndex + 1] || (generate && !live)) throw new Error("INVALID_ARGUMENTS");
  const allowed = new Set(["--input", "--live", "--generate", argv[inputIndex + 1]]);
  if (argv.some((arg) => !allowed.has(arg))) throw new Error("INVALID_ARGUMENTS");
  if (live && process.env.NODE_ENV !== "development") throw new Error("LIVE_REQUIRES_DEVELOPMENT");
  const input = JSON.parse(readFileSync(argv[inputIndex + 1], "utf8")) as DiagnosticInput;
  if (!input.storeId || !Array.isArray(input.cases) || input.cases.length < 1 || input.cases.length > 20
    || input.cases.some((entry) => typeof entry.question !== "string" || !entry.question.trim() || entry.question.length > 2000)) throw new Error("INVALID_INPUT");
  let target = { storeId: input.storeId, franchiseId: input.franchiseId ?? "not_checked" };
  const reports = [];
  if (live) {
    if (!UUID_PATTERN.test(input.storeId)) throw new Error("INVALID_STORE_ID");
    dotenv.config({ path: fileURLToPath(new URL("../.env.local", import.meta.url)), quiet: true });
    if (!process.env.OPENAI_API_KEY) throw new Error("MISSING_EMBEDDING_CREDENTIAL");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { searchManualChunks } = await import("@/lib/rag/search-manual-chunks");
    const client = createAdminClient();
    const mapping = await client.from("stores").select("franchise_id").eq("id", input.storeId).maybeSingle();
    if (mapping.error || !mapping.data?.franchise_id || !UUID_PATTERN.test(mapping.data.franchise_id)) throw new Error("STORE_SCOPE_UNRESOLVED");
    target = { storeId: input.storeId, franchiseId: mapping.data.franchise_id };
    for (const entry of input.cases) {
      const matches = await searchManualChunks(entry.question, target.storeId, target.franchiseId);
      const ids = [...new Set(matches.map((match) => match.manual_id))];
      let metadata: { id: string; store_id: string | null; franchise_id: string | null; scope_type: string; status: string; parent_manual_id: string | null }[] = [];
      let parents = new Set<string>();
      if (ids.length) {
        const rows = await client.from("manuals").select("id,store_id,franchise_id,scope_type,status,parent_manual_id").in("id", ids);
        const children = await client.from("manuals").select("parent_manual_id").in("parent_manual_id", ids);
        if (rows.error || children.error || rows.data?.length !== ids.length) throw new Error("METADATA_LOOKUP_FAILED");
        metadata = rows.data;
        parents = new Set((children.data ?? []).map((row) => row.parent_manual_id as string));
      }
      const detailed = matches.map((match) => ({ ...match, ...metadata.find((row) => row.id === match.manual_id), has_children: parents.has(match.manual_id) }));
      reports.push(await diagnoseRagCase({ question: entry.question, matches: detailed, source: "live" }, target, generate ? generateLive : undefined));
    }
  } else {
    for (const entry of input.cases) reports.push(await diagnoseRagCase({ ...entry, source: "fixture" }, target));
  }
  const secrets = Object.entries(process.env).filter(([name]) => /key|token|secret|cookie|password/i.test(name)).map(([, value]) => value).filter((value): value is string => Boolean(value));
  return redactDiagnostic(reports, secrets);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDiagnostic(process.argv.slice(2)).then((reports) => console.log(JSON.stringify(reports, null, 2))).catch(() => {
    console.error("RAG_DIAGNOSTIC_FAILED: check local arguments, development mode, credentials and service availability; no raw error details printed.");
    process.exitCode = 1;
  });
}