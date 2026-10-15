/**
 * 검색 → 근거 판정 → 생성 → 근거 검증 → 최종 status를 한 곳에서 결정한다.
 *
 * 라우트가 아니라 여기에 두는 이유는 실제 Supabase/OpenAI 없이 가짜 의존성으로
 * 전 구간을 실행 검증하기 위해서다. 시스템 오류(system_error)는 근거 부족과 분리해
 * 돌려주므로, 호출부가 이를 insufficient로 위장해 점주에게 알리지 않는다.
 */
import { applyEvidenceGate, scoreChunk, type EvidenceGateThresholds } from "@/lib/rag/evidence-gate";
import { getProviderFailure, type ProviderSystemErrorCode } from "@/lib/rag/provider-error";
import { buildLocationReferenceAnswer } from "@/lib/rag/location-reference";
import { buildClosingOrderProcedureAnswer } from "@/lib/rag/closing-order-procedure";
import { buildRecipeOptionQuantityAnswer } from "@/lib/rag/recipe-option-quantity";
import { buildManualReferenceAnswer } from "@/lib/rag/manual-reference-answer";
import { findVerifiedQuote } from "@/lib/rag/verified-quote";
import { isClearlyOutOfScopeQuestion } from "@/lib/rag/search-query";
import { boundedQuestionContext, buildInterpretedSearchQuestion, getLatteAmountFollowUpContext, isLatteAmountContextualFollowUp, isRecipeSelectionReply, restoreRecipeSelectionQuestion, parseQuestionInterpretation, shouldInterpretQuestion, type QuestionContext, type QuestionInterpretation } from "@/lib/rag/question-interpretation";
import { buildMenuClarification, canUseFamilyPackHistory, isFamilyPackFollowUp, selectMenuCandidates } from "@/lib/rag/manual-menu-intent";
import {
  StructuredAnswerParseError,
  parseStructuredAnswer,
  selectProvidedChunkIds,
  hasExplicitSupportIntent,
  requestedSupportKinds,
  recognizedStateConditions,
  hasExplicitConditionQuestion,
  isLinkedStateUseProhibition,
  isClosingOrderDecisionQuestion,
  normalizeTargetText,
  questionContainsTargetSequence,
  needsExplicitTarget,
  sameDeclaredSourceTarget,
  sourceContainsDeclaredTarget,
  type SupportKind,
} from "@/lib/rag/structured-answer";
import { verifyRecipeFacts, extractVerifiedRecipeSourceFacts, verifyRecipeModelForSourceRendering, renderVerifiedRecipeSourceFacts, type RecipeFactDiagnostic, type VerifiedRecipeSourceFact } from "@/lib/rag/recipe-fact-verification";
import type {
  ManualChunkMatch,
  RagQuerySuccessResponse,
  RagSearchMatch,
  RagSource,
  RagStatus,
} from "@/lib/rag/types";

export type RagPrivateDecisionReview = {
  validation: "parsed" | "accepted" | "rejected";
  failure?: { fieldPath: string; validationKind: string };
  answerable: boolean;
  modelCoverage: string | null;
  expectedRequirementKinds: SupportKind[];
  conditionConstraints: string[];
  explicitConditionQuestion: boolean;
  requestedTarget?: string;
  directKinds: SupportKind[];
  stateConditionCovered: boolean;
  requirements: { kind: SupportKind; support: string; evidence: {
    chunkId: string; manualId?: string; scopeKind?: string; role?: string; relation?: string; target?: string; quote: string; quoteLength: number;
    provided: boolean; selected: boolean; quotePresent: boolean; sourceTargetPresent: boolean; sameRelationValid: boolean;
    policyLinked: boolean; contextExcerpts: string[];
  }[] }[];
};

export type RagAnswerDeps = {
  onPrivateRecipeFactDiagnostic?: (diagnostic: RecipeFactDiagnostic) => void;
  onPrivateRecipeSourceFacts?: (facts: readonly VerifiedRecipeSourceFact[], renderedAnswer: string) => void;
  search: (question: string) => Promise<ManualChunkMatch[]>;
  interpret?: (question: string, messages: readonly { role: "user" | "assistant"; content: string }[]) => Promise<QuestionInterpretation>;
  onDiagnostic?: (event: { stage: string; [key: string]: unknown }) => void;
  onPrivateDecisionReview?: (review: RagPrivateDecisionReview) => void;
  onPrivateEvidenceReview?: (review: { requestedTarget: string | undefined; coverage: string | undefined;
    evidence: { target: string | undefined; targetRelation: string | undefined; role: string | undefined; quote: string; provided: boolean; quotePresent: boolean }[] }) => void;
  onPrivateTargetRelationFailure?: (diagnostic: { requestedTarget: string; evidenceTarget: string; targetRelation: string; fieldPath: string; validationRule: "sameDeclaredSourceTarget:v3" }) => void;
  /** 구조화 JSON 문자열을 그대로 돌려준다. 파싱·검증은 이 모듈이 한다. */
  generate: (question: string, chunks: ManualChunkMatch[], familyPackVariant?: string, interpretation?: QuestionInterpretation) => Promise<string>;
};

export type RagAnswerInput = {
  question: string;
  interpretationMode?: "selective" | "general";
  interpretationContext?: { userId: string; storeId: string; conversation?: QuestionContext };
  familyPackVariant?: string;
  thresholds: EvidenceGateThresholds;
  noManualAnswer: string;
  cautionNotice: string;
  requireCoverage?: boolean;
  requireSupportAssessment?: boolean;
  requireEvidenceScope?: boolean;
};

export type RagSystemErrorCode = "SEARCH_FAILED" | "GENERATION_FAILED" | "GENERATION_UNPARSABLE" | ProviderSystemErrorCode;

const SUPPORT_LABELS = { procedure: "구체적인 작업 절차", method: "구체적인 수행 방법", timing: "적용 시점", permission: "허용 여부", facts: "요청한 구체 기준",
  location: "보관 또는 배치 위치", conditions: "요청한 조건", duration: "요청한 기간", referral: "문의 대상" };

export type RagAnswerOutcome =
  | {
      kind: "resolved";
      response: RagQuerySuccessResponse & { status: RagStatus };
      /** 최종 insufficient일 때만 true. 기존 점주 에스컬레이션 가드를 그대로 탄다. */
      escalate: boolean;
    }
  | { kind: "system_error"; code: RagSystemErrorCode; failureLayer?: string; fieldPath?: string; validationKind?: string; providerRequestId?: string };

function toRagSource(match: ManualChunkMatch): RagSource {
  return { manualId: match.manual_id, title: match.title, category: match.category };
}

function toRagSearchMatch(match: ManualChunkMatch): RagSearchMatch {
  return {
    title: match.title,
    category: match.category,
    similarity: match.similarity_score,
    rawSimilarity: match.raw_similarity_score,
    keywordBoost: match.keyword_boost,
  };
}

export async function resolveRagAnswer(
  input: RagAnswerInput,
  deps: RagAnswerDeps,
): Promise<RagAnswerOutcome> {
  let searchResults: ManualChunkMatch[];
  const trace = (event: { stage: string; [key: string]: unknown }) => { try { deps.onDiagnostic?.(event); } catch {} };
  if (isClearlyOutOfScopeQuestion(input.question)) {
    trace({ stage: "final", status: "insufficient", reason: "OUT_OF_SCOPE_QUESTION" });
    return { kind: "resolved", escalate: false, response: {
      responseKind: "out_of_scope",
      answer: "매장 업무 매뉴얼을 바탕으로 답변하고 있어요. 매장 업무와 관련된 내용을 질문해 주세요.",
      similarity: null, source: null, sources: [], status: "insufficient", matches: [],
    } };
  }
  const recentContext = input.interpretationContext
    ? boundedQuestionContext(input.interpretationContext.conversation, input.interpretationContext.userId, input.interpretationContext.storeId, input.question) : [];
  if (isRecipeSelectionReply(input.question)) {
    const restored = restoreRecipeSelectionQuestion(input.question, recentContext);
    if (restored) return resolveRagAnswer({ ...input, question: restored, interpretationContext: undefined }, deps);
    return { kind: "resolved", escalate: false, response: {
      responseKind: "clarification", answer: "어떤 메뉴의 레시피를 말씀하시나요? 메뉴명과 온도를 함께 알려주세요.",
      similarity: null, source: null, sources: [], status: "insufficient", matches: [],
    } };
  }
  const recipeAmountFollowUp = deps.interpret ? getLatteAmountFollowUpContext(input.question, recentContext) : null;
  const hasRecipeAmountContext = Boolean(recipeAmountFollowUp);
  if (shouldInterpretQuestion(input.question) && !hasExplicitSupportIntent(input.question) && !hasRecipeAmountContext) {
    trace({ stage: "final", status: "insufficient", reason: "FOLLOW_UP_INTENT_AMBIGUOUS" });
    return { kind: "resolved", escalate: false, response: {
      responseKind: "clarification",
      answer: /개봉한/u.test(input.question)
        ? "개봉한 것의 위치를 묻는 건가요, 아니면 개봉 후 관리 방법을 묻는 건가요?"
        : "위치, 방법, 기간 중 어떤 점을 확인하고 싶은지 조금 더 구체적으로 알려주세요.",
      similarity: null, source: null, sources: [], status: "insufficient", matches: [],
    } };
  }
  let interpretation: QuestionInterpretation | undefined;
  let contextualRecipeAmountFollowUp = false;
  const generalInterpretation = input.interpretationMode === "general";
  const deferredInterpretation = generalInterpretation && (requestedSupportKinds(input.question).length === 1
    && requestedSupportKinds(input.question)[0] === "location" || Boolean(buildMenuClarification(input.question, [])))
    && !shouldInterpretQuestion(input.question);
  const interpretQuestion = async () => {
    const context = input.interpretationContext;
    const messages = context ? boundedQuestionContext(context.conversation, context.userId, context.storeId, input.question) : [];
    const result = await deps.interpret!(input.question, messages);
    interpretation = parseQuestionInterpretation(JSON.stringify(result), input.question, messages);
    contextualRecipeAmountFollowUp = isLatteAmountContextualFollowUp(input.question, messages, interpretation.contextTarget);
    if (contextualRecipeAmountFollowUp && recipeAmountFollowUp) interpretation.verifiedRecipeItem = recipeAmountFollowUp.item;
    trace({ stage: "interpretation_validation", service: "interpretation", validation: "accepted",
      expectedRequirementKinds: interpretation.requirements, conditionCount: interpretation.constraints.length,
      contextTargetPresent: Boolean(interpretation.contextTarget) });
  };
  if (deps.interpret && (shouldInterpretQuestion(input.question) || generalInterpretation && !deferredInterpretation)
    && !(generalInterpretation && needsExplicitTarget(input.question)
      && !input.interpretationContext?.conversation)) {
    try { await interpretQuestion(); } catch (error) {
      const provider = getProviderFailure(error);
      if (provider) {
        trace({ stage: "final", status: "system_error", reason: provider.code, failureLayer: "provider", providerRequestId: provider.providerRequestId });
        return { kind: "system_error", ...provider, failureLayer: "provider" };
      }
      const failure = error instanceof StructuredAnswerParseError ? error : new StructuredAnswerParseError("interpretation.$", "service_transport_error");
      trace({ stage: "interpretation_validation", service: "interpretation", validation: "rejected", failureLayer: "question_interpretation",
        fieldPath: failure.fieldPath, validationKind: failure.validationKind });
      trace({ stage: "final", status: "system_error", reason: "GENERATION_UNPARSABLE", failureLayer: "question_interpretation" });
      return { kind: "system_error", code: "GENERATION_UNPARSABLE" };
    }
    if (interpretation?.clarification) return { kind: "resolved", escalate: false, response: {
      responseKind: "clarification",
      answer: "어떤 대상과 작업을 말씀하시나요? 품목이나 장비 이름을 알려주세요.", similarity: null,
      source: null, sources: [], status: "insufficient", matches: [],
    } };
  }
  const familyPackVariant = canUseFamilyPackHistory(input.question) && /^[A-Z0-9]+$/.test(input.familyPackVariant ?? "") ? input.familyPackVariant : undefined;
  let contextualQuestion = interpretation ? buildInterpretedSearchQuestion(input.question, interpretation) : input.question;
  if (contextualRecipeAmountFollowUp && recipeAmountFollowUp) {
    contextualQuestion += `\n현재 이어서 묻는 항목: ${recipeAmountFollowUp.item} 정량`;
  }
  const recipeQuestion = contextualRecipeAmountFollowUp ? contextualQuestion : input.question;
  const selectionQuestion = familyPackVariant ? `${contextualQuestion} ${familyPackVariant} 패밀리팩` : contextualQuestion;
  if (interpretation) trace({ stage: "condition_delivery", mode: "search", conditionCount: interpretation.constraints.length,
    contextTargetPresent: Boolean(interpretation.contextTarget), conditionsIncluded: interpretation.constraints.every(value => contextualQuestion.includes(value)),
    expectedRequirementKinds: interpretation.requirements });
  trace({ stage: "family_pack_context", applied: Boolean(familyPackVariant) });
  if (needsExplicitTarget(input.question) && !interpretation?.contextTarget) {
    trace({ stage: "final", status: "insufficient", reason: "QUESTION_TARGET_UNRESOLVED" });
    return { kind: "resolved", escalate: false, response: {
      responseKind: "clarification",
      answer: "사용하려는 대상이 무엇인가요? 품목이나 장비 이름을 알려주세요.", similarity: null,
      source: null, sources: [], status: "insufficient", matches: [],
    } };
  }
  if (isFamilyPackFollowUp(input.question) && !familyPackVariant) {
    trace({ stage: "final", status: "insufficient", reason: "FOLLOW_UP_TARGET_UNRESOLVED" });
    return { kind: "resolved", escalate: false, response: {
      responseKind: "clarification",
      answer: "어떤 메뉴나 항목을 말씀하시나요? 대상을 알려주세요.", similarity: null,
      source: null, sources: [], status: "insufficient", matches: [],
    } };
  }

  try {
    searchResults = await deps.search(selectionQuestion);
    const seenIds = new Set<string>();
    const seenBodies = new Set<string>();
    searchResults = searchResults.filter(match => {
      const body = `${match.manual_id}:${match.content}`;
      if (seenIds.has(match.chunk_id) || seenBodies.has(body)) return false;
      seenIds.add(match.chunk_id); seenBodies.add(body); return true;
    });
    const exactClosingOrderIds = isClosingOrderDecisionQuestion(input.question)
      ? new Set(buildClosingOrderProcedureAnswer(input.question, searchResults)?.usedChunkIds ?? []) : new Set<string>();
    const exactReferenceIds = new Set([
      ...buildLocationReferenceAnswer(input.question, searchResults)?.usedChunkIds ?? [],
      ...buildManualReferenceAnswer(input.question, searchResults)?.usedChunkIds ?? [],
    ]);
    searchResults = searchResults.sort((first, second) => {
      const firstExactProcedure = exactClosingOrderIds.has(first.chunk_id) || exactReferenceIds.has(first.chunk_id);
      const secondExactProcedure = exactClosingOrderIds.has(second.chunk_id) || exactReferenceIds.has(second.chunk_id);
      if (firstExactProcedure !== secondExactProcedure) return firstExactProcedure ? -1 : 1;
      const difference = scoreChunk(second).evidenceScore - scoreChunk(first).evidenceScore;
      return Math.abs(difference) > 1e-6 ? difference : second.raw_similarity_score - first.raw_similarity_score;
    }).slice(0, 5);
  } catch (error) {
    const provider = getProviderFailure(error);
    if (provider) {
      trace({ stage: "final", status: "system_error", reason: provider.code, failureLayer: "provider", providerRequestId: provider.providerRequestId });
      return { kind: "system_error", ...provider, failureLayer: "provider" };
    }
    if (error instanceof Error && error.name === "ManualSearchNotReadyError") {
      trace({ stage: "final", status: "insufficient", reason: "MANUAL_SEARCH_NOT_READY" });
      return { kind: "resolved", escalate: false, response: {
        responseKind: "clarification", answer: "등록된 매뉴얼의 검색 준비가 아직 완료되지 않았습니다. 검색 준비 완료 후 다시 질문해 주세요.",
        similarity: null, source: null, sources: [], status: "insufficient", matches: [],
      } };
    }
    trace({ stage: "search", reason: "SEARCH_FAILED" });
    trace({ stage: "final", status: "system_error", reason: "SEARCH_FAILED" });
    return { kind: "system_error", code: "SEARCH_FAILED" };
  }
  trace({ stage: "search", candidateCount: searchResults.length, candidates: searchResults.map((match, index) => ({
    manualId: match.manual_id, chunkId: match.chunk_id, rpcScore: match.similarity_score,
    rank: index + 1, scopeKind: match.diagnostic_scope ?? "unknown",
    rawSimilarity: match.raw_similarity_score, keywordBoost: match.keyword_boost,
    keywordSupport: scoreChunk(match).keywordSupport, evidenceScore: scoreChunk(match).evidenceScore,
  })) });

  const matches = searchResults.map(toRagSearchMatch);
  const candidateSelection = selectMenuCandidates(selectionQuestion, searchResults);
  const gate = applyEvidenceGate(candidateSelection.matches, input.thresholds);
  trace({ stage: "menu_filter", beforeCount: searchResults.length, afterCount: candidateSelection.matches.length,
    requestedMenuCount: candidateSelection.requestedMenus.length, requestedPackVariantCount: candidateSelection.requestedPackVariants.length,
    excludedChunkIds: candidateSelection.rejectedChunkIds,
    reason: candidateSelection.rejectedChunkIds.length ? "explicit_menu_conflict" : "no_menu_exclusions" });
  trace({ stage: "evidence_gate", providedCount: gate.usableChunks.length, status: gate.searchStatus, topEvidenceScore: gate.topEvidenceScore,
    providedChunkIds: gate.usableChunks.map((chunk) => chunk.match.chunk_id), answeredThreshold: input.thresholds.answered, cautiousThreshold: input.thresholds.cautious });

  let sourceReferencePolicy = false;
  const insufficient = (similarity: number | null): RagAnswerOutcome => ({
    kind: "resolved",
    escalate: true,
    response: {
      answer: input.noManualAnswer,
      similarity,
      source: null,
      sources: [],
      status: "insufficient",
      matches,
    },
  });
  const addShortageScope = (outcome: RagAnswerOutcome): RagAnswerOutcome => {
    if (outcome.kind !== "resolved" || outcome.response.status !== "insufficient" || outcome.response.responseKind === "clarification") return outcome;
    if (sourceReferencePolicy && outcome.response.source) return outcome;
    const target = interpretation?.contextTarget || interpretation?.target;
    const context = target ? `확인할 대상: ${target}. ` : "";
    const conditions = interpretation?.constraints.length ? `현재 질문 조건: ${interpretation.constraints.join(" / ")}. ` : "";
    const requirements = interpretation?.requirements ?? requestedSupportKinds(input.question);
    const shortage = !outcome.response.source ? "현재 제공된 근거에서 이 질문의 요청 범위에 맞는 답을 확인하지 못했습니다.\n" : "";
    outcome.response.answer = `확인할 질문: ${normalizeTargetText(input.question)}\n${context}${conditions}요청 범위: ${requirements.map(kind => SUPPORT_LABELS[kind]).join(" / ")}.\n${shortage}\n${outcome.response.answer}`;
    return outcome;
  };

  if (gate.searchStatus === "insufficient") {
    trace({ stage: "final", status: "insufficient", reason: searchResults.length === 0 ? "NO_SEARCH_CANDIDATES"
      : candidateSelection.matches.length === 0 ? "ALL_MENU_CANDIDATES_EXCLUDED" : "BELOW_EVIDENCE_THRESHOLD" });
    return addShortageScope(insufficient(gate.topEvidenceScore));
  }

  const providedChunks = gate.usableChunks.map((chunk) => chunk.match);
  let rawGeneration: string;
  let deterministic = false;
  let deterministicSourceAnswer = false;
  let locationConflictAnswer: string | undefined;

  try {
    const clarification = buildMenuClarification(selectionQuestion, providedChunks);
    const locationAnswer = requestedSupportKinds(input.question).length === 1 && requestedSupportKinds(input.question)[0] === "location"
      ? buildLocationReferenceAnswer(input.question, providedChunks) : null;
    const closingOrderAnswer = buildClosingOrderProcedureAnswer(input.question, providedChunks);
    const optionQuantityAnswer = buildRecipeOptionQuantityAnswer(input.question, providedChunks);
    const manualReferenceAnswer = !clarification && !locationAnswer && !closingOrderAnswer && !optionQuantityAnswer
      ? buildManualReferenceAnswer(input.question, providedChunks) : null;
    sourceReferencePolicy = manualReferenceAnswer?.coverage === "policy_only";
    if (!clarification && !locationAnswer && !closingOrderAnswer && !optionQuantityAnswer && !manualReferenceAnswer && deps.interpret && deferredInterpretation) {
      await interpretQuestion();
      if (interpretation?.clarification) return { kind: "resolved", escalate: false, response: {
        responseKind: "clarification",
        answer: "어떤 대상과 작업을 말씀하시나요? 품목이나 장비 이름을 알려주세요.", similarity: null,
        source: null, sources: [], status: "insufficient", matches,
      } };
      if (interpretation) contextualQuestion = buildInterpretedSearchQuestion(input.question, interpretation);
    }
    locationConflictAnswer = locationAnswer?.answerable === false ? locationAnswer.answer : undefined;
    deterministicSourceAnswer = Boolean(!clarification && (locationAnswer?.answerable || closingOrderAnswer));
    deterministic = Boolean(clarification || locationAnswer || closingOrderAnswer || optionQuantityAnswer || manualReferenceAnswer);
    if (!clarification && !locationAnswer && !closingOrderAnswer && !optionQuantityAnswer && !manualReferenceAnswer) trace({ stage: "prompt_delivery", candidates: searchResults.map((match, index) => ({
      manualId: match.manual_id, chunkId: match.chunk_id, rank: index + 1, scopeKind: match.diagnostic_scope ?? "unknown",
      rpcScore: match.similarity_score, evidenceScore: scoreChunk(match).evidenceScore,
      promptIncluded: providedChunks.some(provided => provided.chunk_id === match.chunk_id),
    })) });
    if (interpretation && !clarification && !locationAnswer && !closingOrderAnswer && !optionQuantityAnswer && !manualReferenceAnswer) trace({ stage: "condition_delivery", mode: "answer",
      conditionCount: interpretation.constraints.length, contextTargetPresent: Boolean(interpretation.contextTarget),
      conditionsIncluded: interpretation.constraints.every(value => contextualQuestion.includes(value)), expectedRequirementKinds: interpretation.requirements });
    trace({ stage: "generation", mode: clarification ? clarification.answerable ? "menu_clarification" : "unresolved_menu_abstention"
      : locationAnswer ? "location_reference" : closingOrderAnswer ? "closing_order_procedure" : optionQuantityAnswer ? "recipe_option_quantity" : manualReferenceAnswer ? "manual_reference" : "model" });
    rawGeneration = clarification ? JSON.stringify({ ...clarification, coverage: "clarification" }) : locationAnswer
      ? JSON.stringify(locationAnswer) : closingOrderAnswer
        ? JSON.stringify(closingOrderAnswer) : optionQuantityAnswer
          ? JSON.stringify(optionQuantityAnswer) : manualReferenceAnswer
            ? JSON.stringify(manualReferenceAnswer) : await deps.generate(contextualQuestion, providedChunks, familyPackVariant, interpretation);
  } catch (error) {
    if (error instanceof StructuredAnswerParseError) {
      const interpretationFailure = error.fieldPath.startsWith("interpretation.");
      trace({ stage: interpretationFailure ? "interpretation_validation" : "structured_validation", validation: "rejected",
        fieldPath: error.fieldPath, validationKind: error.validationKind,
        failureLayer: interpretationFailure ? "question_interpretation" : "model_completion" });
      trace({ stage: "final", status: "system_error", reason: "GENERATION_UNPARSABLE" });
      return { kind: "system_error", code: "GENERATION_UNPARSABLE" };
    }
    const provider = getProviderFailure(error);
    if (provider) {
      trace({ stage: "final", status: "system_error", reason: provider.code, failureLayer: "provider", providerRequestId: provider.providerRequestId });
      return { kind: "system_error", ...provider, failureLayer: "provider" };
    }
    trace({ stage: "final", status: "system_error", reason: "GENERATION_FAILED" });
    return { kind: "system_error", code: "GENERATION_FAILED" };
  }

  let structured;
  try {
    structured = parseStructuredAnswer(rawGeneration, input.requireCoverage, input.requireSupportAssessment && !deterministic,
      input.requireEvidenceScope && !deterministic);
    trace({ stage: "structured_validation", validation: "accepted", coverage: structured.coverage ?? null, answerable: structured.answerable });
  } catch (error) {
    if (error instanceof StructuredAnswerParseError) {
      trace({ stage: "structured_validation", validation: "rejected", coverage: null, reason: "STRUCTURE_OR_COVERAGE_INVALID",
        fieldPath: error.fieldPath, validationKind: error.validationKind,
        ...(error.fieldPath === "coverage" ? { allowedCoverageValues: ["direct", "partial", "policy_only", "clarification"] } : {}),
        failureLayer: error.validationKind === "invalid_json" ? "json_parse" : "response_schema" });
      trace({ stage: "final", status: "system_error", reason: "GENERATION_UNPARSABLE" });
      return { kind: "system_error", code: "GENERATION_UNPARSABLE" };
    }
    trace({ stage: "final", status: "system_error", reason: "GENERATION_FAILED" });
    return { kind: "system_error", code: "GENERATION_FAILED" };
  }

  const evidenceScore = gate.usableChunks[0].evidenceScore;

  const reviewDecision = (validation: RagPrivateDecisionReview["validation"], failure?: RagPrivateDecisionReview["failure"],
    directKinds: SupportKind[] = [], stateConditionCovered = false) => {
    const target = structured.supportAssessment?.requestedTarget;
    try { deps.onPrivateDecisionReview?.({ validation, failure, answerable: structured.answerable, modelCoverage: structured.coverage ?? null,
      expectedRequirementKinds: interpretation?.requirements ?? requestedSupportKinds(input.question), requestedTarget: target,
      conditionConstraints: (interpretation?.constraints ?? []).slice(0, 10).map(value => value.slice(0, 200)),
      explicitConditionQuestion: hasExplicitConditionQuestion(input.question),
      directKinds, stateConditionCovered,
      requirements: (structured.supportAssessment?.requirements ?? []).map(item => ({ kind: item.kind, support: item.support,
        evidence: item.evidence.map(entry => {
          const match = providedChunks.find(chunk => chunk.chunk_id === entry.chunkId);
          return { chunkId: entry.chunkId, manualId: match?.manual_id, scopeKind: match?.diagnostic_scope ?? "unknown",
            role: entry.role, relation: entry.targetRelation, target: entry.target,
            quote: entry.quote.slice(0, 600), quoteLength: entry.quote.length, provided: Boolean(match), selected: structured.usedChunkIds.includes(entry.chunkId),
            quotePresent: Boolean(match && findVerifiedQuote(match.content, entry.quote) !== undefined),
            sourceTargetPresent: Boolean(match && entry.target && (normalizeTargetText(match.content).includes(normalizeTargetText(entry.target))
              || normalizeTargetText(match.title).includes(normalizeTargetText(entry.target)))),
            sameRelationValid: entry.targetRelation !== "same" || Boolean(target && entry.target && sameDeclaredSourceTarget(target, entry.target, entry.quote)),
            policyLinked: Boolean(match && target && entry.target && isLinkedStateUseProhibition(input.question, target, entry.target, entry.quote, match.content)),
            contextExcerpts: match ? match.content.split(/\r?\n/u).filter(line => /예외|제외|경우|다만|확실하지|사용.*(?:가능|허용)/u.test(line)).slice(0, 3).map(line => line.slice(0, 180)) : [],
          };
        }) })),
    }); } catch {}
  };
  reviewDecision("parsed");

  if (!structured.answerable) {
    trace({ stage: "citation_validation", validation: "skipped", reason: "MODEL_NOT_ANSWERABLE", usedChunkIds: [] });
    trace({ stage: "final", status: "insufficient", reason: buildMenuClarification(selectionQuestion, providedChunks) ? "NO_RELEVANT_MENU_EVIDENCE" : "MODEL_NOT_ANSWERABLE" });
    const outcome = insufficient(evidenceScore);
    if (locationConflictAnswer && outcome.kind === "resolved") outcome.response.answer = locationConflictAnswer;
    return addShortageScope(outcome);
  }

  const validChunkIds = selectProvidedChunkIds(
    structured.usedChunkIds,
    providedChunks.map((chunk) => chunk.chunk_id),
  );
  trace({ stage: "citation_validation", validation: validChunkIds.length ? "accepted" : "rejected", usedChunkIds: validChunkIds,
    rejectedCitationCount: new Set(structured.usedChunkIds.filter((id) => !validChunkIds.includes(id))).size });

  // 모델이 답할 수 있다고 해도, 실제로 제공한 근거를 지목하지 못하면 확정 답변으로 쓰지 않는다.
  if (validChunkIds.length === 0) {
    trace({ stage: "final", status: "insufficient", reason: "NO_VALID_CITED_CHUNKS" });
    return addShortageScope(insufficient(evidenceScore));
  }

  const usedEvidence = gate.usableChunks.filter((chunk) => validChunkIds.includes(chunk.match.chunk_id));
  const usedChunks = usedEvidence.map((chunk) => chunk.match);
  const usedEvidenceScore = Math.min(...usedEvidence.map((chunk) => chunk.evidenceScore));
  const sources = usedChunks.map(toRagSource);
  let supportCoverage: "direct" | "partial" | "policy_only" | undefined;
  let scopeNotice = "";
  let supportedAnswer = structured.answer;
  let stateConditionCovered = false;
  if (structured.supportAssessment && (!deterministic || deterministicSourceAnswer)) {
    const requirements = structured.supportAssessment.requirements;
    const requested = interpretation?.requirements ?? requestedSupportKinds(input.question);
    const target = structured.supportAssessment.requestedTarget;
    try {
      deps.onPrivateEvidenceReview?.({ requestedTarget: target, coverage: structured.coverage,
        evidence: requirements.flatMap(item => item.evidence.map(entry => {
          const match = usedChunks.find(chunk => chunk.chunk_id === entry.chunkId);
          return { target: entry.target, targetRelation: entry.targetRelation, role: entry.role, quote: entry.quote,
            provided: Boolean(match), quotePresent: Boolean(match && findVerifiedQuote(match.content, entry.quote) !== undefined) };
        })) });
    } catch {}
    let failure: { fieldPath: string; validationKind: string; requestedTarget?: string; evidenceTarget?: string; targetRelation?: string } | undefined;
    if (!requested.every((kind) => requirements.filter((item) => item.kind === kind).length === 1) || requirements.length !== requested.length) {
      failure = { fieldPath: "supportAssessment.requirements", validationKind: "requirement_mismatch" };
    } else if (input.requireEvidenceScope && !(target && questionContainsTargetSequence(contextualQuestion, target))) {
      failure = { fieldPath: "supportAssessment.requestedTarget", validationKind: "question_target_mismatch" };
    }
    requirements.forEach((item, requirementIndex) => item.evidence.forEach((entry, evidenceIndex) => {
      if (failure) return;
      const field = `supportAssessment.requirements[${requirementIndex}].evidence[${evidenceIndex}]`;
      const match = usedChunks.find((chunk) => chunk.chunk_id === entry.chunkId);
      const verifiedQuote = match ? findVerifiedQuote(match.content, entry.quote) : undefined;
      if (!match) failure = { fieldPath: `${field}.chunkId`, validationKind: "unprovided_evidence" };
      else if (verifiedQuote === undefined) failure = { fieldPath: `${field}.quote`, validationKind: "quote_mismatch" };
      else if (entry.target && !sourceContainsDeclaredTarget(match.content, entry.target)
        && !sourceContainsDeclaredTarget(match.title, entry.target)) failure = { fieldPath: `${field}.target`, validationKind: "source_target_mismatch" };
      else if (entry.targetRelation === "same" && !(target && sameDeclaredSourceTarget(target, entry.target!, entry.quote))) failure = {
        fieldPath: `${field}.targetRelation`, validationKind: "target_relation_mismatch", requestedTarget: target!, evidenceTarget: entry.target!, targetRelation: entry.targetRelation,
      };
      else if (item.kind === "location" && entry.role === "location") {
        const citedLocation = verifiedQuote.split(/\r?\n/u).map(line => line.match(/^\s*[-*]?\s*([^:：\n]{1,200})[:：]\s*(\S.*)$/u))
          .find(row => row && normalizeTargetText(row[1]) === normalizeTargetText(entry.target!))?.[2]?.trim();
        if (citedLocation && !normalizeTargetText(structured.answer).includes(normalizeTargetText(citedLocation))) {
          failure = { fieldPath: "answer", validationKind: "location_not_grounded" };
        }
      }
      if (!failure && verifiedQuote !== undefined) entry.quote = verifiedQuote;
    }));
    if (!failure && isClosingOrderDecisionQuestion(input.question)
      && /(?:무조건\s*)?(?:받아도|받으세요|받으면\s*(?:돼|됩니다)|접수해도\s*(?:돼|됩니다)|수락(?:해야|하면)\s*(?:돼|됩니다))/u.test(structured.answer)) {
      const explicitDecisionEvidence = requirements.flatMap(item => item.evidence)
        .some(entry => entry.role === "permission" && /(?:주문|접수).{0,30}(?:가능|불가|금지|받(?:아도\s*(?:된다|돼)|는다))|(?:받아도|접수해도)\s*(?:된다|돼|안\s*된다)/u.test(entry.quote));
      if (!explicitDecisionEvidence) failure = { fieldPath: "answer", validationKind: "unsupported_acceptance_decision" };
    }
    if (failure) {
      reviewDecision("rejected", failure);
      if (failure.validationKind === "target_relation_mismatch" && failure.requestedTarget && failure.evidenceTarget && failure.targetRelation) {
        try { deps.onPrivateTargetRelationFailure?.({ requestedTarget: failure.requestedTarget, evidenceTarget: failure.evidenceTarget,
          targetRelation: failure.targetRelation, fieldPath: failure.fieldPath, validationRule: "sameDeclaredSourceTarget:v3" }); } catch {}
      }
      trace({ stage: "support_validation", validation: "rejected", reason: "SUPPORT_ASSESSMENT_INVALID", failureLayer: "support_semantics",
        fieldPath: failure.fieldPath, validationKind: failure.validationKind,
        ...(failure.validationKind === "requirement_mismatch" ? { expectedRequirementKinds: requested,
          receivedRequirementKinds: requirements.map(item => item.kind), requestedCount: requested.length, receivedCount: requirements.length } : {}) });
      trace({ stage: "final", status: "system_error", reason: "GENERATION_UNPARSABLE", failureLayer: "support_semantics" });
      return { kind: "system_error", code: "GENERATION_UNPARSABLE" };
    }
    const roleMatches = (kind: string, role: string | undefined) => role === undefined || role === kind || kind === "referral" && role === "referral_policy";
    const coversTarget = (relation: string | undefined) => relation === undefined || relation === "same" || relation === "covers_requested";
    const direct = requirements.filter((item) => item.support === "direct" && item.evidence.some((entry) => roleMatches(item.kind, entry.role) && coversTarget(entry.targetRelation)));
    const condition = requirements.find(item => item.kind === "conditions");
    const permission = requirements.find(item => item.kind === "permission");
    const states = recognizedStateConditions(input.question);
    if (input.requireEvidenceScope && target && structured.coverage !== "clarification"
      && condition && permission && states.length
      && /써도|사용해도|사용.*(?:가능|허용)/u.test(input.question)) {
      const stateEvidence = requirements.flatMap(item => item.evidence).filter(entry => coversTarget(entry.targetRelation)
        && (interpretation?.constraints ?? []).every(value => /^(?:유통기한(?:이)?\s*지난|개봉(?:한|된)|개봉\s*후|남은)$/u.test(value.trim()))
        && !hasExplicitConditionQuestion(input.question) && isLinkedStateUseProhibition(input.question, target, entry.target!, entry.quote,
          usedChunks.find(chunk => chunk.chunk_id === entry.chunkId)!.content));
      if (stateEvidence.length) {
        if (!direct.includes(permission)) direct.push(permission);
        if (!direct.includes(condition)) direct.push(condition);
        stateConditionCovered = true;
        const quotes = [...new Set(stateEvidence.map(entry => entry.quote))];
        supportedAnswer = quotes.every(quote => /사용\s*하지\s*않/u.test(quote))
          ? `질문하신 대상(${target})은 이 상태로 사용하면 안 돼요.\n\n매뉴얼 기준:\n${quotes.join("\n")}`
          : `질문하신 대상(${target})에는 다음 사용 기준이 적용돼요.\n${quotes.join("\n")}`;
      } else {
        for (const item of [permission, condition]) {
          const index = direct.indexOf(item);
          if (index >= 0) direct.splice(index, 1);
        }
      }
    }
    const unsupported = requirements.filter((item) => !direct.includes(item));
    const usefulEvidence = requirements.flatMap((item) => item.evidence).filter((entry) => entry.targetRelation !== "unrelated");
    const partialFacts = requirements.some((item) => item.support === "direct" && item.evidence.some((entry) => entry.targetRelation !== "unrelated"
      && entry.role !== undefined && !["referral_policy", "referral"].includes(entry.role)
      && !(entry.role === "permission" && item.kind !== "permission")));
    supportCoverage = direct.length === requirements.length ? "direct" : direct.length || partialFacts ? "partial" : "policy_only";
    scopeNotice = unsupported.length ? `\n\n현재 제공된 근거에서 ${unsupported.map((item) => SUPPORT_LABELS[item.kind]).join(" 및 ")}에 대한 요청 범위 전체를 확인하지 못했습니다.${supportCoverage === "partial" ? " 위 답변은 확인된 대상과 항목에 한정됩니다." : " 매장 관리자에게 확인해 주세요."}` : "";
    if (!scopeNotice && structured.coverage === "partial" && !stateConditionCovered) {
      scopeNotice = "\n\n현재 제공된 근거는 요청 범위의 일부만 지원합니다. 위 안내는 인용된 내용에 한정되며, 나머지 범위는 매장 관리자에게 확인해 주세요.";
    }
    const narrowerTargets = [...new Set(usefulEvidence.filter((entry) => entry.targetRelation === "subset").map((entry) => entry.target!))];
    if (narrowerTargets.length) scopeNotice += `\n확인된 대상은 ${narrowerTargets.join(", ")}이며, 질문의 대상 범위 전체에 적용할 수 없습니다.`;
    if (unsupported.length) {
      const quotes = [...new Set(usefulEvidence.map((entry) => entry.quote))];
      supportedAnswer = quotes.length ? `현재 제공된 근거의 안내:\n${quotes.join("\n")}` : "현재 제공된 근거로 요청한 내용을 답하기 어렵습니다.";
    }
    trace({ stage: "support_validation", validation: "accepted", supportCoverage, requestedCount: requested.length, directCount: direct.length });
    reviewDecision("accepted", undefined, direct.map(item => item.kind), stateConditionCovered);
  }
  const recipeCitations = structured.supportAssessment?.requirements.flatMap(item => item.evidence) ?? [];
  let recipe = structured.coverage === "clarification" ? null : verifyRecipeFacts(recipeQuestion, stateConditionCovered ? supportedAnswer : structured.answer,
    candidateSelection.matches, recipeCitations, deps.onPrivateRecipeFactDiagnostic);
  if (recipe && !deterministic && structured.coverage === "direct" && supportCoverage === "direct" && !scopeNotice) {
    const source = extractVerifiedRecipeSourceFacts(recipeQuestion, candidateSelection.matches, recipeCitations);
    const modelGate = verifyRecipeModelForSourceRendering(recipeQuestion, structured.answer, candidateSelection.matches, recipeCitations);
    if (source?.support.outcome === "full" && source.sourceFacts?.length && modelGate?.support.outcome === "full" && !modelGate.contradiction) {
      supportedAnswer = renderVerifiedRecipeSourceFacts(source.sourceFacts);
      recipe = source;
      try { deps.onPrivateRecipeSourceFacts?.(source.sourceFacts, supportedAnswer); } catch {}
      trace({ stage: "recipe_source_rendering", reason: "VERIFIED_SOURCE_FACTS_RENDERED", providedCount: source.sourceFacts.length });
    }
  }
  if (recipe) trace({ stage: "recipe_fact_validation", outcome: recipe.support.outcome, reason: recipe.support.reason });
  if (recipe?.contradiction) {
    trace({ stage: "final", status: "system_error", reason: "GENERATION_UNPARSABLE", failureLayer: "recipe_facts" });
    return { kind: "system_error", code: "GENERATION_UNPARSABLE" };
  }
  if (recipe && ["partial", "insufficient", "conflict", "unknown"].includes(recipe.support.outcome)) {
    const verifiedText = recipe.support.verified.map(fact => `${fact.ingredient} ${fact.quantity}${fact.unit}`).join(", ");
    const answer = recipe.support.outcome === "unknown" ? "제공된 레시피 근거에서 요청한 메뉴·온도·수량 범위를 명확히 검증하지 못했습니다. 매장 관리자에게 확인해 주세요."
      : recipe.support.outcome === "conflict" ? "같은 레시피 적용 범위의 근거가 서로 충돌합니다. 매장 관리자에게 확인해 주세요."
      : `${verifiedText ? `확인된 내용: ${verifiedText}.\n` : ""}추가 확인 필요: ${recipe.support.missing.join(", ")}. 매장 관리자에게 확인해 주세요.`;
    trace({ stage: "final", status: "insufficient", reason: recipe.support.reason, usedChunkIds: validChunkIds, evidenceScore: usedEvidenceScore });
    return addShortageScope({ kind: "resolved", escalate: true, response: { answer, status: "insufficient", similarity: usedEvidenceScore,
      source: sources[0], sources, matches, evidenceSupport: recipe.support } });
  }
  const assessedCoverage = stateConditionCovered && supportCoverage === "direct" ? "direct" : structured.coverage;
  if (assessedCoverage === "policy_only" || supportCoverage === "policy_only"
    || input.requireEvidenceScope && (supportCoverage === "partial" || assessedCoverage === "partial")) {
    trace({ stage: "final", status: "insufficient", reason: supportCoverage === "partial" || assessedCoverage === "partial" ? "PARTIAL_SUPPORT_COVERAGE" : "POLICY_ONLY_COVERAGE", usedChunkIds: validChunkIds, evidenceScore: usedEvidenceScore,
      supportCoverage: supportCoverage ?? "policy_only" });
    return addShortageScope({ kind: "resolved", escalate: true, response: {
      answer: supportedAnswer + scopeNotice, similarity: usedEvidenceScore, source: sources[0], sources,
      status: "insufficient", matches,
      ...(recipe ? { evidenceSupport: { ...recipe.support, outcome: "unknown" as const, reason: "RECIPE_PRIOR_SCOPE_NOT_FULL" } } : {}),
    } });
  }
  const verifiedTargetScope = stateConditionCovered || Boolean(structured.supportAssessment?.requirements.every(item =>
    item.evidence.some(entry => {
      if (entry.role !== item.kind && !(item.kind === "referral" && entry.role === "referral_policy")) return false;
      if (entry.targetRelation === "same") return true;
      return entry.targetRelation === "covers_requested" && Boolean(structured.supportAssessment?.requestedTarget
        && normalizeTargetText(entry.quote).includes(normalizeTargetText(structured.supportAssessment.requestedTarget)));
    })));
  const strictSupportValidation = input.requireSupportAssessment && input.requireEvidenceScope && !deterministic;
  const verifiedFullSupport = strictSupportValidation && assessedCoverage === "direct" && supportCoverage === "direct"
    && !scopeNotice && verifiedTargetScope && (!recipe || recipe.support.outcome === "full");
  const status = deterministicSourceAnswer ? "answered" : strictSupportValidation ? verifiedFullSupport ? "answered" : "cautious"
    : usedEvidenceScore >= input.thresholds.answered ? "answered" : "cautious";
  const scopedAnswer = supportedAnswer + scopeNotice;
  const scopeCheck = strictSupportValidation && !verifiedTargetScope && structured.coverage !== "clarification"
    ? `\n\n확인할 사항: 인용된 근거의 대상과 적용 조건이 질문하신 ${structured.supportAssessment?.requestedTarget ?? "대상"}에도 해당하는지 매장 관리자에게 확인해 주세요.` : "";
  const answer = status === "cautious" && structured.coverage !== "clarification" ? `${scopedAnswer}${scopeCheck || input.cautionNotice}` : scopedAnswer;
  trace({ stage: "final", status, reason: "SUPPORTED_ANSWER", classificationReason: verifiedFullSupport ? "VERIFIED_FULL_SUPPORT"
    : strictSupportValidation ? "FULL_SUPPORT_NOT_INDEPENDENTLY_VERIFIED"
    : status === "cautious" ? "CITED_EVIDENCE_BELOW_ANSWERED_THRESHOLD" : "CITED_EVIDENCE_AT_ANSWERED_THRESHOLD",
    usedChunkIds: validChunkIds, evidenceScore: usedEvidenceScore, supportCoverage: supportCoverage ?? structured.coverage ?? null });

  return {
    kind: "resolved",
    escalate: false,
    response: {
      ...(structured.coverage === "clarification" ? { responseKind: "clarification" as const } : {}),
      ...(recipe ? { evidenceSupport: recipe.support } : {}),
      answer,
      similarity: usedEvidenceScore,
      source: sources[0],
      sources,
      status,
      matches,
    },
  };
}
