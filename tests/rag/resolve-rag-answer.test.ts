import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import ts from "typescript";
import { conversationTraceTag, createRagDiagnosticTrace, annotateCandidateScopes } from "../../lib/rag/trace-identifiers.ts";
import { requestedSupportKinds, sameDeclaredSourceTarget, StructuredAnswerParseError } from "../../lib/rag/structured-answer.ts";
import { boundedQuestionContext, buildQuestionInterpretationRequest, parseQuestionInterpretation, createQuestionInterpreter, shouldInterpretQuestion } from "../../lib/rag/question-interpretation.ts";
import { createEmbedding } from "../../lib/rag/openai-embeddings.ts";
import { chunkManualText } from "../../lib/rag/chunk-manual.ts";

import { resolveRagAnswer } from "../../lib/rag/resolve-rag-answer.ts";
import { finalizeRagQueryResponse } from "../../lib/rag/finalize-rag-query-response.ts";
import { validateQueryRequest } from "../../lib/rag/validate-query-request.ts";
import { extractSearchKeywords, formatSearchEmbeddingInput } from "../../lib/rag/search-query.ts";
import { buildGroundedAnswerMessages } from "../../lib/rag/answer-prompt.ts";
import { buildMenuClarification, candidateMenuNames, selectMenuCandidates, canUseFamilyPackHistory, priorFamilyPackVariant } from "../../lib/rag/manual-menu-intent.ts";
import { diagnoseRagCase, redactDiagnostic, runDiagnostic } from "../../scripts/diagnose-rag.ts";
import type { ManualChunkMatch } from "../../lib/rag/types.ts";

const THRESHOLDS = { answered: 0.6, cautious: 0.4 };
const NO_MANUAL_ANSWER = "해당 질문에 관한 매뉴얼 내용을 찾지 못했습니다. 매장 관리자에게 문의해 주세요.";
const CAUTION_NOTICE = "\n\n※ 검색 신뢰도가 낮은 답변입니다.";

const INPUT = {
  question: "환불은 어떻게 하나요?",
  thresholds: THRESHOLDS,
  noManualAnswer: NO_MANUAL_ANSWER,
  cautionNotice: CAUTION_NOTICE,
};

function chunk(id: string, overrides: Partial<ManualChunkMatch> = {}): ManualChunkMatch {
  const raw = overrides.raw_similarity_score ?? 0.75;
  const boost = overrides.keyword_boost ?? 0;
  return {
    chunk_id: id,
    manual_id: `manual-${id}`,
    title: `제목 ${id}`,
    category: "운영",
    content: `내용 ${id}`,
    raw_similarity_score: raw,
    keyword_boost: boost,
    similarity_score: boost === 0.35 ? Math.max(0.6, raw + boost) : Math.min(1, raw + boost),
    ...overrides,
  };
}

function deps(options: {
  results?: ManualChunkMatch[];
  searchError?: boolean;
  generateError?: boolean;
  generation?: string;
  onGenerate?: (chunks: ManualChunkMatch[]) => void;
}) {
  return {
    async search() {
      if (options.searchError) throw new Error("rpc down");
      return options.results ?? [];
    },
    async generate(_question: string, chunks: ManualChunkMatch[]) {
      options.onGenerate?.(chunks);
      if (options.generateError) throw new Error("openai down");
      return options.generation ?? '{"answerable":true,"answer":"답변","usedChunkIds":["c1"]}';
    },
  };
}

describe("bounded sentence quote whitespace", () => {
  const question = "검증표식 E2E-R1의 확인 문자열 알려줘";
  const quote = "검증표식 E2E-R1의 확인 문자열은 POC-CHECK-R1-V2이다.";
  async function resolveQuote(content: string, evidenceQuote: string, reviews: { validation: string; quote: string }[] = []) {
    return resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
      search: async () => [chunk("quote-v2", { content })],
      generate: async () => JSON.stringify({ answerable: true, answer: "확인 문자열은 POC-CHECK-R1-V2입니다.", usedChunkIds: ["quote-v2"], coverage: "direct",
        supportAssessment: { requestedTarget: "검증표식 E2E-R1", requirements: [{ kind: "facts", support: "direct", evidence: [{ chunkId: "quote-v2", quote: evidenceQuote,
          role: "facts", target: "검증표식 E2E-R1", targetRelation: "same" }] }] } }),
      onPrivateDecisionReview: review => { reviews.push({ validation: review.validation, quote: review.requirements[0]?.evidence[0]?.quote }); },
    });
  }

  test("actual V2 failure shape accepts only sentence whitespace and restores source spelling", async () => {
    for (const whitespace of ["\n", "\r\n", "  ", "\t"]) {
      const original = `검증표식 E2E-R1의 확인 문자열은${whitespace}POC-CHECK-R1-V2이다.`;
      const reviews: { validation: string; quote: string }[] = [];
      const outcome = await resolveQuote(`TEST ONLY. ${original} 운영 지침이 아닌 시험 자료다.`, quote, reviews);
      assert.equal(outcome.kind, "resolved");
      assert.equal(reviews.find(review => review.validation === "accepted")?.quote, original);
    }
  });

  test("word, number, negation, order and structural boundary changes stay rejected", async () => {
    const plain = "검증표식 E2E-R1의 확인 문자열은\nPOC-CHECK-R1-V2이다.";
    const cases = [
      { content: plain, quote: quote.replace("V2", "V1") },
      { content: plain, quote: quote.replace("이다.", "아니다.") },
      { content: plain, quote: quote.replace("확인 문자열은 ", "") },
      { content: plain, quote: quote.replace("문자열은 ", "문자열은") },
      { content: plain, quote: quote.replace("문자열은", "새 확인 문자열은") },
      { content: plain, quote: "POC-CHECK-R1-V2이다. 검증표식 E2E-R1의 확인 문자열은" },
      { content: "검증표식 E2E-R1의 확인 문자열은\n\nPOC-CHECK-R1-V2이다.", quote },
      { content: "검증표식 E2E-R1의 확인 문자열은\n# POC-CHECK-R1-V2이다.", quote: quote.replace("POC", "# POC") },
      { content: "- 검증표식 E2E-R1의 확인 문자열은\n- POC-CHECK-R1-V2이다.", quote: "- 검증표식 E2E-R1의 확인 문자열은 - POC-CHECK-R1-V2이다." },
      { content: "1. 검증표식 E2E-R1의 확인 문자열은\n2. POC-CHECK-R1-V2이다.", quote: "1. 검증표식 E2E-R1의 확인 문자열은 2. POC-CHECK-R1-V2이다." },
      { content: "| 검증표식 E2E-R1의 확인 문자열은 |\n| POC-CHECK-R1-V2이다. |", quote: "| 검증표식 E2E-R1의 확인 문자열은 | | POC-CHECK-R1-V2이다. |" },
      { content: "검증표식 E2E-R1 확인 기준\nPOC-CHECK-R1-V2이다.", quote: "검증표식 E2E-R1 확인 기준 POC-CHECK-R1-V2이다." },
      { content: "검증표식 E2E-R1은 사용하지 않는다.\nPOC-CHECK-R1-V2이다.", quote: "검증표식 E2E-R1은 사용하지 않는다. POC-CHECK-R1-V2이다." },
    ];
    for (const scenario of cases) assert.deepEqual(await resolveQuote(scenario.content, scenario.quote), { kind: "system_error", code: "GENERATION_UNPARSABLE" });
  });

  test("server-rendered policy quotation restores only the verified source span", async () => {
    const original = "검증표식 E2E-R1의 확인 문자열은\n관리자에게 확인한다.";
    const outcome = await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
      search: async () => [chunk("quote-policy", { content: original })],
      generate: async () => JSON.stringify({ answerable: true, answer: "model wording must not replace the verified quotation", usedChunkIds: ["quote-policy"], coverage: "policy_only",
        supportAssessment: { requestedTarget: "검증표식 E2E-R1", requirements: [{ kind: "facts", support: "policy_only", evidence: [{ chunkId: "quote-policy",
          quote: original.replace("\n", " "), role: "referral_policy", target: "검증표식 E2E-R1", targetRelation: "same" }] }] } }),
    });
    assert.equal(outcome.kind, "resolved");
    if (outcome.kind !== "resolved") throw new Error("Expected supported policy quotation");
    assert.equal(outcome.response.status, "insufficient");
    assert.ok(outcome.response.answer.includes(original));
    assert.equal(outcome.response.answer.includes("model wording"), false);
  });
});

function expectResolved(outcome: Awaited<ReturnType<typeof resolveRagAnswer>>) {
  assert.equal(outcome.kind, "resolved");
  if (outcome.kind !== "resolved") throw new Error("unreachable");
  return outcome;
}

describe("근거가 충분한 질문", () => {
  test("D ICE prompt delivery does not bypass target relation validation or retry generation", async () => {
    const question = "아이스 카페라떼 만들 때 우유 몇 ml 넣어?";
    const ice = chunk("d-ice-relation", { title: "음료 제조 및 레시피 관리", content: "4-3. 카페라떼\nHOT 카페라떼: 우유 250ml\n● ICE 카페라떼\n우유 240ml", diagnostic_scope: "hq",
      raw_similarity_score: .385095411322363, keyword_boost: .2 });
    for (const evidenceTarget of ["ICE 카페라떼", "HOT 카페라떼"]) {
      const events: Record<string, unknown>[] = [];
      const privateDiagnostics: Record<string, unknown>[] = [];
      let searches = 0;
      let generations = 0;
      const outcome = await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async () => { searches++; return [ice]; },
        generate: async (original, provided) => {
          generations++;
          assert.equal(original, question);
          assert.deepEqual(provided.map(match => match.chunk_id), [ice.chunk_id]);
          assert.ok(buildGroundedAnswerMessages(original, provided)[1].content.includes(ice.content));
          return JSON.stringify({ answerable: true, answer: "아이스 카페라떼에는 우유 240ml를 넣어요.", coverage: "direct", usedChunkIds: [ice.chunk_id],
            supportAssessment: { requestedTarget: "아이스 카페라떼", requirements: [{ kind: "facts", support: "direct", evidence: [
              { chunkId: ice.chunk_id, quote: ice.content, role: "facts", target: evidenceTarget, targetRelation: "same" },
            ] }] } });
        },
        onDiagnostic: event => events.push(event),
        onPrivateTargetRelationFailure: diagnostic => { privateDiagnostics.push(diagnostic); throw new Error("private diagnostic storage unavailable"); },
      });
      assert.equal(searches, 1);
      assert.equal(generations, 1);
      const delivered = events.find(event => event.stage === "prompt_delivery")?.candidates as { chunkId: string; promptIncluded: boolean; scopeKind: string }[];
      assert.equal(delivered[0].chunkId, ice.chunk_id);
      assert.equal(delivered[0].promptIncluded, true);
      assert.equal(delivered[0].scopeKind, "hq");
      if (evidenceTarget === "ICE 카페라떼") {
        const resolved = expectResolved(outcome);
        assert.equal(resolved.response.status, "cautious");
        assert.equal(resolved.response.source?.manualId, ice.manual_id);
        assert.ok(resolved.response.answer.includes("240ml"));
        assert.equal(privateDiagnostics.length, 0);
      } else {
        assert.deepEqual(outcome, { kind: "system_error", code: "GENERATION_UNPARSABLE" });
        const failure = events.find(event => event.stage === "support_validation");
        assert.equal(failure?.fieldPath, "supportAssessment.requirements[0].evidence[0].targetRelation");
        assert.equal(failure?.validationKind, "target_relation_mismatch");
        assert.equal(failure?.failureLayer, "support_semantics");
        assert.equal("requestedTarget" in failure!, false);
        assert.deepEqual(privateDiagnostics, [{ requestedTarget: "아이스 카페라떼", evidenceTarget: "HOT 카페라떼", targetRelation: "same",
          fieldPath: "supportAssessment.requirements[0].evidence[0].targetRelation", validationRule: "sameDeclaredSourceTarget:v3" }]);
        assert.equal("response" in outcome, false);
      }
    }
  });

  test("a quantity-scoped target and source context resolve through their one shared menu entity", async () => {
    const question = "아이스 카페라떼 만들 때 우유 몇 ml 넣어?";
    const recipe = chunk("d-quantity-attribute", { title: "음료 제조 및 레시피 관리", content: "4-3. 카페라떼\n● ICE 카페라떼\n우유 240ml",
      raw_similarity_score: .385095411322363, keyword_boost: .2 });
    const events: Record<string, unknown>[] = [];
    const incorrect = await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
      search: async () => [recipe],
      generate: async () => JSON.stringify({ answerable: true, answer: "240ml", coverage: "direct", usedChunkIds: [recipe.chunk_id],
        supportAssessment: { requestedTarget: "아이스 카페라떼 만들 때 우유 몇 ml", requirements: [{ kind: "facts", support: "direct", evidence: [
          { chunkId: recipe.chunk_id, quote: recipe.content, role: "facts", target: "ICE 카페라떼 우유", targetRelation: "same" },
        ] }] } }),
      onDiagnostic: event => events.push(event),
    });
    const reproduced = expectResolved(incorrect);
    assert.equal(reproduced.response.status, "cautious");
    assert.equal(reproduced.response.source?.manualId, recipe.manual_id);
    assert.ok(reproduced.response.answer.includes("240ml"));
    assert.equal(events.some(event => event.stage === "support_validation" && event.validationKind === "target_relation_mismatch"), false);

    const corrected = expectResolved(await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
      search: async () => [recipe],
      generate: async () => JSON.stringify({ answerable: true, answer: "ICE 카페라떼에는 우유 240ml를 넣어요.", coverage: "direct", usedChunkIds: [recipe.chunk_id],
        supportAssessment: { requestedTarget: "아이스 카페라떼", requirements: [{ kind: "facts", support: "direct", evidence: [
          { chunkId: recipe.chunk_id, quote: recipe.content, role: "facts", target: "ICE 카페라떼", targetRelation: "same" },
        ] }] } }),
    }));
    assert.equal(corrected.response.status, "cautious");
    assert.equal(corrected.response.source?.manualId, recipe.manual_id);
    assert.ok(corrected.response.answer.includes("240ml"));
  });

  test("Korean iced recipe questions retain numbered cafe latte evidence and reject explicitly different modes and menus", async () => {
    const question = "아이스 카페라떼 만들 때 우유 몇 ml 넣어?";
    const ice = chunk("actual-format-ice", { title: "음료 제조 및 레시피 관리", content: "4-3. 카페라떼\n● ICE 카페라떼\n우유 240ml", raw_similarity_score: .75 });
    const hot = chunk("hot-only", { title: "음료 제조", content: "4-3. 카페라떼\nHOT 카페라떼 우유 250ml", raw_similarity_score: .95 });
    const vanilla = chunk("other-menu", { title: "바닐라라떼", content: "ICE 바닐라라떼 우유 220ml", raw_similarity_score: .95 });
    const selected = selectMenuCandidates(question, [hot, vanilla, ice]);
    assert.deepEqual(selected.matches.map(match => match.chunk_id), [ice.chunk_id]);
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
      search: async () => [hot, vanilla, ice], generate: async (original, provided) => {
        assert.equal(original, question);
        assert.deepEqual(provided.map(match => match.chunk_id), [ice.chunk_id]);
        assert.ok(buildGroundedAnswerMessages(original, provided)[1].content.includes(ice.content));
        return JSON.stringify({ answerable: true, answer: "아이스 카페라떼에는 우유 240ml를 넣어요.", coverage: "direct", usedChunkIds: [ice.chunk_id],
          supportAssessment: { requestedTarget: "카페라떼", requirements: [{ kind: "facts", support: "direct", evidence: [
            { chunkId: ice.chunk_id, quote: ice.content, role: "facts", target: "카페라떼", targetRelation: "same" },
          ] }] } });
      },
    }));
    assert.equal(outcome.response.status, "answered");
    assert.equal(outcome.response.source?.manualId, ice.manual_id);
    assert.ok(outcome.response.answer.includes("240ml"));
    assert.equal(selectMenuCandidates("HOT 카페라떼 우유량은?", [hot, ice]).matches[0].chunk_id, hot.chunk_id);
    const ambiguous = buildMenuClarification("아이스 라떼 우유 얼마 넣어?", [ice, vanilla]);
    assert.ok(ambiguous?.answer.includes("어떤 라떼"));
    assert.equal(ambiguous?.answer.includes("240"), false);
  });

  test("verified B conditions accompany the context target through search, generation and shortage notice", async () => {
    const question = "그럼 개봉한 우유는 어떻게 관리해?";
    const interpretation = { target: "", contextTarget: "우유", constraints: ["개봉한"], requirements: ["conditions" as const, "method" as const], clarification: false };
    const policy = "재료 보관 기준이 없으면 담당자에게 확인한다.";
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true,
      interpretationContext: { userId: "staff", storeId: "store", conversation: { userId: "staff", storeId: "store",
        messages: [{ role: "user", content: "우유 어디 둬?" }] } } }, {
      interpret: async () => interpretation,
      search: async query => { assert.ok(query.startsWith(question)); assert.ok(query.includes("확인된 이전 질문 대상: 우유"));
        assert.ok(query.includes("확인된 현재 질문 조건: 개봉한")); return [chunk("condition-policy", { content: policy })]; },
      generate: async (query, _sources, _variant, assessed) => {
        assert.ok(query.includes("개봉한")); assert.deepEqual(assessed?.requirements, ["conditions", "method"]);
        return JSON.stringify({ answerable: true, answer: policy, coverage: "policy_only", usedChunkIds: ["condition-policy"],
          supportAssessment: { requestedTarget: "우유", requirements: [
            { kind: "conditions", support: "missing", evidence: [] },
            { kind: "method", support: "policy_only", evidence: [{ chunkId: "condition-policy", quote: policy, role: "referral_policy", target: "재료", targetRelation: "covers_requested" }] },
          ] } });
      },
    }));
    assert.equal(outcome.response.status, "insufficient");
    assert.ok(outcome.response.answer.includes("우유"));
    assert.ok(outcome.response.answer.includes("개봉한"));
    assert.ok(outcome.response.answer.includes("구체적인 수행 방법"));
    assert.equal(/\d+\s*(?:℃|일|시간)/u.test(outcome.response.answer), false);
  });

  test("explicit un-interpreted condition shortage retains the requested scope without inventing a period", async () => {
    const question = "우유의 개봉 후 보관 기간이 궁금해";
    for (const results of [[], [chunk("period-policy", { content: "우유: 냉장고 선반", raw_similarity_score: .7 })]]) {
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question, requireCoverage: true,
        requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async original => { assert.equal(original, question); return results; },
        generate: async () => JSON.stringify({ answerable: false, answer: "", usedChunkIds: [], coverage: "policy_only", supportAssessment: null }),
      }));
      assert.equal(outcome.response.status, "insufficient");
      assert.equal(outcome.escalate, true);
      assert.equal(outcome.response.source, null);
      assert.ok(outcome.response.answer.includes(question));
      assert.ok(outcome.response.answer.includes("현재 제공된 근거에서"));
      assert.equal(/\d+\s*(?:일|시간|℃)/u.test(outcome.response.answer), false);
      assert.notEqual(outcome.response.responseKind, "clarification");
    }
    const failure = await resolveRagAnswer({ ...INPUT, question }, {
      search: async () => [chunk("period-failure")], generate: async () => { throw new Error("fixture service failure"); },
    });
    assert.deepEqual(failure, { kind: "system_error", code: "GENERATION_FAILED" });
  });

  test("common shortage scope survives every abstention and persistence fallback without a condition-only gate", async () => {
    for (const question of ["우유의 개봉 후 보관 기간이 궁금해", "식빵 보관 기간 알려줘", "정수기 필터 교체 순서 알려줘",
      "커피머신 내부 분해 세척 순서 알려줘. 그리고 언제 해야 하는지도 알려줘"]) {
      for (const mode of ["empty", "below_threshold", "not_answerable", "invalid_citation"]) {
        const events: Record<string, unknown>[] = [];
        const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question, requireCoverage: true,
          requireSupportAssessment: true, requireEvidenceScope: true }, {
          search: async () => mode === "empty" ? [] : [chunk("common-shortage", { raw_similarity_score: mode === "below_threshold" ? .1 : .8 })],
          generate: async () => JSON.stringify(mode === "invalid_citation"
            ? { answerable: true, answer: "임의 안내", coverage: "direct", usedChunkIds: ["unprovided"],
              supportAssessment: { requestedTarget: question, requirements: requestedSupportKinds(question).map(kind => ({ kind, support: "direct",
                evidence: [{ chunkId: "unprovided", quote: "임의 인용", role: kind, target: question, targetRelation: "same" }] })) } }
            : { answerable: false, answer: "7일 보관 가능", coverage: "policy_only", usedChunkIds: [], supportAssessment: null }),
          onDiagnostic: event => events.push(event),
        }));
        assert.equal(outcome.response.status, "insufficient");
        assert.equal(outcome.escalate, true);
        assert.equal(outcome.response.source, null);
        assert.deepEqual(outcome.response.sources, []);
        assert.ok(outcome.response.answer.includes(question));
        assert.equal(outcome.response.answer.includes("7일"), false);
        assert.equal(outcome.response.answer.includes("임의 안내"), false);
        assert.equal(events.at(-1)?.reason, mode === "empty" ? "NO_SEARCH_CANDIDATES" : mode === "below_threshold"
          ? "BELOW_EVIDENCE_THRESHOLD" : mode === "not_answerable" ? "MODEL_NOT_ANSWERABLE" : "NO_VALID_CITED_CHUNKS");
        const finalized = await finalizeRagQueryResponse({ httpStatus: 200, question, storeId: "store", response: outcome.response,
          afterQuestionLogSaved: async () => { throw new Error("fixture follow-up failure"); } }, async saved => {
          assert.equal(saved.answer, outcome.response.answer);
          return { saved: false, code: "QUESTION_LOG_SAVE_FAILED" };
        });
        assert.equal("answer" in finalized && finalized.answer, outcome.response.answer);
      }
    }
    const question = "커피머신 세척 순서 알려줘. 그리고 언제 해야 하는지도 알려줘";
    const interpreted = expectResolved(await resolveRagAnswer({ ...INPUT, question }, {
      interpret: async () => ({ target: "커피머신", contextTarget: null, constraints: [], requirements: ["procedure", "timing"], clarification: false }),
      search: async () => [], generate: async () => { throw new Error("generation must not run"); },
    }));
    assert.ok(interpreted.response.answer.includes(question));
    assert.ok(interpreted.response.answer.includes("커피머신"));
    assert.ok(interpreted.response.answer.includes("구체적인 작업 절차"));
    assert.ok(interpreted.response.answer.includes("적용 시점"));
  });

  test("partial support preserves the full question but names only unsupported requirements as missing", async () => {
    const question = "정수기 필터 교체 순서와 시점 알려줘";
    const content = "정수기의 필터를 제거하고 교체한다.";
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question, requireCoverage: true,
      requireSupportAssessment: true, requireEvidenceScope: true }, {
      search: async () => [chunk("partial-scope", { content })],
      generate: async () => JSON.stringify({ answerable: true, answer: content, coverage: "partial", usedChunkIds: ["partial-scope"],
        supportAssessment: { requestedTarget: "정수기", requirements: [
          { kind: "procedure", support: "direct", evidence: [{ chunkId: "partial-scope", quote: content, role: "procedure", target: "정수기", targetRelation: "same" }] },
          { kind: "timing", support: "missing", evidence: [] },
        ] } }),
    }));
    assert.equal(outcome.response.status, "insufficient");
    assert.ok(outcome.response.answer.includes(question));
    assert.ok(outcome.response.answer.includes(content));
    assert.ok(outcome.response.answer.includes("적용 시점에 대한 요청 범위 전체를 확인하지 못했습니다"));
    assert.equal(outcome.response.answer.includes("구체적인 작업 절차에 대한 요청 범위 전체를 확인하지 못했습니다"), false);
    assert.equal(outcome.response.source?.manualId, "manual-partial-scope");
  });

  test("approved HQ expiry policy excerpt directly covers permission and expired condition with synthetic generation", async () => {
    const question = "유통기한 지난 우유 써도 돼?";
    const quote = "- 유통기한이 지난 식재료는 사용하지 않는다.";
    const evidence = chunk("approved-expiry-excerpt", { title: "재고 관리", content: quote, diagnostic_scope: "hq" });
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question, requireCoverage: true,
      requireSupportAssessment: true, requireEvidenceScope: true }, {
      search: async () => [evidence],
      generate: async original => {
        assert.equal(original, question);
        assert.deepEqual(requestedSupportKinds(original), ["permission", "conditions"]);
        return JSON.stringify({ answerable: true, answer: "유통기한 지난 우유는 사용하면 안 됩니다.", coverage: "direct", usedChunkIds: [evidence.chunk_id],
          supportAssessment: { requestedTarget: "우유", requirements: ["permission", "conditions"].map(kind => ({ kind, support: "direct",
            evidence: [{ chunkId: evidence.chunk_id, quote, role: kind, target: "식재료", targetRelation: "covers_requested" }] })) } });
      },
    }));
    assert.equal(outcome.response.status, "answered");
    assert.equal(outcome.escalate, false);
    assert.ok(outcome.response.answer.includes("사용하면 안 돼요"));
    assert.equal(outcome.response.answer.includes("요청 범위 전체를 확인하지 못했습니다"), false);
    assert.equal(outcome.response.source?.manualId, evidence.manual_id);
  });

  test("conditional use permission already covers the named state despite missing or policy-role conditions metadata", async () => {
    for (const scenario of [
      { question: "유통기한 지난 우유 써도 돼?", target: "우유", sourceTarget: "식재료", relation: "covers_requested", quote: "유통기한이 지난 식재료는 사용하지 않는다." },
      { question: "유통기한이 지난 요구르트 써도 돼?", target: "요구르트", sourceTarget: "식재료", relation: "covers_requested", quote: "유통기한이 지난 식재료는 사용하지 않는다." },
      { question: "개봉한 시럽 써도 돼?", target: "시럽", sourceTarget: "시럽", relation: "same", quote: "개봉한 시럽은 사용하지 않는다." },
    ]) for (const coverage of ["direct", "partial", "policy_only"]) for (const support of ["missing", "direct", "policy_only"]) {
      const evidence = { chunkId: "state-permission", quote: scenario.quote, role: "permission", target: scenario.sourceTarget, targetRelation: scenario.relation };
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: scenario.question, requireCoverage: true,
        requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async () => [chunk("state-permission", { content: scenario.quote, raw_similarity_score: .25968326912132, keyword_boost: .2 })],
        generate: async () => JSON.stringify({ answerable: true, answer: "37도에서 7일 사용 가능", coverage, usedChunkIds: ["state-permission"],
          supportAssessment: { requestedTarget: scenario.target, requirements: [
            { kind: "permission", support: "direct", evidence: [evidence] },
            { kind: "conditions", support, evidence: support === "missing" ? [] : [evidence] },
          ] } }),
      }));
      assert.equal(outcome.response.status, "cautious");
      assert.equal(outcome.escalate, false);
      assert.ok(outcome.response.answer.includes(scenario.target));
      assert.ok(outcome.response.answer.includes("사용하면 안 돼요"));
      assert.equal(outcome.response.answer.includes("요청 범위 전체를 확인하지 못했습니다"), false);
      assert.equal(/37|7일/u.test(outcome.response.answer), false);
      assert.equal(outcome.response.source?.manualId, "manual-state-permission");
    }
  });

  test("conditional use inference cannot supply unquoted states, explicit temperature, timing or disassembly procedures", async () => {
    for (const scenario of [
      { question: "개봉한 시럽 써도 돼?", quote: "시럽은 사용하지 않는다.", expected: ["permission", "conditions"] },
      { question: "유통기한 지난 시럽 써도 돼? 온도 조건도 알려줘", quote: "유통기한 지난 시럽은 사용하지 않는다.", expected: ["permission", "conditions"] },
      { question: "유통기한 지난 시럽 써도 돼? 언제 써야 해?", quote: "유통기한 지난 시럽은 사용하지 않는다.", expected: ["permission", "conditions", "timing"] },
      { question: "개봉한 시럽 분해해도 돼? 순서 알려줘", quote: "개봉한 시럽은 사용하지 않는다.", expected: ["permission", "conditions", "procedure"] },
    ]) {
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: scenario.question, requireCoverage: true,
        requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async () => [chunk("state-negative", { content: scenario.quote })],
        generate: async () => JSON.stringify({ answerable: true, answer: scenario.quote, coverage: "partial", usedChunkIds: ["state-negative"],
          supportAssessment: { requestedTarget: "시럽", requirements: scenario.expected.map(kind => kind === "permission"
            ? { kind, support: "direct", evidence: [{ chunkId: "state-negative", quote: scenario.quote, role: "permission", target: "시럽", targetRelation: "same" }] }
            : { kind, support: "missing", evidence: [] }) } }),
      }));
      assert.equal(outcome.response.status, "insufficient");
      assert.equal(outcome.escalate, true);
      assert.ok(outcome.response.answer.includes("요청 범위 전체를 확인하지 못했습니다"));
    }
  });

  test("state use policy requires one linked subject-state-prohibition clause, not keywords or model declarations", async () => {
    const cases = [
      { question: "유통기한 지난 우유 써도 돼?", target: "우유", source: "식재료", quote: "유통기한이 지난 식재료는 유통기한을 확인한다." },
      { question: "유통기한 지난 우유 써도 돼?", target: "우유", source: "시럽", quote: "유통기한 지난 시럽은 사용하지 않는다." },
      { question: "유통기한 지난 우유 써도 돼?", target: "우유", source: "식재료", quote: "개봉한 식재료는 사용하지 않는다. 유통기한 지난 우유를 확인한다." },
      { question: "유통기한 지난 우유 써도 돼?", target: "우유", source: "식재료", quote: "유통기한이 지나지 않은 식재료는 사용하지 않는다. 유통기한 지난 재료를 확인한다." },
      { question: "유통기한 지난 우유 써도 돼?", target: "우유", source: "식재료", quote: "유통기한 지난 식재료는 사용하지 않는 것은 아니다." },
      { question: "유통기한 지난 우유 써도 돼?", target: "우유", source: "식재료", quote: "유통기한 지난 식재료는 사용하지 않는다. 단, 승인받은 경우는 예외다." },
      { question: "유통기한 지난 우유 써도 돼?", target: "우유", source: "식재료", quote: "유통기한 지난 식재료는 사용하지 않는다.", extra: "단, 승인받은 경우는 예외다." },
      { question: "유통기한 지난 우유 써도 돼?", target: "우유", source: "식재료", quote: "유통기한 지난 식재료는 사용하지 않는다.", extra: "유통기한 지난 식재료는 사용할 수 있다." },
      { question: "개봉한 유통기한 지난 우유 써도 돼?", target: "우유", source: "식재료", quote: "유통기한 지난 식재료는 사용하지 않는다." },
      { question: "유통기한 지난 우유가 냄새도 이상한데 써도 돼?", target: "우유", source: "식재료", quote: "유통기한 지난 식재료는 사용하지 않는다." },
      { question: "유통기한 지난 우유 써도 돼?", target: "우유", source: "식재료", quote: "유통기한 지난 식재료와 우유는 확인한다. 시럽은 사용하지 않는다." },
      { question: "유통기한 지난 세제 써도 돼?", target: "세제", source: "식재료", quote: "유통기한 지난 식재료는 사용하지 않는다." },
      { question: "유통기한 지난 우유 써도 돼? 온도 조건도 알려줘", target: "우유", source: "식재료", quote: "유통기한 지난 식재료는 사용하지 않는다." },
    ];
    for (const scenario of cases) for (const declaredDirect of [false, true]) {
      const evidence = { chunkId: "linked-policy", quote: scenario.quote, role: "permission", target: scenario.source, targetRelation: "covers_requested" };
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: scenario.question, requireCoverage: true,
        requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async () => [chunk("linked-policy", { content: `${scenario.quote}\n${scenario.extra ?? ""}` })],
        generate: async () => JSON.stringify({ answerable: true, answer: "사용하면 안 돼요", coverage: "direct", usedChunkIds: ["linked-policy"],
          supportAssessment: { requestedTarget: scenario.target, requirements: [
            { kind: "permission", support: "direct", evidence: [evidence] },
            { kind: "conditions", support: declaredDirect ? "direct" : "missing", evidence: declaredDirect ? [{ ...evidence, role: "conditions" }] : [] },
          ] } }),
      }));
      assert.equal(outcome.response.status, "insufficient", scenario.quote);
      assert.ok(outcome.response.answer.includes("요청 범위 전체를 확인"));
      assert.equal(outcome.response.answer.includes(`질문하신 대상(${scenario.target})은 이 상태로 사용하면 안 돼요`), false);
    }
  });

  test("state-qualified requested and evidence targets retain the same validated policy identity", async () => {
    for (const requestedTarget of ["우유", "유통기한 지난 우유"]) for (const evidenceTarget of ["식재료", "유통기한이 지난 식재료", "개봉한 식재료"]) {
      const quote = "유통기한이 지난 식재료는 사용하지 않는다.";
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "유통기한 지난 우유 써도 돼?", requireCoverage: true,
        requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async () => [chunk("qualified-target", { content: `${quote}\n개봉한 식재료의 상태를 확인한다.` })],
        generate: async () => JSON.stringify({ answerable: true, answer: "사용 금지", coverage: "direct", usedChunkIds: ["qualified-target"],
          supportAssessment: { requestedTarget, requirements: [
            { kind: "permission", support: "direct", evidence: [{ chunkId: "qualified-target", quote, role: "permission", target: evidenceTarget, targetRelation: "covers_requested" }] },
            { kind: "conditions", support: "direct", evidence: [{ chunkId: "qualified-target", quote: "개봉한 식재료의 상태를 확인한다.", role: "conditions", target: "식재료", targetRelation: "unrelated" }] },
          ] } }),
      }));
      assert.equal(outcome.response.status, evidenceTarget === "개봉한 식재료" ? "insufficient" : "answered");
    }
  });

  test("synthetic repository projection regression retains the private replay shape without private source text", async () => {
    const fixture = { provenance: "synthetic-text-and-ids-derived-from-reviewed-projection-shape", priorObservedStatus: "insufficient",
      question: "유통기한 지난 시럽 써도 돼?", requestedTarget: "유통기한 지난 시럽",
      quote: "유통기한이 지난 시럽은 사용하지 않는다.", conditionQuote: "시럽의 상태를 점검한다." };
    const events: Record<string, unknown>[] = [];
    const sources = ["synthetic-policy-a", "synthetic-policy-b"].map(id => chunk(id, {
      content: `${fixture.quote}\n${fixture.conditionQuote}`, raw_similarity_score: .420154763720169,
    }));
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: fixture.question,
      requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
      search: async () => sources,
      generate: async () => JSON.stringify({ answerable: true, answer: "synthetic model answer", coverage: "direct", usedChunkIds: sources.map(item => item.chunk_id),
        supportAssessment: { requestedTarget: fixture.requestedTarget, requirements: [
          { kind: "permission", support: "direct", evidence: sources.map(item => ({ chunkId: item.chunk_id, quote: fixture.quote,
            role: "permission", target: "유통기한이 지난 시럽", targetRelation: "covers_requested" })) },
          { kind: "conditions", support: "direct", evidence: sources.map(item => ({ chunkId: item.chunk_id, quote: fixture.conditionQuote,
            role: "conditions", target: "시럽", targetRelation: "unrelated" })) },
        ] } }), onDiagnostic: event => events.push(event),
    }));
    assert.equal(fixture.priorObservedStatus, "insufficient");
    assert.equal(outcome.response.status, "cautious");
    assert.equal(outcome.escalate, false);
    assert.ok(outcome.response.answer.includes("사용하면 안 돼요"));
    assert.equal(outcome.response.answer.includes("요청 범위 전체를 확인하지 못했습니다"), false);
    assert.equal(events.findLast(event => event.stage === "support_validation")?.directCount, 2);
    assert.equal(events.at(-1)?.reason, "SUPPORTED_ANSWER");
  });

  test("state qualifier negatives and additional requirements cannot inherit expired-use permission", async () => {
    const scenarios = [
      { question: "유통기한 지난 시럽 써도 돼?", target: "유통기한 지난 시럽", sourceTarget: "유통기한이 지나지 않은 시럽" },
      { question: "유통기한 지난 시럽 써도 돼?", target: "유통기한 지난 시럽", sourceTarget: "상태 불확실한 시럽" },
      { question: "유통기한 지난 시럽 써도 돼?", target: "유통기한 지난 시럽", sourceTarget: "개봉한 시럽" },
      { question: "유통기한 지난 시럽 써도 돼?", target: "유통기한 지난 시럽", sourceTarget: "유통기한 지난 소스" },
      { question: "유통기한이 지나지 않은 시럽 써도 돼?", target: "시럽", sourceTarget: "시럽" },
      { question: "상태가 불확실한 시럽 써도 돼?", target: "시럽", sourceTarget: "시럽" },
      { question: "유통기한 지난 시럽 써도 돼?", target: "유통기한 지난 시럽", sourceTarget: "유통기한 지난 시럽", extra: "단, 승인받은 경우는 예외다." },
      { question: "유통기한 지난 시럽 써도 돼?", target: "유통기한 지난 시럽", sourceTarget: "유통기한 지난 시럽", extra: "유통기한 지난 시럽은 사용해도 된다." },
      ...["온도 조건", "보관 기간", "작업 절차"].map(requirement => ({ question: `유통기한 지난 시럽 써도 돼? ${requirement}도 알려줘`,
        target: "유통기한 지난 시럽", sourceTarget: "유통기한 지난 시럽" })),
    ];
    for (const scenario of scenarios) {
      const quote = "유통기한이 지난 시럽은 사용하지 않는다.";
      const content = `${quote}\n대상 표기: ${scenario.sourceTarget}\n${scenario.extra ?? ""}`;
      const kinds = requestedSupportKinds(scenario.question);
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: scenario.question, requireCoverage: true,
        requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async () => [chunk("qualifier-negative", { content })],
        generate: async () => JSON.stringify({ answerable: true, answer: quote, coverage: "partial", usedChunkIds: ["qualifier-negative"],
          supportAssessment: { requestedTarget: scenario.target, requirements: kinds.map(kind => kind === "permission"
            ? { kind, support: "direct", evidence: [{ chunkId: "qualifier-negative", quote, role: "permission", target: scenario.sourceTarget, targetRelation: "covers_requested" }] }
            : { kind, support: "missing", evidence: [] }) } }),
      }));
      assert.equal(outcome.response.status, "insufficient", scenario.question);
      assert.equal(outcome.response.answer.includes("이 상태로 사용하면 안 돼요"), false);
    }
  });

  test("validated state prohibition remains direct across model support and evidence-role allocations", async () => {
    for (const allocatedKind of ["permission", "conditions"] as const) for (const role of ["permission", "conditions", "referral_policy"] as const)
      for (const declaredSupport of ["direct", "policy_only"] as const) {
        const quote = "유통기한이 지난 식재료는 사용하지 않는다.";
        const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "유통기한 지난 우유 써도 돼?",
          requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
          search: async () => [chunk("metadata-allocation", { content: quote })],
          generate: async () => JSON.stringify({ answerable: true, answer: "사용 가능한지 모릅니다", coverage: "policy_only", usedChunkIds: ["metadata-allocation"],
            supportAssessment: { requestedTarget: "우유", requirements: ["permission", "conditions"].map(kind => ({ kind,
              support: kind === allocatedKind ? declaredSupport : "missing", evidence: kind === allocatedKind ? [
                { chunkId: "metadata-allocation", quote, role, target: "식재료", targetRelation: "covers_requested" },
              ] : [] })) } }),
        }));
        assert.equal(outcome.response.status, "answered", `${allocatedKind}/${role}/${declaredSupport}`);
        assert.equal(outcome.escalate, false);
        assert.ok(outcome.response.answer.includes("사용하면 안 돼요"));
      }
  });

  test("uncertain-state referral remains a referral while same-state exceptions and conflicting permissions block promotion", async () => {
    const question = "식재료의 상태가 확실하지 않은 경우 누구에게 확인하나요?";
    const quote = "식재료의 상태가 확실하지 않은 경우 사장님에게 확인한다.";
    const referral = expectResolved(await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
      search: async () => [chunk("uncertain-inquiry", { content: quote })],
      generate: async () => JSON.stringify({ answerable: true, answer: "상태가 불확실하면 사장님에게 확인하세요.", coverage: "direct", usedChunkIds: ["uncertain-inquiry"],
        supportAssessment: { requestedTarget: "식재료", requirements: [{ kind: "referral", support: "direct", evidence: [
          { chunkId: "uncertain-inquiry", quote, role: "referral_policy", target: "식재료", targetRelation: "same" },
        ] }] } }),
    }));
    assert.equal(referral.response.status, "answered");
    assert.ok(referral.response.answer.includes("사장님에게 확인"));
    assert.equal(referral.response.answer.includes("사용하면 안 돼요"), false);
    for (const context of ["단, 유통기한 지난 식재료도 승인받은 경우 예외다.", "유통기한 지난 식재료는 사용해도 된다."]) {
      const prohibition = "유통기한 지난 식재료는 사용하지 않는다.";
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "유통기한 지난 우유 써도 돼?", requireCoverage: true,
        requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async () => [chunk("exception-contract", { content: `${prohibition}\n${context}` })],
        generate: async () => JSON.stringify({ answerable: true, answer: "무조건 금지", coverage: "direct", usedChunkIds: ["exception-contract"],
          supportAssessment: { requestedTarget: "우유", requirements: [
            { kind: "permission", support: "missing", evidence: [] },
            { kind: "conditions", support: "direct", evidence: [{ chunkId: "exception-contract", quote: prohibition, role: "conditions", target: "식재료", targetRelation: "covers_requested" }] },
          ] } }),
      }));
      assert.equal(outcome.response.status, "insufficient");
      assert.equal(outcome.response.answer.includes("무조건 금지"), false);
    }
  });

  test("standalone uncertain-state referral does not erase an explicit expiry prohibition while use exceptions still block", async () => {
    for (const advisory of [
      "식재료의 상태가 확실하지 않은 경우 직원이 임의로 판단하지 않고 사장님에게 확인한다.",
      "재료의 상태가 확실하지 않은 경우 관리자에게 문의한다.",
      "식재료의 상태가 확실하지 않은 경우 사용을 허용하며 관리자에게 확인한다.",
      "식재료의 상태가 확실하지 않은 경우 예외로 처리하고 관리자에게 확인한다.",
    ]) {
      const quote = "유통기한이 지난 식재료는 사용하지 않는다.";
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "유통기한 지난 우유 써도 돼?",
        requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async () => [chunk("uncertain-referral", { content: `${quote}\n${advisory}`, raw_similarity_score: .270154763720169, keyword_boost: .2 })],
        generate: async () => JSON.stringify({ answerable: true, answer: "미검증 모델 안내", coverage: "partial", usedChunkIds: ["uncertain-referral"],
          supportAssessment: { requestedTarget: "우유", requirements: [
            { kind: "permission", support: "direct", evidence: [{ chunkId: "uncertain-referral", quote, role: "permission", target: "식재료", targetRelation: "covers_requested" }] },
            { kind: "conditions", support: "missing", evidence: [] },
          ] } }),
      }));
      const blocked = /허용|예외/u.test(advisory);
      assert.equal(outcome.response.status, blocked ? "insufficient" : "cautious", advisory);
      if (!blocked) assert.ok(outcome.response.answer.includes("사용하면 안 돼요"));
    }
  });

  test("explicit heading-list items and table rows link their own target state and prohibition only", async () => {
    const formats = [
      { content: "### 유통기한 지난 우유\n- 사용하지 않는다.", supported: true },
      { content: "1. 유통기한 지난 우유\n  - 사용하지 않는다.", supported: true },
      { content: "3-4. 유통기한 지난 우유\n  - 사용하지 않는다.", supported: true },
      { content: "| 품목 | 상태 | 조치 |\n| --- | --- | --- |\n| 우유 | 유통기한 지난 | 사용하지 않는다. |", supported: true },
      { content: "### 유통기한 지난 우유\n- 상태 확인\n### 개봉한 시럽\n- 사용하지 않는다.", supported: false },
      { content: "1. 유통기한 지난 우유\n2. 시럽은 사용하지 않는다.", supported: false },
      { content: "유통기한 지난 우유\n사용하지 않는다.", supported: false },
      { content: "| 품목 | 상태 | 조치 |\n| --- | --- | --- |\n| 우유 | 유통기한 지난 | 확인한다 |\n| 시럽 | 개봉한 | 사용하지 않는다. |", supported: false },
      { content: "| 품목 | 상태 | 조치 |\n| --- | --- | --- |\n| 시럽 | 유통기한 지난 | 사용하지 않는다. |", supported: false },
      { content: "### 유통기한 지난 우유\n- 사용하지 않는다.\n- 단, 승인된 경우 예외", supported: false },
      { content: "### 유통기한 지나지 않은 우유\n- 사용하지 않는다.", supported: false },
      { content: "### 유통기한 지난 우유\n- 시럽은 사용하지 않는다.", supported: false },
      { content: "| 품목 | 상태 | 조치 |\n| --- | --- | --- |\n| 우유 | 유통기한 지난 | 사용하지 않는 것은 아니다. |", supported: false },
      { content: "품목 상태 조치\n우유 유통기한 지난 사용하지 않는다", supported: false },
      { content: "| 우유 | 유통기한 지난 | 사용하지 않는다. |", supported: false },
      { content: "- 사용하지 않는다.\n### 유통기한 지난 우유", supported: false },
    ];
    for (const original of formats) for (const normalized of [false, true]) {
      const chunks = chunkManualText(original.content);
      assert.equal(chunks.length, 1);
      const fixture = { ...original, content: normalized ? chunks[0] : original.content };
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "유통기한 지난 우유 써도 돼?",
        requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async () => [chunk("structured-policy", { content: fixture.content })],
        generate: async () => JSON.stringify({ answerable: true, answer: "미검증 모델 안내", coverage: "partial", usedChunkIds: ["structured-policy"],
          supportAssessment: { requestedTarget: "우유", requirements: [
            { kind: "permission", support: "direct", evidence: [{ chunkId: "structured-policy", quote: fixture.content, role: "permission",
              target: fixture.content.includes("우유") ? "우유" : "시럽", targetRelation: fixture.content.includes("우유") ? "same" : "covers_requested" }] },
            { kind: "conditions", support: "missing", evidence: [] },
          ] } }),
      }));
      assert.equal(outcome.response.status, fixture.supported ? "answered" : "insufficient", fixture.content);
      if (fixture.supported) {
        assert.ok(outcome.response.answer.includes("사용하면 안 돼요"));
        assert.ok(outcome.response.answer.includes(fixture.content));
      }
    }
  });

  test("approved HQ disassembly prohibition and generic cleaning timing do not supply internal procedure or timing", async () => {
    const question = "커피머신 내부 분해 세척 순서 알려줘. 그리고 언제 해야 하는지도 알려줘";
    const prohibition = "- 세척 과정에서 장비 내부를 임의로 분해하지 않는다.";
    const genericTiming = "- 커피머신 : 사용 및 마감 후 등록된 세척 기준을 따른다.";
    for (const includeGenericTiming of [false, true]) {
      const sources = [chunk("approved-disassembly-excerpt", { title: "장비 세척 및 관리", content: prohibition }),
        ...(includeGenericTiming ? [chunk("approved-generic-timing-excerpt", { title: "장비 세척 및 관리", content: genericTiming })] : [])];
      const events: Record<string, unknown>[] = [];
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question, requireCoverage: true,
        requireSupportAssessment: true, requireEvidenceScope: true }, {
        interpret: async () => ({ target: "커피머신 내부 분해 세척", contextTarget: null, constraints: ["내부 분해 세척"], requirements: ["procedure", "timing"], clarification: false }),
        search: async query => { assert.ok(query.includes("내부 분해 세척")); return sources; },
        generate: async (_query, provided, _variant, interpretation) => {
          assert.deepEqual(interpretation?.requirements, ["procedure", "timing"]);
          return JSON.stringify({ answerable: true, answer: "분해 후 10분 세척하세요.", coverage: "direct", usedChunkIds: provided.map(item => item.chunk_id),
            supportAssessment: { requestedTarget: "커피머신 내부 분해 세척", requirements: [
              { kind: "procedure", support: "direct", evidence: [{ chunkId: sources[0].chunk_id, quote: prohibition, role: "permission", target: "장비 내부", targetRelation: "covers_requested" }] },
              includeGenericTiming ? { kind: "timing", support: "direct", evidence: [{ chunkId: sources[1].chunk_id, quote: genericTiming, role: "timing", target: "커피머신", targetRelation: "subset" }] }
                : { kind: "timing", support: "missing", evidence: [] },
            ] } });
        },
        onDiagnostic: event => events.push(event),
      }));
      assert.equal(outcome.response.status, "insufficient");
      assert.equal(outcome.escalate, true);
      assert.ok(outcome.response.answer.includes(question));
      assert.ok(outcome.response.answer.includes(prohibition));
      assert.ok(outcome.response.answer.includes("구체적인 작업 절차 및 적용 시점에 대한 요청 범위 전체를 확인하지 못했습니다"));
      assert.equal(outcome.response.answer.includes("분해 후 10분"), false);
      assert.equal(events.findLast(event => event.stage === "support_validation")?.directCount, 0);
      assert.equal(events.at(-1)?.reason, includeGenericTiming ? "PARTIAL_SUPPORT_COVERAGE" : "POLICY_ONLY_COVERAGE");
    }
  });

  test("coffee failure projection shape rejects invalid same and reviewed policy metadata stays insufficient", async () => {
    const question = "커피머신 내부 분해 세척 순서 알려줘. 그리고 언제 해야 하는지도 알려줘";
    const report = "장비의 세척 기준은 관리자에게 확인한다.";
    const prohibition = "장비 내부는 임의로 분해하지 않는다.";
    for (const reviewed of [false, true]) {
      const events: Record<string, unknown>[] = [];
      const outcome = await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
        interpret: async () => ({ target: "커피머신 내부 분해 세척", contextTarget: null, constraints: [], requirements: ["procedure", "timing"], clarification: false }),
        search: async () => [chunk("synthetic-coffee-report", { content: report }), chunk("synthetic-coffee-prohibition", { content: prohibition })],
        generate: async () => JSON.stringify({ answerable: true, answer: "synthetic procedure assertion", coverage: "policy_only", usedChunkIds: ["synthetic-coffee-report", "synthetic-coffee-prohibition"],
          supportAssessment: { requestedTarget: "커피머신 내부 분해 세척", requirements: [
            { kind: "procedure", support: "policy_only", evidence: [
              { chunkId: "synthetic-coffee-report", quote: report, role: reviewed ? "referral_policy" : "procedure", target: "장비", targetRelation: reviewed ? "covers_requested" : "same" },
              { chunkId: "synthetic-coffee-prohibition", quote: prohibition, role: "permission", target: "장비 내부", targetRelation: reviewed ? "covers_requested" : "same" },
            ] },
            { kind: "timing", support: "missing", evidence: [] },
          ] } }), onDiagnostic: event => events.push(event),
      });
      if (!reviewed) {
        assert.deepEqual(outcome, { kind: "system_error", code: "GENERATION_UNPARSABLE" });
        assert.equal(events.find(event => event.stage === "support_validation")?.fieldPath, "supportAssessment.requirements[0].evidence[0].targetRelation");
      } else {
        const resolved = expectResolved(outcome);
        assert.equal(resolved.response.status, "insufficient");
        assert.ok(resolved.response.answer.includes(prohibition));
        assert.ok(resolved.response.answer.includes("구체적인 작업 절차 및 적용 시점"));
        assert.equal(resolved.response.answer.includes("synthetic procedure assertion"), false);
        assert.equal(events.at(-1)?.reason, "POLICY_ONLY_COVERAGE");
      }
    }
  });

  test("equipment operation-heading is not a work entity; reviewed generic policy does not answer the internal procedure", async () => {
    const question = "커피머신 내부 분해 세척 순서 알려줘. 그리고 언제 해야 하는지도 알려줘";
    const quote = "기기는 등록된 청소 기준을 따른다.";
    for (const reviewed of [false, true]) {
      const events: Record<string, unknown>[] = [];
      const outcome = await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
        interpret: async () => ({ target: "커피머신 내부 분해 세척", contextTarget: null, constraints: [], requirements: ["procedure", "timing"], clarification: false }),
        search: async () => [chunk("synthetic-operation-scope", { content: `폐점 업무\n${quote}` })],
        generate: async () => JSON.stringify({ answerable: true, answer: "synthetic scope assertion", coverage: "policy_only", usedChunkIds: ["synthetic-operation-scope"],
          supportAssessment: { requestedTarget: reviewed ? "커피머신" : "커피머신 내부 분해 세척", requirements: [
            { kind: "procedure", support: "policy_only", evidence: [{ chunkId: "synthetic-operation-scope", quote,
              role: reviewed ? "referral_policy" : "procedure", target: reviewed ? "기기" : "폐점", targetRelation: reviewed ? "covers_requested" : "same" }] },
            { kind: "timing", support: "missing", evidence: [] },
          ] } }), onDiagnostic: event => events.push(event),
      });
      if (!reviewed) {
        assert.deepEqual(outcome, { kind: "system_error", code: "GENERATION_UNPARSABLE" });
        assert.equal(events.find(event => event.stage === "support_validation")?.validationKind, "target_relation_mismatch");
      } else {
        const resolved = expectResolved(outcome);
        assert.equal(resolved.response.status, "insufficient");
        assert.ok(resolved.response.answer.includes("구체적인 작업 절차 및 적용 시점"));
        assert.equal(events.findLast(event => event.stage === "support_validation")?.directCount, 0);
      }
    }
  });

  test("coffee internal-work targets preserve policy shortage without the expiry-identity projection", async () => {
    const question = "커피머신 내부 분해 세척 순서 알려줘. 그리고 언제 해야 하는지도 알려줘";
    const quote = "커피머신 내부는 임의로 분해하지 않는다.";
    for (const target of ["커피머신", "커피머신 내부 분해 세척"]) for (const relation of ["covers_requested", "same"] as const) {
      const events: Record<string, unknown>[] = [];
      const outcome = await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
        interpret: async () => ({ target, contextTarget: null, constraints: ["내부 분해 세척"], requirements: ["procedure", "timing"], clarification: false }),
        search: async () => [chunk("coffee-target-identity", { content: quote })],
        generate: async () => JSON.stringify({ answerable: true, answer: "synthetic internal procedure", coverage: "policy_only", usedChunkIds: ["coffee-target-identity"],
          supportAssessment: { requestedTarget: target, requirements: [
            { kind: "procedure", support: "policy_only", evidence: [{ chunkId: "coffee-target-identity", quote, role: "permission", target: "커피머신", targetRelation: relation }] },
            { kind: "timing", support: "missing", evidence: [] },
          ] } }), onDiagnostic: event => events.push(event),
      });
      if (target !== "커피머신" && relation === "same") {
        assert.deepEqual(outcome, { kind: "system_error", code: "GENERATION_UNPARSABLE" });
        assert.equal(events.find(event => event.stage === "support_validation")?.validationKind, "target_relation_mismatch");
      } else {
        const resolved = expectResolved(outcome);
        assert.equal(resolved.response.status, "insufficient");
        assert.ok(resolved.response.answer.includes(quote));
        assert.ok(resolved.response.answer.includes("구체적인 작업 절차 및 적용 시점"));
        assert.equal(events.findLast(event => event.stage === "support_validation")?.directCount, 0);
        assert.equal(resolved.response.answer.includes("synthetic internal procedure"), false);
      }
    }
  });

  test("explicit B duration and location intent override prior A location; absent opened evidence stays insufficient", async () => {
    const previous = { userId: "staff", storeId: "store", conversation: { userId: "staff", storeId: "store",
      messages: [{ role: "user" as const, content: "우유 어디 둬?" }] } };
    for (const scenario of [
      { question: "개봉한 우유는 얼마나 보관해?", expected: ["conditions" as const, "duration" as const] },
      { question: "개봉한 우유도 같은 곳에 둬?", expected: ["location" as const, "conditions" as const] },
    ]) {
      let searches = 0;
      let generations = 0;
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: scenario.question, requireCoverage: true,
        requireSupportAssessment: true, requireEvidenceScope: true, interpretationContext: previous }, {
        interpret: async () => ({ target: "", contextTarget: "우유", constraints: ["개봉한"],
          requirements: ["location"], clarification: false }),
        search: async value => {
          searches++;
          assert.ok(value.includes("확인된 현재 질문 조건: 개봉한"));
          return [chunk(`previous-location-${searches}`, { content: "우유: 냉장고 오른쪽 선반", raw_similarity_score: .8 })];
        },
        generate: async (_question, _chunks, _variant, interpretation) => {
          generations++;
          assert.deepEqual(interpretation?.requirements, scenario.expected);
          assert.deepEqual(requestedSupportKinds(scenario.question), scenario.expected);
          return JSON.stringify({ answerable: false, answer: "", coverage: "policy_only", usedChunkIds: [], supportAssessment: null });
        },
      }));
      assert.equal(outcome.response.status, "insufficient");
      assert.equal(/\d+\s*(?:일|시간|℃)/u.test(outcome.response.answer), false);
      assert.equal(searches, 1);
      assert.equal(generations, 1);
    }
  });

  test("ambiguous B follow-up clarifies without inheriting location intent or invoking interpretation/search/generation", async () => {
    let interpretationCalls = 0;
    let searchCalls = 0;
    let generationCalls = 0;
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "그럼 개봉한 건?",
      interpretationContext: { userId: "staff", storeId: "store", conversation: { userId: "staff", storeId: "store",
        messages: [{ role: "user", content: "우유 어디 둬?" }] } } }, {
      interpret: async () => { interpretationCalls++; return { target: "", contextTarget: "우유", constraints: ["개봉한"], requirements: ["location" as const], clarification: false }; },
      search: async () => { searchCalls++; return []; },
      generate: async () => { generationCalls++; return ""; },
    }));
    assert.equal(interpretationCalls, 0);
    assert.equal(searchCalls, 0);
    assert.equal(generationCalls, 0);
    assert.equal(outcome.response.status, "insufficient");
    assert.equal(outcome.escalate, false);
    assert.match(outcome.response.answer, /위치.*관리 방법/u);
    assert.equal(/\d+\s*(?:일|시간|℃)/u.test(outcome.response.answer), false);
  });

  test("post-opening period follow-up uses only bounded user-grounded context", () => {
    const question = "개봉 후 보관 기간이 궁금해";
    assert.equal(shouldInterpretQuestion(question), true);
    const interpreted = { target: "", contextTarget: "우유", constraints: ["개봉 후"], requirements: ["conditions", "duration"], clarification: false };
    const context = { userId: "staff", storeId: "store", messages: [
      { role: "user" as const, content: "우유 어디 둬?" },
      { role: "assistant" as const, content: "확인 답변" },
      { role: "user" as const, content: "그럼 개봉한 건?" },
      { role: "assistant" as const, content: "위치인지 관리 방법인지 확인해 주세요." },
    ] };
    const owned = boundedQuestionContext(context, "staff", "store");
    assert.deepEqual(parseQuestionInterpretation(JSON.stringify(interpreted), question, owned).requirements, ["conditions", "duration"]);
    const advanced = boundedQuestionContext({ ...context, messages: [...context.messages,
      { role: "user", content: "그럼 개봉한 건?" }, { role: "assistant", content: "기간인지 방법인지 확인해 주세요." }] }, "staff", "store");
    assert.equal(advanced.length, 4);
    for (const messages of [boundedQuestionContext(context, "other", "store"), boundedQuestionContext(context, "staff", "other"), advanced]) {
      assert.throws(() => parseQuestionInterpretation(JSON.stringify(interpreted), question, messages), StructuredAnswerParseError);
      assert.equal(parseQuestionInterpretation(JSON.stringify({ ...interpreted, contextTarget: null, clarification: true }), question, messages).clarification, true);
    }
  });

  test("B ambiguous intent diagnostic preserves its rule and excludes private fields", () => {
    const events: Record<string, unknown>[] = [];
    const trace = createRagDiagnosticTrace({ enabled: true, conversationId: null, storeId: null, emit: event => events.push(event) });
    trace({ stage: "interpretation_validation", validation: "rejected", failureLayer: "question_interpretation",
      fieldPath: "interpretation.clarification", validationKind: "ambiguous_current_intent",
      question: "private-question", target: "private-target" });
    assert.equal(events[0].validationKind, "ambiguous_current_intent");
    assert.equal(events[0].fieldPath, "interpretation.clarification");
    assert.equal("question" in events[0], false);
    assert.equal("target" in events[0], false);
  });

  test("B interpretation separates current condition and owned context target with safe field-specific failures", async () => {
    const question = "그럼 개봉한 건 어떻게 해?";
    const messages = [{ role: "user" as const, content: "우유 어디 둬?" }, { role: "assistant" as const, content: "우유는 오른쪽 선반에 둬요." }];
    const valid = { target: "", contextTarget: "우유", requirements: ["conditions", "method"], constraints: ["개봉한"], clarification: false };
    const interpretationInstructions = buildQuestionInterpretationRequest(question, messages).messages[0].content;
    assert.ok(interpretationInstructions.includes("이전 질문의 요구 kind나 작업 의도는 이어받지 않는다"));
    assert.ok(interpretationInstructions.includes("현재 질문에 명시 intent가 없으면 clarification=true"));
    assert.deepEqual(parseQuestionInterpretation(JSON.stringify(valid), question, messages), valid);
    const invalid = [
      { value: { ...valid, target: "우유" }, path: "interpretation.target", kind: "question_target_mismatch" },
      { value: { ...valid, contextTarget: "치즈" }, path: "interpretation.contextTarget", kind: "context_target_mismatch" },
      { value: { ...valid, constraints: ["개봉 후 2일"] }, path: "interpretation.constraints[0]", kind: "constraint_anchor_mismatch" },
      { value: { ...valid, requirements: ["method", "method"] }, path: "interpretation.requirements", kind: "duplicate_requirement" },
    ];
    for (const scenario of invalid) {
      assert.throws(() => parseQuestionInterpretation(JSON.stringify(scenario.value), question, messages), error => error instanceof StructuredAnswerParseError
        && error.fieldPath === scenario.path && error.validationKind === scenario.kind && !error.message.includes("우유"));
    }
    assert.throws(() => parseQuestionInterpretation(JSON.stringify(valid), question, []), error => error instanceof StructuredAnswerParseError
      && error.fieldPath === "interpretation.contextTarget" && error.validationKind === "context_target_mismatch");
    assert.deepEqual(parseQuestionInterpretation(JSON.stringify({ ...valid, contextTarget: null, clarification: true }), question, []),
      { ...valid, contextTarget: null, clarification: true });
    const location = parseQuestionInterpretation(JSON.stringify({ ...valid, requirements: ["method"] }),
      "그럼 개봉한 우유도 같은 곳에 둬?", messages);
    assert.deepEqual(location.requirements, ["location", "conditions"]);
    const duration = parseQuestionInterpretation(JSON.stringify({ ...valid, requirements: ["location"] }),
      "개봉한 우유는 얼마나 보관해?", messages);
    assert.deepEqual(duration.requirements, ["conditions", "duration"]);
    const method = parseQuestionInterpretation(JSON.stringify({ ...valid, requirements: ["location"] }),
      "개봉한 우유는 어떻게 관리해?", messages);
    assert.deepEqual(method.requirements, ["conditions", "method"]);
    assert.throws(() => parseQuestionInterpretation(JSON.stringify({ ...valid, requirements: ["location"] }),
      "그럼 개봉한 건?", messages), error => error instanceof StructuredAnswerParseError
        && error.fieldPath === "interpretation.clarification" && error.validationKind === "ambiguous_current_intent");
    assert.equal(parseQuestionInterpretation(JSON.stringify({ ...valid, requirements: ["location"], clarification: true }),
      "그럼 개봉한 건?", messages).clarification, true);
  });

  test("explicit Korean iced cafe latte keeps the HQ recipe instead of excluding it as another menu", async () => {
    const question = "아이스 카페라떼 만들 때 우유 몇 ml 넣어?";
    const recipe = chunk("iced-cafe", { title: "본사 음료 제조", content: "ICE 카페라떼\n우유 240ml", raw_similarity_score: .75 });
    const selection = selectMenuCandidates(question, [recipe]);
    assert.equal(selection.matches.length, 1);
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, deps({
      results: [recipe], generation: JSON.stringify({ answerable: true, answer: "ICE 카페라떼에는 우유 240ml를 넣어요.", coverage: "direct", usedChunkIds: [recipe.chunk_id],
        supportAssessment: { requestedTarget: "카페라떼", requirements: [{ kind: "facts", support: "direct", evidence: [
          { chunkId: recipe.chunk_id, quote: recipe.content, role: "facts", target: "카페라떼", targetRelation: "same" },
        ] }] } }),
    })));
    assert.equal(outcome.response.status, "answered");
    assert.ok(outcome.response.answer.includes("240ml"));
  });

  test("synthetic dairy support preserves partial scope and rejects counterfactual false same", async () => {
    const fixture = JSON.parse(readFileSync(new URL("./synthetic-support-cases.json", import.meta.url), "utf8")).dairySupport;
    const sources = fixture.sources as { id: string; raw: number; boost: number; target: string; quote: string; role: string; relation: string }[];
    const matches = sources.map(source => chunk(source.id, { content: source.quote, raw_similarity_score: source.raw, keyword_boost: source.boost }));
    const generation = (falseSame: boolean) => JSON.stringify({ answerable: true, answer: sources.map(source => source.quote).join("\n"),
      coverage: fixture.coverage, usedChunkIds: sources.map(source => source.id), supportAssessment: {
        requestedTarget: fixture.requestedTarget, requirements: [{ kind: "method", support: "direct", evidence: sources.map((source, index) => ({
          chunkId: source.id, quote: source.quote, target: source.target, role: source.role,
          targetRelation: falseSame && index === 0 ? "same" : source.relation,
        })) }],
      } });
    const input = { ...INPUT, question: fixture.question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true };
    const resolved = expectResolved(await resolveRagAnswer(input, deps({ results: matches, generation: generation(false) })));
    assert.equal(resolved.response.status, fixture.expectedStatus);
    assert.ok(Math.abs(resolved.response.similarity! - fixture.expectedEvidenceScore) < 1e-12);
    assert.equal(resolved.response.sources?.length, 2);
    assert.ok(resolved.response.answer.includes("요청 범위 전체를 확인하지 못했습니다"));
    assert.ok(resolved.response.answer.includes("질문의 대상 범위 전체에 적용할 수 없습니다"));
    assert.equal(/\d+\s*(?:℃|일|시간)/u.test(resolved.response.answer), false);
    assert.deepEqual(await resolveRagAnswer(input, deps({ results: matches, generation: generation(true) })), {
      kind: "system_error", code: "GENERATION_UNPARSABLE",
    });
  });

  test("friendly answer paraphrases preserve strict verbatim citations, quantities and prohibitions", async () => {
    const cases = [
      { question: "우유는 어디에 두나요?", target: "우유", kind: "location", quote: "우유는 냉장고 오른쪽 선반에 보관한다.", answer: "우유는 냉장고 오른쪽 선반에 보관해요." },
      { question: "음료 수량은?", target: "음료", kind: "facts", quote: "음료 300ml 3개를 준비한다.", answer: "음료는 300ml로 3개 준비해요." },
      { question: "장비 분해해도 되나요?", target: "장비", kind: "permission", quote: "장비를 임의로 분해하지 않는다.", answer: "장비는 임의로 분해하면 안 돼요." },
    ];
    for (const scenario of cases) {
      const generation = JSON.stringify({ answerable: true, answer: scenario.answer, coverage: "direct", usedChunkIds: ["friendly"],
        supportAssessment: { requestedTarget: scenario.target, requirements: [{ kind: scenario.kind, support: "direct", evidence: [
          { chunkId: "friendly", quote: scenario.quote, role: scenario.kind, target: scenario.target, targetRelation: "same" },
        ] }] } });
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: scenario.question,
        requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, deps({
        results: [chunk("friendly", { content: scenario.quote })], generation,
      })));
      assert.equal(outcome.response.answer, scenario.answer);
      assert.equal(outcome.response.status, "answered");
      assert.equal(outcome.response.source?.manualId, "manual-friendly");
      assert.equal(outcome.response.answer.includes("관련도"), false);
      const invalid = JSON.parse(generation);
      invalid.supportAssessment.requirements[0].evidence[0].quote = scenario.answer;
      assert.deepEqual(await resolveRagAnswer({ ...INPUT, question: scenario.question,
        requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, deps({
        results: [chunk("friendly", { content: scenario.quote })], generation: JSON.stringify(invalid),
      })), { kind: "system_error", code: "GENERATION_UNPARSABLE" });
    }
  });

  test("one-shot dairy reproduction collects private target evidence before mismatch without leaking or changing the outcome", async () => {
    const question = "유제품은 어떻게 보관해야 하나요?";
    const source = chunk("one-shot", { content: "우유: 냉장고 선반" });
    let searches = 0;
    let generations = 0;
    const reviews: { requestedTarget: string | undefined; evidence: { target: string | undefined; targetRelation: string | undefined; provided: boolean; quotePresent: boolean }[] }[] = [];
    const events: Record<string, unknown>[] = [];
    const dependencies = {
      search: async () => { searches++; return [source]; },
      generate: async () => { generations++; return JSON.stringify({ answerable: true, answer: "선반", coverage: "partial", usedChunkIds: [source.chunk_id],
        supportAssessment: { requestedTarget: "유제품", requirements: [{ kind: "method", support: "direct", evidence: [
          { chunkId: source.chunk_id, quote: source.content, role: "location", target: "우유", targetRelation: "same" },
        ] }] } }); },
      onPrivateEvidenceReview: (review: typeof reviews[number]) => { reviews.push(review); },
      onDiagnostic: (event: { stage: string; [key: string]: unknown }) => { events.push(event); },
    };
    const input = { ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true };
    const outcome = await resolveRagAnswer(input, dependencies);
    assert.deepEqual(outcome, { kind: "system_error", code: "GENERATION_UNPARSABLE" });
    assert.equal(searches, 1); assert.equal(generations, 1);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].requestedTarget, "유제품");
    assert.equal(reviews[0].evidence[0].target, "우유");
    assert.equal(reviews[0].evidence[0].targetRelation, "same");
    assert.equal(reviews[0].evidence[0].provided, true);
    assert.equal(reviews[0].evidence[0].quotePresent, true);
    assert.equal(JSON.stringify(events).includes(source.content), false);
    const withoutReview = await resolveRagAnswer(input, { ...dependencies, onPrivateEvidenceReview: () => { throw new Error("private capture failed"); } });
    assert.deepEqual(withoutReview, outcome);
  });

  test("general interpretation is mock opt-in, preserves location shortcuts and sends AI requirements to generation", async () => {
    for (const question of ["유제품 보관법", "마감 준비 순서를 알려줘"]) {
      const target = question.includes("유제품") ? "유제품" : "마감";
      const kinds = question.includes("유제품") ? ["method" as const] : ["procedure" as const];
      const content = question.includes("유제품") ? `${target} 기준은 담당자에게 확인한다.` : "마감 준비는 재고 확인 후 청소하고 전원을 점검한다.";
      let calls = 0;
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question, interpretationMode: "general",
        requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
        interpret: async () => { calls++; return { target, contextTarget: null, requirements: kinds, constraints: [], clarification: false }; },
        search: async raw => { assert.equal(raw, question); return [chunk("general", { content })]; },
        generate: async (_question, _chunks, _variant, interpretation) => {
          assert.deepEqual(interpretation?.requirements, kinds);
          if (question.includes("유제품")) return JSON.stringify({ answerable: false, answer: "", usedChunkIds: [], coverage: "policy_only", supportAssessment: null });
          assert.deepEqual(requestedSupportKinds(question), ["procedure"]);
          return JSON.stringify({ answerable: true, answer: content, usedChunkIds: ["general"], coverage: "direct",
            supportAssessment: { requestedTarget: target, requirements: [{ kind: "procedure", support: "direct", evidence: [
              { chunkId: "general", quote: content, role: "procedure", target, targetRelation: "same" },
            ] }] } });
        },
      }));
      assert.equal(calls, 1); assert.equal(outcome.response.status, question.includes("유제품") ? "insufficient" : "answered");
    }
    const location = expectResolved(await resolveRagAnswer({ ...INPUT, question: "우유 어디 둬?", interpretationMode: "general",
      requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
      interpret: async () => { assert.fail("exact location must not interpret"); },
      search: async () => [chunk("location-general", { title: "보관 위치", content: "우유: 냉장고 선반" })],
      generate: async () => { assert.fail("exact location must not generate"); },
    }));
    assert.equal(location.response.status, "answered");
    const menu = expectResolved(await resolveRagAnswer({ ...INPUT, question: "라떼 우유 얼마나 넣어?", interpretationMode: "general" }, {
      interpret: async () => { assert.fail("menu clarification must not interpret"); },
      search: async () => [chunk("menu-general", { title: "음료 제조", content: "ICE 카페라떼 우유 240ml" })],
      generate: async () => { assert.fail("menu clarification must not generate"); },
    }));
    assert.ok(menu.response.answer.includes("어떤 라떼"));
    const unclear = expectResolved(await resolveRagAnswer({ ...INPUT, question: "이거 써도 됨?", interpretationMode: "general" }, {
      interpret: async () => { assert.fail("no context must clarify"); }, search: async () => { assert.fail(); }, generate: async () => { assert.fail(); },
    }));
    assert.equal(unclear.escalate, false);
  });

  test("dairy A-D comparison preserves spelling, subset and general partial principles without accepting false same", async () => {
    const scenarios = [
      { id: "A", question: "우유는 어디에 두나요?", requested: "우유는", target: "우유", quote: "우유: 냉장고 선반",
        kind: "location", role: "location", relation: "same", coverage: "direct", status: "answered" },
      { id: "B", question: "유제품은 어떻게 보관해야 하나요?", requested: "유제품", target: "우유", quote: "우유: 냉장고 선반",
        kind: "method", role: "location", relation: "subset", coverage: "partial", status: "insufficient" },
      { id: "C", question: "유제품은 어떻게 보관해야 하나요?", requested: "유제품", target: "식재료",
        quote: "식재료 상태와 유통기한을 확인하고 정해진 보관 기준을 준수한다. 미등록 보관법은 담당자에게 확인한다.",
        kind: "method", role: "method", relation: "covers_requested", coverage: "partial", status: "insufficient" },
      { id: "D", question: "유제품은 어떻게 보관해야 하나요?", requested: "유제품", target: "우유", quote: "우유: 냉장고 선반",
        kind: "method", role: "location", relation: "same", coverage: "partial", status: "system_error" },
    ];
    for (const scenario of scenarios) {
      const outcome = await resolveRagAnswer({ ...INPUT, question: scenario.question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, deps({
        results: [chunk(`dairy-${scenario.id}`, { content: scenario.quote, raw_similarity_score: .8 })], generation: JSON.stringify({
          answerable: true, answer: scenario.quote, coverage: scenario.coverage, usedChunkIds: [`dairy-${scenario.id}`],
          supportAssessment: { requestedTarget: scenario.requested, requirements: [{ kind: scenario.kind, support: "direct", evidence: [
            { chunkId: `dairy-${scenario.id}`, quote: scenario.quote, role: scenario.role, target: scenario.target, targetRelation: scenario.relation },
          ] }] },
        }),
      }));
      if (scenario.id === "D") {
        assert.deepEqual(outcome, { kind: "system_error", code: "GENERATION_UNPARSABLE" });
      } else {
        const resolved = expectResolved(outcome);
        assert.equal(resolved.response.status, scenario.status, scenario.id);
        assert.ok(resolved.response.answer.includes(scenario.quote), scenario.id);
        if (scenario.coverage === "partial") {
          assert.ok(resolved.response.answer.includes("요청 범위"), `${scenario.id}: partial answer must state the scope gap`);
          assert.equal(/\d+\s*(?:℃|일|시간)/u.test(resolved.response.answer), false);
        }
      }
    }
  });

  test("ten supplied store-manual questions preserve store facts, limited support and ambiguous menu clarification", async () => {
    const scenarios = [
      { id: 1, store: "숭실", question: "우유 어디 둬?", target: "우유", title: "재고 및 비품 보관 위치", content: "우유: 냉장고 오른쪽 선반", answer: "오른쪽 선반", status: "answered" },
      { id: 2, store: "이수", question: "우유 어디 둬?", target: "우유", title: "재고 및 비품 보관 위치", content: "우유: 냉장고 왼쪽 선반", answer: "왼쪽 선반", status: "answered" },
      { id: 3, store: "숭실", question: "컵이랑 뚜껑 어디 있음?", target: "컵", title: "비품 안내", content: "컵과 뚜껑은 창고 선반 2번에 둔다.", answer: "컵과 뚜껑은 창고 선반 2번에 있습니다.", status: "answered" },
      { id: 4, store: "이수", question: "평일 오픈이면 몇 시까지 출근해?", target: "오픈", title: "출근 기준", content: "평일 영업 09:00, 오픈 출근 20분 전", answer: `원문: 평일 영업 09:00, 오픈 출근 20분 전. 계산 결과: ${String(Math.floor((9 * 60 - 20) / 60)).padStart(2, "0")}:${String((9 * 60 - 20) % 60).padStart(2, "0")}까지 출근합니다.`, status: "answered" },
      { id: 5, store: "숭실", question: "아이스 라떼 우유 얼마나 넣어?", target: "라떼", title: "음료 제조", content: "ICE 카페라떼 우유 240ml", answer: "정확한 메뉴명", status: "answered" },
      { id: 6, store: "숭실", question: "유제품 보관법", target: "유제품", title: "재고 관리", content: "식재료 상태와 유통기한을 확인하고 정해진 보관 기준을 준수한다. 미등록 보관법은 담당자에게 확인한다.", answer: "상태와 유통기한", status: "insufficient", support: "policy_only" },
      { id: 7, store: "숭실", question: "유통기한 지난 우유 써도 됨?", target: "우유", title: "식재료 관리", content: "유통기한 지난 우유를 포함한 식재료는 사용하지 않는다.", answer: "유통기한 지난 우유는 사용하지 않습니다.", status: "answered" },
      { id: 8, store: "숭실", question: "커피머신 내부 분해해서 씻는 순서 알려줘", target: "커피머신", title: "장비 관리", content: "커피머신 내부를 임의 분해하지 않는다. 세척 기준은 담당자에게 확인한다.", answer: "임의 분해하지 않는다", status: "insufficient", support: "policy_only" },
      { id: 9, store: "버거 신삼", question: "소고기 패티 어디 있고 조리판 몇 도로 맞춰?", target: "소고기 패티", title: "조리 준비", content: "소고기 패티: 냉동고 상단 서랍\n조리판 기본 설정: 180℃", answer: "소고기 패티는 냉동고 상단 서랍, 조리판 기본 설정은 180℃입니다.", status: "answered" },
      { id: 10, store: "버거 신삼", question: "B 패밀리팩 구성 뭐야?", target: "B 패밀리팩", title: "메뉴 구성", content: "B 패밀리팩: 버거 3개, 감자 200g×2, 치킨너겟 6개, 음료 300ml×3", answer: "B 패밀리팩: 버거 3개, 감자 200g×2, 치킨너겟 6개, 음료 300ml×3", status: "answered" },
    ];
    for (const scenario of scenarios) {
      const source = chunk(`manual-case-${scenario.id}`, { title: scenario.title, content: scenario.content, raw_similarity_score: .8 });
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: scenario.question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async raw => { assert.equal(raw, scenario.question); assert.ok(["숭실", "이수", "버거 신삼"].includes(scenario.store)); return [source]; },
        generate: async () => JSON.stringify({ answerable: true, answer: scenario.answer, coverage: scenario.support ? "policy_only" : "direct", usedChunkIds: [source.chunk_id],
          supportAssessment: { requestedTarget: scenario.target, requirements: requestedSupportKinds(scenario.question).map(kind => ({ kind,
            support: scenario.support ?? "direct", evidence: [{ chunkId: source.chunk_id, quote: source.content,
              role: scenario.support ? "referral_policy" : kind, target: scenario.id === 6 ? "식재료" : scenario.target,
              targetRelation: scenario.id === 6 ? "covers_requested" : "same" }] })) } }),
      }));
      assert.equal(outcome.response.status, scenario.status, `case-${scenario.id}`);
      assert.ok(outcome.response.answer.includes(scenario.id === 7 ? "사용하면 안 돼요" : scenario.answer), `case-${scenario.id}`);
      if (scenario.id === 4) assert.ok(outcome.response.answer.includes("계산 결과: 08:40"));
      if (scenario.id === 5) assert.equal(outcome.response.answer.includes("240"), false);
      if (scenario.id === 6) {
        assert.ok(outcome.response.answer.includes("요청 범위 전체를 확인하지 못했습니다"));
        assert.equal(/\d+\s*(?:℃|일|시간)/u.test(outcome.response.answer), false);
      }
    }
  });

  test("optional interpretation preserves original follow-up conditions and accepts only owned same-store user context", async () => {
    const original = "그럼 개봉한 우유는 어떻게 관리해?";
    const context = { userId: "user-a", storeId: "store-a", messages: [{ role: "user" as const, content: "우유 보관법" }] };
    const interpretation = { target: "", contextTarget: "우유", requirements: ["conditions" as const, "method" as const], constraints: ["개봉한"], clarification: false };
    assert.equal(boundedQuestionContext(context, "user-b", "store-a").length, 0);
    assert.equal(boundedQuestionContext(context, "user-a", "store-b").length, 0);
    const source = chunk("opened", { content: "개봉한 우유는 뚜껑을 닫아 냉장 보관한다." });
    let searchQuestion = "";
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: original, requireEvidenceScope: true, requireSupportAssessment: true,
      interpretationContext: { userId: "user-a", storeId: "store-a", conversation: context } }, {
      interpret: async (_question, messages) => { assert.equal(messages.length, 1); return interpretation; },
      search: async question => { searchQuestion = question; return [source]; },
      generate: async (question, _chunks, _variant, assessed) => {
        assert.ok(question.startsWith(original)); assert.deepEqual(assessed?.requirements, ["conditions", "method"]);
        return JSON.stringify({ answerable: true, answer: source.content, coverage: "direct", usedChunkIds: [source.chunk_id],
          supportAssessment: { requestedTarget: "우유", requirements: [
            { kind: "conditions", support: "direct", evidence: [{ chunkId: source.chunk_id, quote: source.content, role: "conditions", target: "우유", targetRelation: "same" }] },
            { kind: "method", support: "direct", evidence: [{ chunkId: source.chunk_id, quote: source.content, role: "method", target: "우유", targetRelation: "same" }] },
          ] } });
      },
    }));
    assert.ok(searchQuestion.startsWith(original)); assert.ok(searchQuestion.includes("우유"));
    assert.equal(outcome.response.status, "answered");
    assert.throws(() => parseQuestionInterpretation(JSON.stringify({ ...interpretation, constraints: ["2일"] }), original, context.messages));
    assert.throws(() => parseQuestionInterpretation(JSON.stringify(interpretation), original, []));
    assert.throws(() => parseQuestionInterpretation(JSON.stringify(interpretation), original, [{ role: "assistant", content: "우유" }]));
    const switched = await resolveRagAnswer({ ...INPUT, question: original,
      interpretationContext: { userId: "user-a", storeId: "store-b", conversation: context } }, {
      interpret: async () => interpretation, search: async () => { assert.fail(); }, generate: async () => { assert.fail(); },
    });
    assert.deepEqual(switched, { kind: "system_error", code: "GENERATION_UNPARSABLE" });
  });

  test("GPT interpretation factory sends strict payload once with no scope field, retries or raw error disclosure", async () => {
    const question = "이거 써도 됨?";
    const result = { target: "", requirements: ["permission"], constraints: [], contextTarget: null, clarification: true };
    const payload = buildQuestionInterpretationRequest(question, []);
    assert.equal(payload.model, "gpt-4o"); assert.equal(payload.response_format.json_schema.strict, true);
    assert.equal(JSON.stringify(payload.response_format).includes("storeId"), false);
    let calls = 0;
    const interpreter = createQuestionInterpreter(async (_url, init) => {
      calls++; assert.deepEqual(JSON.parse(init!.body as string), payload);
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }] }));
    }, "fixture-key");
    assert.deepEqual(await interpreter(question, []), result); assert.equal(calls, 1);
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question }, {
      interpret: interpreter, search: async () => { assert.fail(); }, generate: async () => { assert.fail(); },
    }));
    assert.equal(outcome.escalate, false);
    const failed = createQuestionInterpreter(async () => new Response("private-error", { status: 429 }), "fixture-key");
    await assert.rejects(failed(question, []), error => error instanceof Error && !error.message.includes("private-error"));
  });

  test("same target spelling differences require an explicit cited identity declaration, never category membership", async () => {
    for (const declared of [false, true]) {
      const content = declared ? "동일 품목: 커피콩 = 원두\n원두: 창고 선반" : "커피콩과 원두를 보관한다. 원두: 창고 선반";
      const outcome = await resolveRagAnswer({ ...INPUT, question: "커피콩은 어디에 두나요?", requireEvidenceScope: true, requireSupportAssessment: true }, deps({
        results: [chunk("alias", { content })], generation: JSON.stringify({ answerable: true, answer: "창고 선반", coverage: "direct", usedChunkIds: ["alias"],
          supportAssessment: { requestedTarget: "커피콩", requirements: [{ kind: "location", support: "direct", evidence: [
            { chunkId: "alias", quote: content, role: "location", target: "원두", targetRelation: "same" },
          ] }] } }),
      }));
      assert.equal(outcome.kind, declared ? "resolved" : "system_error");
    }
    const broad = await resolveRagAnswer({ ...INPUT, question: "유제품 보관법", requireEvidenceScope: true, requireSupportAssessment: true }, deps({
      results: [chunk("category", { content: "유제품에는 우유가 포함된다. 우유: 선반" })], generation: JSON.stringify({ answerable: true, answer: "선반", coverage: "direct", usedChunkIds: ["category"],
        supportAssessment: { requestedTarget: "유제품", requirements: [{ kind: "method", support: "direct", evidence: [
          { chunkId: "category", quote: "유제품에는 우유가 포함된다. 우유: 선반", role: "method", target: "우유", targetRelation: "same" },
        ] }] } }),
    }));
    assert.equal(broad.kind, "system_error");
  });

  test("duplicate and excess search chunks are bounded without increasing source count or generation calls", async () => {
    const first = chunk("bounded", { content: "물품: 선반" });
    let supplied = 0;
    const outcome = expectResolved(await resolveRagAnswer(INPUT, deps({
      results: [first, first, chunk("duplicate-body", { manual_id: first.manual_id, content: first.content }), ...Array.from({ length: 8 }, (_, index) => chunk(`extra-${index}`))],
      onGenerate: chunks => { supplied = chunks.length; }, generation: JSON.stringify({ answerable: true, answer: "선반", usedChunkIds: [first.chunk_id] }),
    })));
    assert.equal(supplied, 5); assert.equal(outcome.response.sources?.length, 1);
  });

  test("high relevance cannot replace requested roles while multiple cited chunks can cover compound requirements", async () => {
    const location = chunk("multi-location", { content: "물품: 창고 선반", raw_similarity_score: .95 });
    const method = chunk("multi-method", { content: "물품은 밀봉한 뒤 보관한다.", raw_similarity_score: .65 });
    for (const complete of [false, true]) {
      const requirements = [
        { kind: "location", support: "direct", evidence: [{ chunkId: location.chunk_id, quote: location.content, role: "location", target: "물품", targetRelation: "same" }] },
        { kind: "method", support: complete ? "direct" : "missing", evidence: complete ? [{ chunkId: method.chunk_id, quote: method.content, role: "method", target: "물품", targetRelation: "same" }] : [] },
      ];
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "물품 위치와 보관법", requireEvidenceScope: true, requireSupportAssessment: true }, deps({
        results: [location, method], generation: JSON.stringify({ answerable: true, coverage: complete ? "direct" : "partial",
          answer: "물품은 밀봉하여 창고 선반에 둡니다.", usedChunkIds: complete ? [location.chunk_id, method.chunk_id] : [location.chunk_id],
          supportAssessment: { requestedTarget: "물품", requirements } }),
      })));
      assert.equal(outcome.response.status, complete ? "answered" : "insufficient");
      assert.equal(outcome.response.sources?.length, complete ? 2 : 1);
      assert.equal(outcome.response.similarity, complete ? .65 : .95);
    }
    const wrong = expectResolved(await resolveRagAnswer({ ...INPUT, question: "물품의 개봉 후 보관 조건은?", requireEvidenceScope: true, requireSupportAssessment: true }, deps({
      results: [location], generation: JSON.stringify({ answerable: true, answer: "창고 선반", coverage: "direct", usedChunkIds: [location.chunk_id],
        supportAssessment: { requestedTarget: "물품", requirements: [{ kind: "conditions", support: "direct", evidence: [
          { chunkId: location.chunk_id, quote: location.content, role: "location", target: "물품", targetRelation: "same" },
        ] }] } }),
    })));
    assert.equal(wrong.response.status, "insufficient"); assert.equal(wrong.response.similarity, .95);
  });

  test("colloquial location references use only matching manual targets and source-backed place context", async () => {
    const match = chunk("field-location", { title: "재고 및 비품 보관 위치", content: "우유: 매장 냉장고 오른쪽 선반", raw_similarity_score: .56, keyword_boost: .25 });
    for (const question of ["우유는 어디에 보관하나요?", "우유 어디 둬?", "우유 냉장고 어디 칸임?"]) {
      let searched = "";
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async raw => { searched = raw; return [match]; },
        generate: async () => { assert.fail("source-backed exact location must not generate"); },
      }));
      assert.equal(searched, question);
      assert.equal(outcome.response.answer, "우유의 보관 위치는 매장 냉장고 오른쪽 선반입니다.");
      assert.equal(outcome.response.status, "answered");
      assert.ok(Math.abs(outcome.response.similarity! - .71) < 1e-12);
    }
  });

  test("unclear colloquial permission target asks for clarification without guessing, searching or escalating", async () => {
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "이거 써도 됨?", requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
      search: async () => { assert.fail("unclear target must not search"); },
      generate: async () => { assert.fail("unclear target must not generate"); },
    }));
    assert.equal(outcome.response.status, "insufficient");
    assert.equal(outcome.escalate, false);
    assert.ok(outcome.response.answer.includes("대상"));
    assert.equal(outcome.response.source, null);
  });

  test("colloquial normalization preserves negation, quantities, conditions and unknown place terms without location shortcuts", async () => {
    const source = chunk("field-contrast", { title: "재고 및 비품 보관 위치", content: "우유: 매장 냉장고 오른쪽 선반" });
    const questions = [
      "우유 냉장고 말고 어디 칸임?", "우유 냉동고 어디 칸임?", "우유 2개 냉장고 어디 칸임?",
      "개봉 후 2일 지난 우유 냉장고 어디 칸임?", "우유 냉장고 어디 칸임? 유제품 전체도 알려줘",
      "우유 XY 어디 칸임?",
    ];
    for (const question of questions) {
      const received: string[] = [];
      const events: Record<string, unknown>[] = [];
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async raw => { received.push(raw); return [source]; },
        generate: async raw => { received.push(raw); return JSON.stringify({ answerable: false, answer: "", usedChunkIds: [], coverage: "policy_only", supportAssessment: null }); },
        onDiagnostic: event => events.push(event),
      }));
      assert.deepEqual(received, [question, question]);
      assert.ok(formatSearchEmbeddingInput(question).includes(question));
      assert.ok(buildGroundedAnswerMessages(question, [source])[1].content.endsWith(`[직원 질문]\n${question}`));
      assert.equal(events.find(event => event.stage === "generation")?.mode, "model");
      assert.equal(outcome.response.status, "insufficient");
      assert.equal(outcome.response.source, null);
    }
  });

  test("reported 18:30 milk location without a question mark preserves the right shelf and 0.71 evidence", async () => {
    const match = chunk("reported-location", { title: "재고 및 비품 보관 위치", category: "재고·발주",
      content: "우유: 매장 냉장고 오른쪽 선반", raw_similarity_score: .56, keyword_boost: .25 });
    const events: Record<string, unknown>[] = [];
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "우유는 어디에 보관하나요",
      requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
      search: async () => [match], generate: async () => { assert.fail("registered location must not generate"); },
      onDiagnostic: event => events.push(event),
    }));
    assert.equal(outcome.response.answer, "우유의 보관 위치는 매장 냉장고 오른쪽 선반입니다.");
    assert.equal(outcome.response.status, "answered");
    assert.ok(Math.abs(outcome.response.similarity! - .71) < 1e-12);
    assert.equal(outcome.response.source?.title, match.title);
    assert.equal(outcome.response.source?.category, match.category);
    assert.equal(events.find(event => event.stage === "generation")?.mode, "location_reference");
  });

  test("fully supported compound requests still allow normal model answers under strict validation", async () => {
    const scenarios = [
      { question: "장비를 분해해도 되나요? 작업 순서는 무엇인가요?", target: "장비", content: "장비는 전원을 끈 뒤 분해할 수 있다.", kinds: ["permission", "procedure"] },
      { question: "물품은 어디에 어떻게 보관하나요?", target: "물품", content: "물품은 밀봉한 뒤 창고 선반에 둔다.", kinds: ["location", "method"] },
    ];
    for (const scenario of scenarios) {
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: scenario.question,
        requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, deps({
        results: [chunk("complete", { content: scenario.content })], generation: JSON.stringify({ answerable: true,
          answer: scenario.content, coverage: "direct", usedChunkIds: ["complete"], supportAssessment: { requestedTarget: scenario.target,
            requirements: scenario.kinds.map(kind => ({ kind, support: "direct", evidence: [{ chunkId: "complete", quote: scenario.content,
              role: kind, target: scenario.target, targetRelation: "same" }] })) } }),
      })));
      assert.equal(outcome.response.status, "answered");
      assert.equal(outcome.response.answer, scenario.content);
      assert.equal(outcome.escalate, false);
    }
  });

  test("compound questions reject omitted requirements and keep incomplete support insufficient in the model path", async () => {
    const scenarios = [
      { question: "장비를 분해해도 되나요? 가능하면 작업 순서도 알려주세요.", target: "장비", content: "장비는 임의로 분해하지 않는다.", first: "permission", second: "procedure" },
      { question: "물품은 어디에 어떻게 보관하나요?", target: "물품", content: "물품: 창고 선반", first: "location", second: "method" },
    ] as const;
    for (const scenario of scenarios) {
      const first = { kind: scenario.first, support: "direct", evidence: [{ chunkId: "compound", quote: scenario.content,
        role: scenario.first, target: scenario.target, targetRelation: "same" }] };
      for (const includeMissing of [false, true]) {
        const events: Record<string, unknown>[] = [];
        let generated = 0;
        const outcome = await resolveRagAnswer({ ...INPUT, question: scenario.question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
          search: async () => [chunk("compound", { title: "보관 위치", content: scenario.content })],
          generate: async () => {
            generated++;
            return JSON.stringify({ answerable: true, answer: scenario.content, coverage: "direct", usedChunkIds: ["compound"],
              supportAssessment: { requestedTarget: scenario.target, requirements: [first,
                ...(includeMissing ? [{ kind: scenario.second, support: "missing", evidence: [] }] : [])] } });
          }, onDiagnostic: event => events.push(event),
        });
        assert.equal(generated, 1);
        assert.equal(events.find(event => event.stage === "generation")?.mode, "model");
        if (includeMissing) {
          const resolved = expectResolved(outcome);
          assert.equal(resolved.response.status, "insufficient");
          assert.equal(resolved.escalate, true);
          assert.ok(resolved.response.answer.includes(scenario.content));
          assert.ok(resolved.response.answer.includes("요청 범위 전체를 확인하지 못했습니다"));
          assert.equal(events.findLast(event => event.stage === "final")?.reason, "PARTIAL_SUPPORT_COVERAGE");
        } else {
          assert.deepEqual(outcome, { kind: "system_error", code: "GENERATION_UNPARSABLE" });
          assert.equal(events.find(event => event.stage === "support_validation")?.validationKind, "requirement_mismatch");
        }
      }
    }
  });

  test("reported milk-location question uses supplied location-row references and full validation without a model call", async () => {
    const content = "- 원두: 카운터 아래 보관함\n- 우유: 매장 냉장고 왼쪽 선반\n- 시럽: 제조대 아래 보관함";
    const location = chunk("location-ref", { title: "재고 및 비품 보관 위치", content, raw_similarity_score: .55, keyword_boost: .25 });
    let generated = 0;
    const events: Record<string, unknown>[] = [];
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "우유는 어디에 보관하나요?", requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
      search: async () => [location], generate: async () => { generated++; throw new Error("must not call model for an exact registered location"); },
      onDiagnostic: event => events.push(event),
    }));
    assert.equal(generated, 0);
    assert.equal(outcome.response.status, "answered");
    assert.equal(outcome.response.source?.manualId, location.manual_id);
    assert.ok(Math.abs(outcome.response.similarity! - .70) < 1e-12);
    assert.equal(outcome.response.answer, "우유의 보관 위치는 매장 냉장고 왼쪽 선반입니다.");
    assert.equal(events.find(event => event.stage === "generation")?.mode, "location_reference");
    assert.equal(events.find(event => event.stage === "structured_validation")?.validation, "accepted");
    assert.equal(events.find(event => event.stage === "support_validation")?.validation, "accepted");
    for (const question of ["유제품은 어떻게 보관하나요?", "우유는 어디에 보관하나요? 다른 유제품 전체도 알려주세요.", "우유의 보관 위치와 기간은?"]) {
      const rejected = await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async () => [location], generate: async () => { generated++; throw new Error("fixture model failure"); },
      });
      assert.equal(rejected.kind, "system_error");
    }
    assert.equal(generated, 3);
    const conflicting = chunk("other-location", { title: "보관 위치", content: "우유: 다른 선반", raw_similarity_score: .8 });
    const conflict = expectResolved(await resolveRagAnswer({ ...INPUT, question: "우유는 어디에 보관하나요?" }, {
      search: async () => [location, conflicting], generate: async () => { assert.fail("conflicting registered locations must not be selected by the model"); },
    }));
    assert.equal(conflict.response.status, "insufficient");
    assert.ok(conflict.response.answer.includes("서로 다른 위치"));
    assert.equal(conflict.response.source, null);
  });

  test("location references are item-independent and obey the unchanged cautious evidence gate", async () => {
    for (const item of ["테스트 봉투", "여분 컵"]) {
      const location = chunk("generic-location", { title: "비품 위치", content: `${item}: 창고 선반`, raw_similarity_score: .45 });
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: `${item}는 어디에 있나요?`, requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async () => [location], generate: async () => { throw new Error("no model call"); },
      }));
      assert.equal(outcome.response.status, "cautious");
      assert.equal(outcome.escalate, false);
      assert.ok(outcome.response.answer.includes("창고 선반"));
    }
  });

  test("same accepts only NFC/whitespace spelling normalization, never synonyms or a different category", async () => {
    const sourceTarget = "원두 A";
    const content = `${sourceTarget}: 창고 선반`;
    for (const requestedTarget of ["원두\u00a0\u00a0A", sourceTarget.normalize("NFD")]) {
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: `${requestedTarget}는 어디에 있나요?`, requireSupportAssessment: true, requireEvidenceScope: true }, deps({
        results: [chunk("identity", { content })], generation: JSON.stringify({ answerable: true, answer: "창고 선반", coverage: "direct", usedChunkIds: ["identity"],
          supportAssessment: { requestedTarget, requirements: [{ kind: "location", support: "direct", evidence: [
            { chunkId: "identity", quote: content, role: "location", target: sourceTarget, targetRelation: "same" },
          ] }] } }),
      })));
      assert.equal(outcome.response.status, "answered");
      assert.equal(outcome.escalate, false);
    }
    for (const [requestedTarget, evidenceTarget] of [["우유", "원두"], ["유제품", "우유"], ["원두", "커피콩"]]) {
      const source = `${evidenceTarget}: 창고 선반`;
      const events: Record<string, unknown>[] = [];
      const outcome = await resolveRagAnswer({ ...INPUT, question: `${requestedTarget}는 어디에 있나요?`, requireSupportAssessment: true, requireEvidenceScope: true }, {
        ...deps({ results: [chunk("different", { content: source })], generation: JSON.stringify({ answerable: true, answer: "창고 선반", coverage: "direct", usedChunkIds: ["different"],
          supportAssessment: { requestedTarget, requirements: [{ kind: "location", support: "direct", evidence: [
            { chunkId: "different", quote: source, role: "location", target: evidenceTarget, targetRelation: "same" },
          ] }] } }) }), onDiagnostic: event => events.push(event),
      });
      assert.equal(outcome.kind, "system_error");
      const failure = events.find(event => event.stage === "support_validation");
      assert.equal(failure?.validationKind, "target_relation_mismatch");
      assert.equal(failure?.failureLayer, "support_semantics");
      assert.equal("response" in outcome, false);
    }
  });

  test("same target shares one compatible menu entity without equating different products or attributes alone", () => {
    const quote = "4-3. 카페라떼\n● ICE 카페라떼\n우유 240ml";
    assert.equal(sameDeclaredSourceTarget("아이스 카페라떼", "ICE 카페라떼", quote), true);
    assert.equal(sameDeclaredSourceTarget("아이스 카페라떼 만들 때 우유 몇 ml", "ICE 카페라떼 우유", quote), true);
    assert.equal(sameDeclaredSourceTarget("아이스 카페라떼 만들 때 우유 몇 ml", "HOT 카페라떼 우유", quote), false);
    assert.equal(sameDeclaredSourceTarget("아이스 카페라떼 만들 때 우유 몇 ml", "ICE 바닐라라떼 우유", quote), false);
    assert.equal(sameDeclaredSourceTarget("아이스 카페라떼와 바닐라라떼 우유량", "ICE 카페라떼", quote), false);
    assert.equal(sameDeclaredSourceTarget("ICE 카페라떼", "카페라떼", quote), true);
    assert.equal(sameDeclaredSourceTarget("카페라떼", "ICE 카페라떼", quote), true);
    assert.equal(sameDeclaredSourceTarget("아이스 카페라떼", "HOT 카페라떼", quote), false);
    assert.equal(sameDeclaredSourceTarget("아이스 카페라떼", "아이스 바닐라라떼", quote), false);
    assert.equal(sameDeclaredSourceTarget("우유량", "카페라떼", quote), false);
    assert.equal(sameDeclaredSourceTarget("아이스 카페라떼 우유량", "ICE 카페라떼", quote), true);
    assert.equal(sameDeclaredSourceTarget("유제품", "우유", quote), false);
    assert.equal(sameDeclaredSourceTarget("우유", "유제품", quote), false);
  });

  test("an unqualified latte follows one explicit nearby mode and clarifies when mode is absent or conflicting", async () => {
    const question = "카페라떼 우유 몇 ml 넣어?";
    const ice = chunk("unqualified-ice", { content: "4-3. 카페라떼\n● ICE 카페라떼\n우유 240ml" });
    const hot = chunk("unqualified-hot", { content: "4-3. 카페라떼\n● HOT 카페라떼\n우유 250ml" });
    const unknown = chunk("unqualified-unknown", { content: "4-3. 카페라떼\n우유 240ml" });
    for (const [candidate, mode, amount] of [[ice, "ICE", "240ml"], [hot, "HOT", "250ml"]] as const) {
      assert.equal(buildMenuClarification(question, [candidate]), null);
      const resolved = expectResolved(await resolveRagAnswer({ ...INPUT, question, requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
        search: async () => [candidate],
        generate: async (_original, provided) => JSON.stringify({ answerable: true, answer: `${mode} 카페라떼 우유 ${amount}`, coverage: "direct", usedChunkIds: [candidate.chunk_id],
          supportAssessment: { requestedTarget: "카페라떼", requirements: [{ kind: "facts", support: "direct", evidence: [
            { chunkId: candidate.chunk_id, quote: provided[0].content, role: "facts", target: `${mode} 카페라떼`, targetRelation: "same" },
          ] }] } }),
      }));
      assert.equal(resolved.response.status, "answered");
      assert.ok(resolved.response.answer.includes(amount));
      assert.ok(resolved.response.answer.includes(mode));
    }
    for (const candidates of [[ice, hot], [unknown]]) {
      const clarification = buildMenuClarification(question, candidates);
      assert.ok(clarification?.answer.includes("ICE와 HOT"));
      assert.equal(clarification?.answer.includes("240ml"), false);
      const resolved = expectResolved(await resolveRagAnswer({ ...INPUT, question }, {
        search: async () => candidates,
        generate: async () => { assert.fail("ambiguous temperature must clarify before generation"); },
      }));
      assert.ok(resolved.response.answer.includes("ICE와 HOT"));
      assert.equal(resolved.response.source?.manualId, candidates[0].manual_id);
    }
  });

  test("stored R6 location plus referral cannot cover a broader target's method; same location directly answers its own target", async () => {
    const location = chunk("r6-location", { content: "우유: 매장 냉장고 왼쪽 선반", raw_similarity_score: .548831016859324, keyword_boost: .25 });
    const policy = chunk("r6-policy", { content: "매뉴얼에 없는 재료의 보관 방법은 사장님에게 확인한다.", raw_similarity_score: .484530957650396, keyword_boost: .25 });
    const actualAnswer = "유제품인 우유는 매장 냉장고 왼쪽 선반에 보관합니다. 매뉴얼에 없는 다른 유제품의 보관 방법은 사장님에게 확인하세요.";
    const events: Record<string, unknown>[] = [];
    const broader = expectResolved(await resolveRagAnswer({ ...INPUT, question: "유제품은 어떻게 보관해야 하나요?", requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true }, {
      ...deps({ results: [location, policy], generation: JSON.stringify({ answerable: true, coverage: "direct", answer: actualAnswer,
        usedChunkIds: [location.chunk_id, policy.chunk_id], supportAssessment: { requestedTarget: "유제품", requirements: [{ kind: "method", support: "direct", evidence: [
          { chunkId: location.chunk_id, quote: location.content, role: "location", target: "우유", targetRelation: "subset" },
          { chunkId: policy.chunk_id, quote: policy.content, role: "referral_policy", target: "재료", targetRelation: "covers_requested" },
        ] }] } }) }), onDiagnostic: (event) => events.push(event),
    }));
    assert.equal(broader.response.status, "insufficient");
    assert.equal(broader.escalate, true);
    assert.equal(broader.response.sources?.length, 2);
    assert.ok(Math.abs(broader.response.similarity! - .634530957650396) < 1e-12);
    assert.ok(broader.response.answer.includes(location.content));
    assert.ok(broader.response.answer.includes(policy.content));
    assert.ok(broader.response.answer.includes("확인된 대상은 우유"));
    assert.ok(broader.response.answer.includes("질문의 대상 범위 전체에 적용할 수 없습니다"));
    assert.equal(events.findLast((event) => event.stage === "final")?.supportCoverage, "partial");
    assert.equal(events.findLast((event) => event.stage === "final")?.reason, "PARTIAL_SUPPORT_COVERAGE");
    const narrow = expectResolved(await resolveRagAnswer({ ...INPUT, question: "우유는 어디에 보관하나요?", requireEvidenceScope: true, requireSupportAssessment: true }, deps({
      results: [location], generation: JSON.stringify({ answerable: true, coverage: "direct", answer: "우유는 매장 냉장고 왼쪽 선반에 보관합니다.", usedChunkIds: [location.chunk_id],
        supportAssessment: { requestedTarget: "우유", requirements: [{ kind: "location", support: "direct", evidence: [
          { chunkId: location.chunk_id, quote: location.content, role: "location", target: "우유", targetRelation: "same" },
        ] }] } }),
    })));
    assert.equal(narrow.response.status, "answered");
    assert.equal(narrow.escalate, false);
    assert.equal(narrow.response.answer, "우유는 매장 냉장고 왼쪽 선반에 보관합니다.");
  });

  test("scope/role comparison is generic across targets and does not promote location or referral to conditions/duration", async () => {
    for (const question of ["소모품의 보관 조건은?", "소모품은 얼마나 오래 보관하나요?"]) {
      const kind = requestedSupportKinds(question)[0];
      const content = "테스트 봉투: 창고 선반. 소모품 기준은 관리자에게 확인한다.";
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question, requireEvidenceScope: true, requireSupportAssessment: true }, deps({
        results: [chunk("generic", { content })], generation: JSON.stringify({ answerable: true, coverage: "direct", answer: "보관 가능", usedChunkIds: ["generic"],
          supportAssessment: { requestedTarget: "소모품", requirements: [{ kind, support: "direct", evidence: [
            { chunkId: "generic", quote: "테스트 봉투: 창고 선반.", role: "location", target: "테스트 봉투", targetRelation: "subset" },
          ] }] } }),
      })));
      assert.equal(outcome.response.status, "insufficient");
      assert.ok(outcome.response.answer.includes("테스트 봉투"));
    }
    const content = "소모품 기준은 관리자에게 확인한다.";
    const referral = expectResolved(await resolveRagAnswer({ ...INPUT, question: "소모품 보관법은 누구에게 확인하나요?", requireEvidenceScope: true, requireSupportAssessment: true }, deps({
      results: [chunk("referral", { content })], generation: JSON.stringify({ answerable: true, coverage: "direct", answer: content, usedChunkIds: ["referral"],
        supportAssessment: { requestedTarget: "소모품", requirements: [{ kind: "referral", support: "direct", evidence: [
          { chunkId: "referral", quote: content, role: "referral_policy", target: "소모품", targetRelation: "same" },
        ] }] } }),
    })));
    assert.equal(referral.response.status, "answered");
    assert.equal(referral.escalate, false);
  });

  test("strict target-role contract preserves P3/P5 policies, permission directness and partial timing limits", async () => {
    for (const target of ["튀김기 내부 부품", "커피머신 내부 부품"]) {
      const content = `${target}은 임의로 분해하지 않는다. 필요한 경우 관리자에게 보고한다.`;
      for (const permission of [false, true]) {
        const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: `${target}을 ${permission ? "분해해도 되나요?" : "분해하는 순서는?"}`,
          requireEvidenceScope: true, requireSupportAssessment: true }, deps({
          results: [chunk("equipment", { content })], generation: JSON.stringify({ answerable: true, coverage: "direct", answer: content, usedChunkIds: ["equipment"],
            supportAssessment: { requestedTarget: target, requirements: [{ kind: permission ? "permission" : "procedure", support: permission ? "direct" : "policy_only",
              evidence: [{ chunkId: "equipment", quote: content, role: permission ? "permission" : "referral_policy", target, targetRelation: "same" }] }] } }),
        })));
        assert.equal(outcome.response.status, permission ? "answered" : "insufficient");
        assert.equal(outcome.escalate, !permission);
        assert.ok(outcome.response.answer.includes(content));
      }
    }
    const content = "제조 전 손을 깨끗하게 씻는다.";
    const partial = expectResolved(await resolveRagAnswer({ ...INPUT, question: "손은 언제 어떻게 씻나요?", requireEvidenceScope: true, requireSupportAssessment: true }, deps({
      results: [chunk("hands", { content })], generation: JSON.stringify({ answerable: true, coverage: "partial", answer: content, usedChunkIds: ["hands"],
        supportAssessment: { requestedTarget: "손", requirements: [
          { kind: "timing", support: "direct", evidence: [{ chunkId: "hands", quote: content, role: "timing", target: "손", targetRelation: "same" }] },
          { kind: "method", support: "missing", evidence: [] },
        ] } }),
    })));
    assert.equal(partial.response.status, "insufficient");
    assert.ok(partial.response.answer.includes("구체적인 수행 방법"));
    assert.equal(partial.escalate, true);
  });

  test("scoped requirement quotes must anchor actual question/source targets; old metadata fails strict scope validation", async () => {
    const content = "물품은 창고 선반에 둔다.";
    for (const scope of [undefined, { requestedTarget: "다른 대상", target: "물품", targetRelation: "same" },
      { requestedTarget: "물품", target: "존재하지 않는 품목", targetRelation: "covers_requested" }]) {
      const outcome = await resolveRagAnswer({ ...INPUT, question: "물품은 어디에 두나요?", requireSupportAssessment: true, requireEvidenceScope: true }, deps({
        results: [chunk("scope", { content })], generation: JSON.stringify({ answerable: true, coverage: "direct", answer: content, usedChunkIds: ["scope"],
          supportAssessment: { requestedTarget: scope?.requestedTarget, requirements: [{ kind: "location", support: "direct", evidence: [
            { chunkId: "scope", quote: content, ...(scope ? { role: "location", target: scope.target, targetRelation: scope.targetRelation } : {}) },
          ] }] } }),
      }));
      assert.equal(outcome.kind, "system_error");
    }
  });

  const observedSupportCases = JSON.parse(readFileSync(new URL("./synthetic-support-cases.json", import.meta.url), "utf8")) as {
    provenance: string;
    cases: { id: string; question: string; answer: string; coverage: string; raw: number; boost: number; status: string; support: string; excerpt: string;
      additionalSource?: { raw: number; boost: number; excerpt: string } }[];
  };
  for (const observed of observedSupportCases.cases) {
    test(`stored ${observed.id} with synthetic reviewed support metadata: ${observed.support}`, async () => {
      const match = chunk(observed.id, { content: observed.excerpt, raw_similarity_score: observed.raw, keyword_boost: observed.boost });
      const matches = [match, ...(observed.additionalSource ? [chunk(`${observed.id}-report`, { content: observed.additionalSource.excerpt,
        raw_similarity_score: observed.additionalSource.raw, keyword_boost: observed.additionalSource.boost })] : [])];
      const requirements = requestedSupportKinds(observed.question).map((kind) => ({ kind,
        support: observed.support === "partial" ? kind === "timing" ? "direct" : "missing" : observed.support,
        evidence: observed.support === "missing" || observed.support === "partial" && kind !== "timing" ? [] : matches.map((item) => ({ chunkId: item.chunk_id, quote: item.content })),
      }));
      const events: Record<string, unknown>[] = [];
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: observed.question, requireCoverage: true, requireSupportAssessment: true }, {
        ...deps({ results: matches, generation: JSON.stringify({ answerable: observed.id !== "P2", answer: observed.answer, coverage: observed.coverage,
          usedChunkIds: observed.id === "P2" ? [] : matches.map((item) => item.chunk_id), supportAssessment: { requirements } }) }),
        onDiagnostic: (event) => events.push(event),
      }));
      assert.equal(outcome.response.status, observed.status);
      assert.ok(Math.abs(outcome.response.similarity! - (observed.raw + 0.15)) < 1e-12);
      assert.equal(outcome.escalate, observed.status === "insufficient");
      if (observed.id !== "P2") assert.ok(outcome.response.sources?.some((source) => source.manualId === match.manual_id));
      if (observed.id.startsWith("S")) assert.equal(outcome.response.answer, observed.answer + (observed.status === "cautious" ? CAUTION_NOTICE : ""));
      if (["P3", "P4", "P5"].includes(observed.id)) {
        assert.ok(outcome.response.answer.includes(observed.excerpt));
        assert.ok(outcome.response.answer.includes("현재 제공된 근거에서"));
        assert.ok(outcome.response.answer.includes("확인하지 못했습니다"));
        assert.equal(events.findLast((event) => event.stage === "final")?.reason, "POLICY_ONLY_COVERAGE");
      }
      if (observed.id === "P1") {
        assert.ok(outcome.response.answer.includes("조리 및 제조 업무 전"));
        assert.ok(outcome.response.answer.includes("구체적인 수행 방법"));
        assert.ok(outcome.response.answer.includes("한정됩니다"));
      }
      if (observed.id === "P4") assert.equal(outcome.response.answer.includes("매뉴얼이 없으므로"), false);
      if (observed.additionalSource) {
        assert.ok(outcome.response.answer.includes(observed.additionalSource.excerpt));
        assert.equal(outcome.response.sources?.length, 2);
      }
    });
  }

  test("the same prohibition directly answers permission, not a requested procedure", async () => {
    const content = "직원은 튀김기 내부 부품을 임의로 분해하지 않는다.";
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "튀김기 내부 부품을 분해해도 되나요?", requireSupportAssessment: true }, deps({
      results: [chunk("permission", { content })], generation: JSON.stringify({ answerable: true, coverage: "direct", answer: content, usedChunkIds: ["permission"],
        supportAssessment: { requirements: [{ kind: "permission", support: "direct", evidence: [{ chunkId: "permission", quote: content }] }] } }),
    })));
    assert.equal(outcome.response.status, "answered");
    assert.equal(outcome.escalate, false);
    assert.equal(outcome.response.answer, content);
  });

  test("missing requirements, unprovided quote IDs, fabricated quotes and missing assessment fail closed as system errors", async () => {
    const evidence = [{ chunkId: "c1", quote: "실제 재고를 확인한다." }];
    for (const assessment of [undefined, { requirements: [{ kind: "permission", support: "direct", evidence }] },
      { requirements: [{ kind: "procedure", support: "direct", evidence: [{ chunkId: "foreign", quote: evidence[0].quote }] }] },
      { requirements: [{ kind: "procedure", support: "direct", evidence: [{ chunkId: "c1", quote: "지어낸 분해 순서" }] }] }]) {
      const outcome = await resolveRagAnswer({ ...INPUT, question: "재고 확인 절차는?", requireSupportAssessment: true }, deps({
        results: [chunk("c1", { content: evidence[0].quote })], generation: JSON.stringify({ answerable: true, coverage: "direct", answer: "fixture", usedChunkIds: ["c1"], supportAssessment: assessment }),
      }));
      assert.equal(outcome.kind, "system_error");
    }
  });

  test("safe developer diagnostics join candidate, coverage, citations and final decision without model text or personal fields", async () => {
    const chunkId = "11111111-1111-4111-8111-111111111111";
    const manualId = "22222222-2222-4222-8222-222222222222";
    const events: Record<string, unknown>[] = [];
    const diagnostic = createRagDiagnosticTrace({ enabled: true, conversationId: "33333333-3333-4333-8333-333333333333",
      storeId: "44444444-4444-4444-8444-444444444444", emit: (event) => events.push(event) });
    const privateText = "fixture-person@example.test 010-1234-5678 sk-fixture-secret-body";
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, requireCoverage: true }, {
      ...deps({ results: [chunk(chunkId, { manual_id: manualId, content: privateText, raw_similarity_score: 0.41, keyword_boost: 0.25 })],
        generation: JSON.stringify({ answerable: true, coverage: "direct", answer: privateText, usedChunkIds: [chunkId, privateText] }) }),
      onDiagnostic: diagnostic,
    }));
    assert.equal(outcome.response.status, "cautious");
    assert.deepEqual(events.find((event) => event.stage === "search")?.candidates, [{ manualTag: conversationTraceTag(manualId), chunkTag: conversationTraceTag(chunkId), rank: 1, scopeKind: "unknown",
      rpcScore: 0.6599999999999999, rawSimilarity: 0.41, keywordBoost: 0.25, keywordSupport: 0.15, evidenceScore: 0.5599999999999999 }]);
    const delivered = events.find(event => event.stage === "prompt_delivery")?.candidates as { promptIncluded: boolean; chunkTag: string }[];
    assert.equal(delivered[0].promptIncluded, true);
    assert.equal(delivered[0].chunkTag, conversationTraceTag(chunkId));
    assert.equal(events.find((event) => event.stage === "structured_validation")?.coverage, "direct");
    assert.equal(events.find((event) => event.stage === "citation_validation")?.rejectedCitationCount, 1);
    assert.deepEqual(events.find((event) => event.stage === "final")?.usedChunkIds, [chunkId]);
    diagnostic({ stage: "request", userId: "raw-user-id", question: privateText, token: privateText, candidates: [{ content: privateText }] });
    assert.equal(JSON.stringify(events).includes(privateText), false);
    assert.equal(JSON.stringify(events).includes("raw-user-id"), false);
    assert.equal(new Set(events.map((event) => event.traceId)).size, 1);
    const disabled = createRagDiagnosticTrace({ enabled: false, conversationId: null, storeId: null, emit: () => assert.fail("disabled trace emitted") });
    disabled({ stage: "request" });
    const throwing = createRagDiagnosticTrace({ enabled: true, conversationId: null, storeId: null, emit: () => { throw new Error("fixture logger unavailable"); } });
    assert.doesNotThrow(() => throwing({ stage: "request" }));
    diagnostic({ stage: "structured_validation", validation: "rejected", fieldPath: "supportAssessment.requirements[0].evidence[0].role", validationKind: "invalid_enum", raw: privateText });
    assert.equal(events.at(-1)?.fieldPath, "supportAssessment.requirements[0].evidence[0].role");
    diagnostic({ stage: "structured_validation", validation: "rejected", fieldPath: privateText, validationKind: privateText });
    assert.equal(events.at(-1)?.fieldPath, undefined);
    assert.equal(events.at(-1)?.validationKind, undefined);
  });

  test("candidate scope diagnostics stay unknown on failed metadata or foreign/unapproved rows without changing search evidence", async () => {
    const match = chunk("scope-audit");
    const accepted = await annotateCandidateScopes([match], "store", "brand", async () => ({ data: [
      { id: match.manual_id, status: "approved", franchise_id: "brand", scope_type: "hq", store_id: null },
    ], error: null }));
    assert.equal(accepted[0].diagnostic_scope, "hq");
    for (const row of [
      { status: "draft", franchise_id: "brand", store_id: null, scope_type: "hq" },
      { status: "approved", franchise_id: "other-brand", store_id: null, scope_type: "hq" },
      { status: "approved", franchise_id: "brand", store_id: "other-store", scope_type: "store" },
    ]) {
      const result = await annotateCandidateScopes([match], "store", "brand", async () => ({ data: [{ id: match.manual_id, ...row }], error: null }));
      assert.equal(result[0].diagnostic_scope, "unknown");
      assert.equal(result[0].content, match.content);
    }
    const failed = await annotateCandidateScopes([match], "store", "brand", async () => { throw new Error("private metadata error"); });
    assert.equal(failed[0].diagnostic_scope, "unknown");
    assert.equal(failed[0].content, match.content);
    const malformed = await annotateCandidateScopes([match], "store", "brand", async () => ({ data: [null, "private"], error: null }));
    assert.equal(malformed[0].diagnostic_scope, "unknown");
  });

  test("invalid model coverage is rejected without retaining the unsafe coverage value", async () => {
    const events: Record<string, unknown>[] = [];
    const outcome = await resolveRagAnswer({ ...INPUT, requireCoverage: true }, {
      ...deps({ results: [chunk("c1")], generation: JSON.stringify({ answerable: true, answer: "fixture", usedChunkIds: ["c1"], coverage: "sk-private@example.test" }) }),
      onDiagnostic: (event) => events.push(event),
    });
    assert.equal(outcome.kind, "system_error");
    assert.equal(events.find((event) => event.stage === "structured_validation")?.validation, "rejected");
    assert.equal(JSON.stringify(events).includes("sk-private@example.test"), false);
  });

  test("complete direct checking procedure remains cautious at its observed cited score without a coverage penalty", async () => {
    const steps = "지점 매뉴얼, 본사 공통 매뉴얼을 확인하고 불명확하면 담당자에게 문의하며 임의로 추측하지 않습니다.";
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "처음 맡는 업무의 절차를 모르겠으면 어떻게 확인하나요?", requireCoverage: true }, deps({
      results: [chunk("procedure", { raw_similarity_score: 0.409292845030823, keyword_boost: 0.25, content: steps })],
      generation: JSON.stringify({ answerable: true, coverage: "direct", answer: steps, usedChunkIds: ["procedure"] }),
    })));
    assert.ok(Math.abs(outcome.response.similarity! - 0.559292845030823) < 1e-12);
    assert.equal(outcome.response.status, "cautious");
    assert.equal(outcome.escalate, false);
    assert.equal(outcome.response.answer, steps + CAUTION_NOTICE);
  });

  test("observed dairy policy evidence stays insufficient at 63 percent without reducing its evidence value", async () => {
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "유제품은 어떻게 보관해야 하나요?", requireCoverage: true }, deps({
      results: [chunk("policy", { raw_similarity_score: 0.484530957650396, keyword_boost: 0.25, content: "매뉴얼에 없는 재료의 보관 방법은 관리자에게 확인한다." })],
      generation: JSON.stringify({ answerable: true, coverage: "policy_only", answer: "구체 보관 기준은 관리자에게 확인해야 합니다.", usedChunkIds: ["policy"] }),
    })));
    assert.ok(Math.abs(outcome.response.similarity! - 0.634530957650396) < 1e-12);
    assert.equal(outcome.response.status, "insufficient");
    assert.equal(outcome.escalate, true);
    assert.equal(outcome.response.source?.manualId, "manual-policy");
  });

  test("current-model strict mode rejects missing coverage instead of assuming a direct answer", async () => {
    const result = await resolveRagAnswer({ ...INPUT, requireCoverage: true }, deps({ results: [chunk("c1")] }));
    assert.equal(result.kind, "system_error");
    assert.equal(result.kind === "system_error" ? result.code : "", "GENERATION_UNPARSABLE");
  });

  test("policy-only guidance keeps citations but requests manual follow-up despite high similarity", async () => {
    const result = expectResolved(await resolveRagAnswer({ ...INPUT, question: "유제품은 어떻게 보관해야 하나요?" }, deps({
      results: [chunk("policy", { raw_similarity_score: 0.8, content: "매뉴얼에 없는 재료의 보관 방법은 관리자에게 확인한다." })],
      generation: JSON.stringify({ answerable: true, coverage: "policy_only", answer: "제공된 근거에는 구체 보관 기준이 없어 관리자에게 확인해야 합니다.", usedChunkIds: ["policy"] }),
    })));
    assert.equal(result.response.status, "insufficient");
    assert.equal(result.escalate, true);
    assert.equal(result.response.source?.manualId, "manual-policy");
    assert.equal(result.response.similarity, 0.8);
    assert.ok(result.response.answer.includes("관리자에게 확인"));
  });

  test("explicit reporting procedure is direct evidence, not rejected by its answer wording", async () => {
    const result = expectResolved(await resolveRagAnswer({ ...INPUT, question: "등록된 지침이 없으면 누구에게 확인하나요?" }, deps({
      results: [chunk("policy", { raw_similarity_score: 0.8, content: "등록되지 않은 지침은 관리자에게 확인한다." })],
      generation: JSON.stringify({ answerable: true, coverage: "direct", answer: "등록된 지침이 없으므로 관리자에게 확인합니다.", usedChunkIds: ["policy"] }),
    })));
    assert.equal(result.response.status, "answered");
    assert.equal(result.escalate, false);
  });

  test("unused high-score candidates cannot inflate a lower cited source's score or classification", async () => {
    const outcome = expectResolved(await resolveRagAnswer(INPUT, deps({
      results: [chunk("unused", { raw_similarity_score: 0.9 }), chunk("cited", { raw_similarity_score: 0.45 })],
      generation: '{"answerable":true,"answer":"실제 사용한 근거 답변","usedChunkIds":["cited"]}',
    })));
    assert.equal(outcome.response.similarity, 0.45);
    assert.equal(outcome.response.status, "cautious");
    assert.equal(outcome.response.answer, `실제 사용한 근거 답변${CAUTION_NOTICE}`);
    assert.deepEqual(outcome.response.sources?.map((source) => source.manualId), ["manual-cited"]);
    assert.equal(outcome.escalate, false);
    assert.equal(outcome.response.matches[0].rawSimilarity, 0.9);
  });

  test("multi-source answers use the weakest actually cited evidence, without reducing admission thresholds", async () => {
    const outcome = expectResolved(await resolveRagAnswer(INPUT, deps({
      results: [chunk("strong", { raw_similarity_score: 0.8 }), chunk("weak", { raw_similarity_score: 0.41 })],
      generation: '{"answerable":true,"answer":"두 근거의 답변","usedChunkIds":["strong","weak"]}',
    })));
    assert.equal(outcome.response.similarity, 0.41);
    assert.equal(outcome.response.status, "cautious");
    assert.equal(outcome.response.sources?.length, 2);
    assert.ok(outcome.response.answer.endsWith(CAUTION_NOTICE));
  });

  test("cited evidence uses the semantic gate score, not the RPC ranking score or a second boost", async () => {
    const outcome = expectResolved(await resolveRagAnswer(INPUT, deps({
      results: [chunk("c1", { raw_similarity_score: 0.46, keyword_boost: 0.25, similarity_score: 0.71 })],
    })));
    assert.ok(Math.abs(outcome.response.similarity! - 0.61) < 1e-10);
    assert.equal(outcome.response.status, "answered");
    assert.equal(outcome.response.matches[0].similarity, 0.71);
  });

  test("rounded 60 percent does not promote cited evidence below the internal 0.60 boundary", async () => {
    const outcome = expectResolved(await resolveRagAnswer(INPUT, deps({ results: [chunk("c1", { raw_similarity_score: 0.595 })] })));
    assert.equal(Math.round(outcome.response.similarity! * 100), 60);
    assert.equal(outcome.response.status, "cautious");
    assert.equal(outcome.response.similarity, 0.595);
  });

  test("본사 매뉴얼 근거로 답하고 사용한 출처를 돌려준다", async () => {
    const outcome = expectResolved(
      await resolveRagAnswer(INPUT, deps({
        results: [chunk("c1", { raw_similarity_score: 0.82 })],
        generation: '{"answerable":true,"answer":"환불은 영수증 확인 후 진행합니다.","usedChunkIds":["c1"]}',
      })),
    );

    assert.equal(outcome.response.status, "answered");
    assert.equal(outcome.escalate, false);
    assert.equal(outcome.response.answer, "환불은 영수증 확인 후 진행합니다.");
    assert.deepEqual(outcome.response.sources, [
      { manualId: "manual-c1", title: "제목 c1", category: "운영" },
    ]);
    assert.deepEqual(outcome.response.source, outcome.response.sources?.[0]);
  });

  test("지점 값이 담긴 근거만 넘어가고 그대로 답변된다", async () => {
    let handed: ManualChunkMatch[] = [];
    const storeChunk = chunk("store-open", {
      raw_similarity_score: 0.78,
      content: "A지점 평일 오픈 07:30",
    });
    const outcome = expectResolved(
      await resolveRagAnswer(INPUT, deps({
        results: [storeChunk, chunk("weak", { raw_similarity_score: 0.1 })],
        onGenerate: (chunks) => { handed = chunks; },
        generation: '{"answerable":true,"answer":"평일 오픈은 07:30입니다.","usedChunkIds":["store-open"]}',
      })),
    );

    assert.deepEqual(handed.map((item) => item.chunk_id), ["store-open"]);
    assert.equal(outcome.response.status, "answered");
    assert.deepEqual(outcome.response.sources?.map((item) => item.manualId), ["manual-store-open"]);
  });

  test("매뉴얼에 명시된 점주 확인 절차는 근거 있는 답변으로 남는다", async () => {
    const outcome = expectResolved(
      await resolveRagAnswer(INPUT, deps({
        results: [chunk("c1", { raw_similarity_score: 0.71, content: "환불은 점주 확인 후 진행한다." })],
        generation: '{"answerable":true,"answer":"매뉴얼상 점주 확인 후 진행합니다.","usedChunkIds":["c1"]}',
      })),
    );

    assert.equal(outcome.response.status, "answered");
    assert.equal(outcome.escalate, false);
  });

  test("여러 근거를 쓰면 출처도 모두 돌려준다", async () => {
    const outcome = expectResolved(
      await resolveRagAnswer(INPUT, deps({
        results: [chunk("c1", { raw_similarity_score: 0.8 }), chunk("c2", { raw_similarity_score: 0.7 })],
        generation: '{"answerable":true,"answer":"두 근거를 합친 답변","usedChunkIds":["c2","c1"]}',
      })),
    );

    assert.deepEqual(outcome.response.sources?.map((item) => item.manualId), ["manual-c1", "manual-c2"]);
    assert.equal(outcome.response.source?.manualId, "manual-c1");
  });

  test("cautious면 답변 끝에 주의 문구를 붙인다", async () => {
    const outcome = expectResolved(
      await resolveRagAnswer(INPUT, deps({
        results: [chunk("c1", { raw_similarity_score: 0.45 })],
        generation: '{"answerable":true,"answer":"부분 답변","usedChunkIds":["c1"]}',
      })),
    );

    assert.equal(outcome.response.status, "cautious");
    assert.equal(outcome.response.answer, `부분 답변${CAUTION_NOTICE}`);
    assert.equal(outcome.escalate, false);
  });
});

describe("본문 항목 제목의 메뉴 구분: 점수 변경 없는 후보 선택", () => {
  const cafe = chunk("cafe", { title: "음료 제조 및 레시피 관리", content: "4-3. 카페라떼\n우유 240ml. HOT 스팀 온도 60~65℃. HOT/ICE 조건을 구분한다.", raw_similarity_score: 0.408392, keyword_boost: 0.2, similarity_score: 0.608392 });
  const vanilla = chunk("vanilla", { title: cafe.title, content: "1. 바닐라라떼\n바닐라 메뉴의 합성 시험 항목.", raw_similarity_score: 0.7 });
  const strawberry = chunk("strawberry", { title: cafe.title, content: "2. 딸기라떼\n딸기 메뉴의 합성 시험 항목.", raw_similarity_score: 0.8 });

  test("explicit cafe keeps the 4-3 candidate, not higher-score flavored lattes, and remains cautious", async () => {
    let provided: ManualChunkMatch[] = [];
    const before = JSON.stringify([vanilla, cafe, strawberry]);
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "HOT 카페라떼 우유량과 스팀 온도는?" }, {
      search: async () => [vanilla, cafe, strawberry],
      generate: async (question, chunks) => {
        assert.equal(question, "HOT 카페라떼 우유량과 스팀 온도는?");
        provided = chunks;
        return JSON.stringify({ answerable: true, answer: cafe.content, usedChunkIds: [cafe.chunk_id] });
      },
    }));
    assert.deepEqual(provided.map((match) => match.chunk_id), ["cafe"]);
    assert.equal(outcome.response.status, "cautious");
    assert.ok(Math.abs(outcome.response.similarity! - 0.558392) < 1e-10);
    assert.ok(outcome.response.answer.includes("240ml"));
    assert.ok(outcome.response.answer.includes("60~65℃"));
    assert.equal(outcome.response.source?.manualId, cafe.manual_id);
    assert.equal(JSON.stringify([vanilla, cafe, strawberry]), before);
  });

  test("vanilla, strawberry, spaced menu names and mixed-item chunks retain their own identity", () => {
    for (const [question, expected] of [["바닐라 라떼 우유 얼마 넣어요?", "vanilla"], ["딸기라떼 제조 방법은?", "strawberry"], ["카페 라떼 스팀 온도는?", "cafe"]]) {
      assert.deepEqual(selectMenuCandidates(question, [vanilla, cafe, strawberry]).matches.map((match) => match.chunk_id), [expected]);
    }
    const mixed = { ...cafe, content: `${cafe.content}\n${vanilla.content}` };
    assert.deepEqual(candidateMenuNames(mixed), ["카페라떼", "바닐라라떼"]);
    assert.equal(selectMenuCandidates("카페라떼 우유량은?", [mixed]).matches[0].content, mixed.content);
  });

  test("generic warm latte asks for the menu without a model call, even with one named candidate", async () => {
    for (const results of [[vanilla, cafe, strawberry], [cafe]]) {
      let calls = 0;
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "따뜻한 라떼 우유 얼마나 넣고 몇 도까지 데워요?" }, {
        search: async () => results,
        generate: async () => { calls++; return ""; },
      }));
      assert.equal(calls, 0);
      assert.ok(outcome.response.answer.startsWith("어떤 라떼 메뉴를 말씀하시나요?"));
      assert.equal(/240|60~65|바닐라라떼입니다/u.test(outcome.response.answer), false);
      assert.equal(outcome.escalate, false);
      assert.ok(outcome.response.sources!.length > 0);
    }
  });

  test("a compound flavored cafe-latte name is not silently reduced to plain cafe latte", () => {
    assert.deepEqual(selectMenuCandidates("바닐라 카페라떼 우유량은?", [cafe, vanilla]).matches, []);
    const compound = { ...vanilla, content: "4-9. 바닐라 카페 라떼\n합성 이름 구분 시험." };
    assert.deepEqual(candidateMenuNames(compound), ["바닐라카페라떼"]);
    assert.deepEqual(selectMenuCandidates("HOT 바닐라 카페라떼 우유량은?", [cafe, compound]).matches.map((match) => match.chunk_id), [compound.chunk_id]);
  });

  test("unrecognized or absent number headings cannot send an unresolved latte menu to generation", async () => {
    for (const content of ["4-3 카페라떼\nHOT 우유 240ml, 스팀 60~65℃.", "카페라떼\nHOT 우유 240ml, 스팀 60~65℃.", "일반 음료 안내만 있습니다."]) {
      let calls = 0;
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "따뜻한 라떼 우유 얼마나 넣고 몇 도까지 데워요?" }, {
        search: async () => [{ ...cafe, content }],
        generate: async () => { calls++; throw new Error("UNRESOLVED_MENU_MUST_NOT_GENERATE"); },
      }));
      assert.equal(calls, 0);
      if (content.includes("라떼")) {
        assert.ok(outcome.response.answer.startsWith("어떤 라떼 메뉴를 말씀하시나요?"));
        assert.equal(/240|220|60|65|온도가 다르/u.test(outcome.response.answer), false);
        assert.equal(outcome.escalate, false);
      } else {
        assert.equal(outcome.response.status, "insufficient");
        assert.equal(outcome.escalate, true);
      }
    }
    assert.ok(buildMenuClarification("HOT 말고 ICE 라떼 우유 얼마 넣어요?", [cafe])?.answerable);
  });

  test("missing or low-score recipe evidence is withheld, not treated as a clarification source", async () => {
    let calls = 0;
    const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: "라떼 우유 얼마나 넣어요?" }, {
      search: async () => [{ ...cafe, raw_similarity_score: 0.1, keyword_boost: 0.35 }],
      generate: async () => { calls++; return ""; },
    }));
    assert.equal(outcome.response.status, "insufficient");
    assert.equal(outcome.escalate, true);
    assert.equal(calls, 0);
  });

  test("negations, stock requests and burger tasks are not filtered or reinterpreted as recipes", () => {
    for (const question of ["바닐라라떼 말고 카페라떼 우유량 알려줘", "라떼 우유 부족한데 주문 넣어도 돼요?", "우유가 거의 없는데 제가 바로 주문 넣어도 돼요?", "B 패밀리팩 음료 몇 개예요?", "튀김기 청소 어떻게 해?"]) {
      assert.deepEqual(selectMenuCandidates(question, [vanilla, cafe, strawberry]).matches, [vanilla, cafe, strawberry]);
      assert.equal(buildMenuClarification(question, [vanilla, cafe]), null);
    }
    const unlabeled = { ...cafe, content: "공통 설명\n카페라떼의 우유 사용에 대한 설명입니다." };
    assert.deepEqual(candidateMenuNames(unlabeled), []);
    assert.deepEqual(selectMenuCandidates("바닐라라떼 제조 방법은?", [unlabeled]).matches, [unlabeled]);
  });

  test("local diagnostics distinguish menu conflicts from low scores and local clarification from generation", async () => {
    const exact = await diagnoseRagCase({ question: "HOT 카페라떼 우유량과 온도는?", matches: [vanilla, cafe, strawberry], generation: JSON.stringify({ answerable: true, answer: cafe.content, usedChunkIds: [cafe.chunk_id] }) }, { storeId: "store", franchiseId: "coffee" });
    assert.equal(exact.candidates[0].gateReason, "explicit_menu_conflict");
    assert.equal(exact.candidates[0].evidenceScore, 0.7);
    assert.equal(exact.candidates[0].admittedByGate, false);
    assert.equal(exact.candidates[1].selected, true);
    assert.deepEqual(exact.candidates[1].itemMenus, ["카페라떼"]);
    const generic = await diagnoseRagCase({ question: "따뜻한 라떼 우유 얼마나 넣어요?", matches: [vanilla, cafe], generation: "must not be read" }, { storeId: "store", franchiseId: "coffee" });
    assert.equal(generic.menuClarificationUsed, true);
    assert.equal(generic.generationExecuted, false);
    assert.equal(generic.final && "generatedAnswerable" in generic.final ? generic.final.generatedAnswerable : undefined, null);
    assert.ok(generic.candidates.every((candidate) => candidate.selectionReason === "supports_menu_clarification"));
    assert.deepEqual(generic.final && "selectedChunkIds" in generic.final ? generic.final.selectedChunkIds?.sort() ?? [] : [], ["cafe", "vanilla"]);
  });
});

describe("근거가 부족한 질문", () => {
  test("C·A. 키워드만 겹친 무관한 청크는 생성 없이 insufficient가 된다", async () => {
    let generateCalls = 0;
    const outcome = expectResolved(
      await resolveRagAnswer(INPUT, {
        async search() {
          return [chunk("terminal-cleaning", { raw_similarity_score: 0.05, keyword_boost: 0.35 })];
        },
        async generate() {
          generateCalls += 1;
          return "";
        },
      }),
    );

    assert.equal(generateCalls, 0, "무관한 근거로는 모델을 부르지 않는다");
    assert.equal(outcome.response.status, "insufficient");
    assert.ok(outcome.response.answer.includes(NO_MANUAL_ANSWER));
    assert.ok(outcome.response.answer.includes(INPUT.question));
    assert.deepEqual(outcome.response.sources, []);
    assert.equal(outcome.response.source, null);
    assert.equal(outcome.escalate, true);
  });

  test("매뉴얼에 없는 정책·POS 조작법은 검색 결과가 없어 insufficient가 된다", async () => {
    const outcome = expectResolved(await resolveRagAnswer(INPUT, deps({ results: [] })));

    assert.equal(outcome.response.status, "insufficient");
    assert.equal(outcome.response.similarity, null);
    assert.deepEqual(outcome.response.matches, []);
    assert.equal(outcome.escalate, true);
  });

  test("생성기가 근거 부족이라고 하면 최종 insufficient가 되고 에스컬레이션한다", async () => {
    const outcome = expectResolved(
      await resolveRagAnswer(INPUT, deps({
        results: [chunk("c1", { raw_similarity_score: 0.85 })],
        generation: '{"answerable":false,"answer":"","usedChunkIds":[]}',
      })),
    );

    assert.equal(outcome.response.status, "insufficient");
    assert.ok(outcome.response.answer.includes(NO_MANUAL_ANSWER));
    assert.ok(outcome.response.answer.includes(INPUT.question));
    assert.equal(outcome.escalate, true);
    assert.equal(outcome.response.source, null);
  });

  test("제공하지 않은 근거 id만 돌려주면 확정 답변으로 쓰지 않는다", async () => {
    const outcome = expectResolved(
      await resolveRagAnswer(INPUT, deps({
        results: [chunk("c1", { raw_similarity_score: 0.85 })],
        generation: '{"answerable":true,"answer":"지어낸 답변","usedChunkIds":["made-up"]}',
      })),
    );

    assert.equal(outcome.response.status, "insufficient");
    assert.ok(outcome.response.answer.includes(NO_MANUAL_ANSWER));
    assert.ok(outcome.response.answer.includes(INPUT.question));
    assert.deepEqual(outcome.response.sources, []);
    assert.equal(outcome.escalate, true);
  });

  test("유효한 id와 지어낸 id가 섞이면 유효한 것만 출처로 남는다", async () => {
    const outcome = expectResolved(
      await resolveRagAnswer(INPUT, deps({
        results: [chunk("c1", { raw_similarity_score: 0.85 }), chunk("c2", { raw_similarity_score: 0.8 })],
        generation: '{"answerable":true,"answer":"답변","usedChunkIds":["c2","made-up"]}',
      })),
    );

    assert.equal(outcome.response.status, "answered");
    assert.deepEqual(outcome.response.sources?.map((item) => item.manualId), ["manual-c2"]);
  });
});

describe("시스템 오류는 근거 부족과 구분한다", () => {
  test("검색(RPC) 실패는 system_error이고 알림을 걸지 않는다", async () => {
    const outcome = await resolveRagAnswer(INPUT, deps({ searchError: true }));
    assert.deepEqual(outcome, { kind: "system_error", code: "SEARCH_FAILED" });
  });

  test("모델 호출 실패는 system_error다", async () => {
    const outcome = await resolveRagAnswer(INPUT, deps({
      results: [chunk("c1", { raw_similarity_score: 0.85 })],
      generateError: true,
    }));
    assert.deepEqual(outcome, { kind: "system_error", code: "GENERATION_FAILED" });
  });

  for (const generation of ["", "not json", '{"answer":"a"}']) {
    test(`구조화 결과 파싱 실패는 system_error다: ${JSON.stringify(generation)}`, async () => {
      const outcome = await resolveRagAnswer(INPUT, deps({
        results: [chunk("c1", { raw_similarity_score: 0.85 })],
        generation,
      }));
      assert.deepEqual(outcome, { kind: "system_error", code: "GENERATION_UNPARSABLE" });
    });
  }

  test("system_error에는 응답 본문도 escalate 플래그도 없다", async () => {
    const outcome = await resolveRagAnswer(INPUT, deps({ searchError: true }));
    assert.equal("response" in outcome, false);
    assert.equal("escalate" in outcome, false);
  });
});

describe("구어체 질문 fixture: 검색과 핵심 답변 계약 (mock vector/RPC/generator)", () => {
  type FixtureChunk = ManualChunkMatch & { storeId: string | null; franchiseId: string; scope: "store" | "hq" };
  const cleaning = "일반 청소는 매장 청소 체크리스트를 확인하고 표면 오염을 닦는다.";
  const disassembly = "직원은 튀김기 내부 부품을 임의로 분해하지 않는다. 내부 청소가 필요하면 점주에게 보고한다. 점주는 해당 모델의 제조사 설명서와 담당자 지침을 확인해 작업 가능 여부와 담당자를 안내한다.";
  const inventory = "실제 재고와 추가 재고를 확인한 뒤 점주에게 보고한다. 직원은 임의로 발주하지 않는다.";
  const bundle = "B 패밀리팩 구성: 버거 3개, 감자 200g×2, 너겟 6개, 음료 300ml×3.";

  function fixture(id: string, title: string, content: string, raw: number, storeId: string, franchiseId: string): FixtureChunk {
    return { ...chunk(id, { title, content, raw_similarity_score: raw, keyword_boost: 0 }), storeId, franchiseId, scope: "store" };
  }

  function keywordRank(rows: readonly FixtureChunk[], question: string, keywords: readonly string[], storeId: string, franchiseId: string) {
    return rows.filter((row) => row.scope === "store" ? row.storeId === storeId : row.storeId === null && row.franchiseId === franchiseId)
      .map((row) => {
        const lowerQuestion = question.toLowerCase();
        const boost = row.title.toLowerCase().includes(lowerQuestion) ? 0.30
          : row.content.toLowerCase().includes(lowerQuestion) ? 0.25
          : keywords.some((term) => row.title.toLowerCase().includes(term.toLowerCase())) ? 0.25
          : keywords.some((term) => row.content.toLowerCase().includes(term.toLowerCase())) ? 0.20 : 0;
        return { ...row, keyword_boost: boost, similarity_score: Math.min(1, row.raw_similarity_score + boost) };
      }).sort((left, right) => right.similarity_score - left.similarity_score || right.raw_similarity_score - left.raw_similarity_score).slice(0, 5);
  }

  const cases = [
    { store: "isu", brand: "coffee", id: "hot-latte", title: "HOT 카페라떼", content: "합성 fixture: HOT 카페라떼 우유 180ml, 스팀 온도 60도. 실제 QA/매뉴얼 수치가 아니다.", raw: 0.48, questions: ["HOT 카페라떼의 우유량과 스팀 온도는 얼마인가요?", "따뜻한 라떼 우유 얼마나 넣고 몇 도까지 데워요?"] },
    { store: "noryangjin", brand: "burger", id: "clean", title: "튀김기 청소", content: cleaning, raw: 0.48, questions: ["튀김기 청소 어떻게 해?", "튀김기 청소는 어떻게 하면 좋아?", "튀김기 일반 청소 순서를 알려주세요."] },
    { store: "noryangjin", brand: "burger", id: "disassembly", title: "튀김기 내부 청소", content: disassembly, raw: 0.48, questions: ["튀김기 내부 부품을 분해해서 청소하는 순서를 알려주세요.", "튀김기 안쪽 부품 빼서 닦아도 돼요?"] },
    { store: "isu", brand: "coffee", id: "stock", title: "재고 및 발주", content: inventory, raw: 0.38, questions: ["재료나 물품의 재고가 부족할 때 직원은 어떤 순서로 처리하나요?", "우유가 거의 없는데 제가 바로 주문 넣어도 돼요?", "컵이 다 떨어졌는데 주문을 먼저 해도 돼요?"] },
    { store: "sindaebang", brand: "burger", id: "pack", title: "B 패밀리팩 전체 구성과 수량", content: bundle, raw: 0.50, questions: ["B 패밀리팩의 전체 구성과 수량은 무엇인가요?", "패밀리팩 주문 들어왔는데 버거랑 사이드랑 음료 몇 개씩 챙겨요?", "패밀리팩 음료 몇 잔 챙겨요?"] },
  ];

  for (const scenario of cases) {
    for (const question of scenario.questions) {
      test(`${scenario.id}: ${question}`, async () => {
        const own = fixture(scenario.id, scenario.title, scenario.content, scenario.raw, scenario.store, scenario.brand);
        const otherStore = { ...own, chunk_id: "other-store", storeId: "foreign-store", raw_similarity_score: 0.99 };
        const otherBrand = { ...own, chunk_id: "other-hq", storeId: null, scope: "hq" as const, franchiseId: "foreign-brand", raw_similarity_score: 0.99 };
        let candidates: ManualChunkMatch[] = [];
        let provided: ManualChunkMatch[] = [];
        const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question }, {
          async search(rawQuestion) {
            assert.equal(rawQuestion, question);
            assert.ok(formatSearchEmbeddingInput(rawQuestion).includes(question));
            candidates = keywordRank([own, otherStore, otherBrand], rawQuestion, extractSearchKeywords(rawQuestion), scenario.store, scenario.brand);
            return candidates;
          },
          async generate(rawQuestion, chunks) {
            provided = chunks;
            assert.equal(rawQuestion, question);
            assert.ok(buildGroundedAnswerMessages(rawQuestion, chunks)[1].content.endsWith(`[직원 질문]\n${question}`));
            assert.ok(chunks.every((item) => item.chunk_id === scenario.id));
            return JSON.stringify({ answerable: true, answer: scenario.content, usedChunkIds: [scenario.id] });
          },
        }));
        assert.deepEqual(candidates.map((item) => item.chunk_id), [scenario.id], "search fixture must exclude foreign scopes");
        if ((scenario.id === "hot-latte" && question.startsWith("따뜻한 라떼")) || (scenario.id === "pack" && question.startsWith("패밀리팩"))) {
          assert.deepEqual(provided, []);
          assert.ok(outcome.response.answer.startsWith(scenario.id === "pack" ? "어떤 종류의 패밀리팩을 말씀하시나요?" : "어떤 라떼 메뉴를 말씀하시나요?"));
          assert.equal(/180ml|60도|200g|300ml|버거 3개/u.test(outcome.response.answer), false);
          assert.equal(outcome.response.source?.manualId, own.manual_id);
          return;
        }
        assert.deepEqual(provided.map((item) => item.chunk_id), [scenario.id], "evidence gate must admit the intended candidate");
        assert.notEqual(outcome.response.status, "insufficient");
        assert.equal(outcome.escalate, false);
        assert.ok(outcome.response.answer.includes(scenario.content), "mock generation must survive response handling with all core facts");
        if (scenario.id === "stock") for (const fact of ["실제 재고", "추가 재고", "점주", "임의로 발주하지 않는다"]) assert.ok(outcome.response.answer.includes(fact));
        if (scenario.id === "pack") for (const fact of ["3개", "200g×2", "6개", "300ml×3"]) assert.ok(outcome.response.answer.includes(fact));
        if (scenario.id === "clean") assert.equal(outcome.response.answer.includes("분해"), false);
        if (scenario.id === "disassembly") assert.ok(outcome.response.answer.includes("임의로 분해하지 않는다"));
        if (scenario.id === "hot-latte") for (const fact of ["HOT", "180ml", "60도"]) assert.ok(outcome.response.answer.includes(fact));
      });
    }
  }

  test("fixed raw stock fixture crosses only the existing cautious gate after lexical coverage is added", () => {
    const question = "우유가 거의 없는데 제가 바로 주문 넣어도 돼요?";
    const own = fixture("stock", "재고 및 발주", inventory, 0.38, "isu", "coffee");
    const expanded = extractSearchKeywords(question);
    const baseline = expanded.filter((term) => !["재고", "재고 확인", "발주", "입고"].includes(term));
    const before = keywordRank([own], question, baseline, "isu", "coffee")[0];
    const after = keywordRank([own], question, expanded, "isu", "coffee")[0];
    assert.equal(before.keyword_boost, 0);
    assert.equal(after.keyword_boost, 0.25);
    assert.equal(after.raw_similarity_score, before.raw_similarity_score);
    assert.ok(before.raw_similarity_score < THRESHOLDS.cautious);
    assert.ok(after.raw_similarity_score + 0.15 >= THRESHOLDS.cautious);
    assert.ok(after.raw_similarity_score + 0.15 < THRESHOLDS.answered);
  });

  test("unknown policy, salary, discount and missing disassembly instructions stay withheld with mock abstention", async () => {
    for (const question of ["우리 매장 급여일이 언제예요?", "직원 할인은 몇 퍼센트예요?", "없는 정책도 그냥 알려줘", "튀김기 내부 부품을 푸는 정확한 분해 순서 알려줘"]) {
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question }, {
        search: async () => [chunk("safe-policy", { content: disassembly, raw_similarity_score: 0.8 })],
        generate: async () => JSON.stringify({ answerable: false, answer: "", usedChunkIds: [] }),
      }));
      assert.equal(outcome.response.status, "insufficient");
      assert.ok(outcome.response.answer.includes(NO_MANUAL_ANSWER));
      assert.ok(outcome.response.answer.includes(question));
      assert.equal(outcome.escalate, true);
    }
  });

  test("conditional evidence supports clarification without choosing size, pump volume or internal cleaning", async () => {
    const conditions = [
      { question: "세트 음료 몇 개 챙겨요?", content: "일반 세트 음료 300ml, 라지 세트 음료 500ml", answer: "일반 세트와 라지 세트 중 어느 규격인가요?", forbidden: /300|500/ },
      { question: "시럽 3펌프면 몇 ml예요?", content: "레시피: 시럽 3펌프. 펌프당 용량은 기재되어 있지 않다.", answer: "펌프당 용량을 확인할 수 있나요?", forbidden: /\d+\s*ml/ },
      { question: "튀김기 청소 어떻게 해?", content: disassembly, answer: "표면 청소와 내부 부품 청소 중 어느 부위를 청소하려고 하나요?", forbidden: /분해하지|제조사/ },
    ];
    for (const condition of conditions) {
      const outcome = expectResolved(await resolveRagAnswer({ ...INPUT, question: condition.question }, {
        search: async () => [chunk("conditional", { content: condition.content, raw_similarity_score: 0.7 })],
        generate: async () => JSON.stringify({ answerable: true, answer: condition.answer, usedChunkIds: ["conditional"] }),
      }));
      assert.equal(outcome.response.answer, condition.answer);
      assert.equal(condition.forbidden.test(outcome.response.answer), false);
      assert.equal(outcome.response.source?.manualId, "manual-conditional");
    }
  });
});

describe("actual query API POST handler with mocked external boundaries", () => {
  const storeId = "11111111-1111-4111-8111-111111111111";
  const franchiseId = "22222222-2222-4222-8222-222222222222";
  const source = readFileSync(new URL("../../app/api/rag/query/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const require = createRequire(import.meta.url);

  function api(options: { results: ManualChunkMatch[]; effectiveStoreId?: string; authorization?: string; scopeResolved?: boolean; generation?: string; searchError?: boolean; tracing?: boolean; previousQuestion?: string; contextDenied?: boolean; contextError?: boolean; embeddingStatus?: number; answerStatus?: number; finishReason?: string; rawGeneration?: boolean; development?: boolean; privateWriteError?: boolean; questionLogError?: boolean; interpretation?: { target: string; contextTarget: string | null; constraints: string[]; requirements: string[]; clarification: boolean }; interpretationError?: boolean }) {
    const storeId = options.effectiveStoreId ?? "11111111-1111-4111-8111-111111111111";
    const events = {
      searchCalls: [] as { question: string; storeId: string; franchiseId: string }[],
      modelCalls: [] as { model: string; messages: { content: string }[] }[],
      interpretationCalls: [] as { messages: { content: string }[] }[],
      logs: [] as { question: string; answer: string; status: string; storeId: string | null }[],
      followUps: [] as { storeId: string; escalate: boolean }[],
      completedFollowUps: 0,
      scopeCalls: 0,
      trace: [] as { stage?: string; reason?: string; [key: string]: unknown }[],
      validationLogs: [] as string[],
      contextReads: [] as { table: string; filters: Record<string, string> }[],
      privateTargetWrites: [] as { filePath: string; content: string }[],
      privateDecisionWrites: [] as { filePath: string; content: string; mode: number }[],
      privateCaptureLogs: [] as string[],
    };
    const contextClient = {
      from(table: string) {
        if (table === "manuals") {
          const query = { select: () => query, in: async () => ({ data: options.results.map(match => ({ id: match.manual_id,
            status: "approved", scope_type: "hq", store_id: null, franchise_id: franchiseId })), error: null }) };
          return query;
        }
        const filters: Record<string, string> = {};
        events.contextReads.push({ table, filters });
        const query = {
          select: () => query,
          eq: (field: string, value: string) => { filters[field] = value; return query; },
          order: (field: string, options: { ascending: boolean }) => { assert.equal(field, "created_at"); assert.equal(options.ascending, false); return query; },
          limit: (count: number) => { assert.ok(count === 1 || count === 4); return query; },
          then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve({ data: options.previousQuestion
            ? [{ role: "user", content: options.previousQuestion }] : [], error: options.contextError ? { code: "FIXTURE_READ_FAILED" } : null })),
          maybeSingle: async () => {
            if (options.contextError) return { data: null, error: { code: "FIXTURE_READ_FAILED" } };
            if (table === "conversations") {
              assert.equal(filters.user_id, "fixture-staff");
              assert.equal(filters.store_id, storeId);
              return { data: options.contextDenied ? null : { id: filters.id }, error: null };
            }
            assert.equal(table, "conversation_messages");
            assert.equal(filters.role, "user");
            return { data: options.previousQuestion === undefined ? null : { content: options.previousQuestion }, error: null };
          },
        };
        return query;
      },
    };
    const dependencies: Record<string, unknown> = {
      "next/server": require("next/server.js"),
      "node:fs": { appendFileSync: (filePath: string, content: string, config: { mode: number }) => {
        if (filePath.endsWith("rag-private-target-relations.jsonl")) events.privateTargetWrites.push({ filePath, content });
        if (filePath.endsWith("rag-private-decisions.jsonl")) {
          if (options.privateWriteError) throw new Error("private-fixture-storage-failure");
          events.privateDecisionWrites.push({ filePath, content, mode: config.mode });
        }
      } },
      "node:path": path,
      "@/lib/rag/answer-prompt": { buildGroundedAnswerMessages },
      "@/lib/rag/question-interpretation": require("../../lib/rag/question-interpretation.ts"),
      "@/lib/rag/trace-identifiers": require("../../lib/rag/trace-identifiers.ts"),
      "@/lib/rag/manual-menu-intent": { canUseFamilyPackHistory, priorFamilyPackVariant },
      "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "fixture-staff" } }, error: null }) } }) },
      "@/lib/rag/authorize-rag-store-access": {
        authorizeRagStoreAccessForRequest: async (requested: string) => { assert.equal(requested, storeId); return { status: options.authorization ?? "AUTHORIZED" }; },
        resolveRagStoreFranchiseForRequest: async (requested: string) => { events.scopeCalls++; assert.equal(requested, storeId); return options.scopeResolved === false ? { status: "UNRESOLVED" } : { status: "RESOLVED", franchiseId }; },
      },
      "@/lib/rag/finalize-rag-query-response": { finalizeRagQueryResponse },
      "@/lib/rag/resolve-rag-answer": { resolveRagAnswer },
      "@/lib/rag/structured-answer": require("../../lib/rag/structured-answer.ts"),
      "@/lib/rag/validate-query-request": { validateQueryRequest },
      "@/lib/rag/save-question-log": { saveQuestionLog: async (input: typeof events.logs[number]) => { events.logs.push(input); return options.questionLogError
        ? { saved: false, code: "QUESTION_LOG_SAVE_FAILED" } : { saved: true, questionLogId: "33333333-3333-4333-8333-333333333333" }; } },
      "@/lib/notifications/notify-repeated-question": { createQuestionLogFollowUp: (input: { storeId: string; escalate: boolean }) => { events.followUps.push({ storeId: input.storeId, escalate: input.escalate }); return async () => { events.completedFollowUps++; }; } },
      "@/lib/supabase/admin": { createAdminClient: () => contextClient },
      "@/lib/rag/search-manual-chunks": { searchManualChunks: async (question: string, requestedStore: string, requestedFranchise: string) => { events.searchCalls.push({ question, storeId: requestedStore, franchiseId: requestedFranchise }); if (options.embeddingStatus) throw Object.assign(new Error("MOCK_EMBEDDING_HTTP_FAILURE"), { diagnosticService: "embedding", diagnosticHttpStatus: options.embeddingStatus }); if (options.searchError) throw new Error("SEARCH_FIXTURE_FAILURE"); return options.results; } },
    };
    const routeModule = { exports: {} as { POST: (request: Request) => Promise<Response> } };
    new Script(compiled, { filename: "actual-rag-query-route.cjs" }).runInNewContext({
      module: routeModule,
      exports: routeModule.exports,
      require: (name: string) => { assert.ok(Object.hasOwn(dependencies, name), `Unmocked API dependency: ${name}`); return dependencies[name]; },
      process: { cwd: () => "C:\\fixture", env: { OPENAI_API_KEY: "fixture-only-not-a-real-key", NODE_ENV: options.tracing || options.development ? "development" : "test", RAG_TRACE: options.tracing ? "1" : undefined } },
      AbortController,
      URL,
      setTimeout,
      clearTimeout,
      console: { info: (label: string, event: typeof events.trace[number]) => {
        if (label === "[RAG_TRACE]") events.trace.push(event);
        if (label.startsWith("[RAG_VALIDATION] ")) events.validationLogs.push(label);
        if (label.startsWith("[RAG_PRIVATE_DECISION] ")) events.privateCaptureLogs.push(label);
      }, error: () => {} },
      fetch: async (url: string, init: RequestInit) => {
        assert.equal(url, "https://api.openai.com/v1/chat/completions");
        const requestBody = JSON.parse(init.body as string);
        if (requestBody.response_format?.json_schema?.name === "rag_question_interpretation") {
          events.interpretationCalls.push(requestBody);
          if (options.interpretationError) return { ok: false, status: 429, json: async () => ({}) };
          const input = JSON.parse(requestBody.messages[1].content);
          const target = input.recentMessages.filter((message: { role: string }) => message.role === "user").at(-1)?.content;
          const original = input.originalQuestion as string;
          const referential = /^(?:이거|그거|저거)|^그럼\s*개봉한/u.test(original);
          return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(options.interpretation ?? {
            target: referential ? "" : original, contextTarget: referential ? target ?? null : null, constraints: [],
            requirements: requestedSupportKinds(original), clarification: referential && !target,
          }) } }] }) };
        }
        events.modelCalls.push(JSON.parse(init.body as string));
        if (options.answerStatus) return { ok: false, status: options.answerStatus, json: async () => ({}) };
        assert.notEqual(options.generation, undefined, "Model must not be invoked for unresolved menus");
        let generation = options.generation!;
        try {
          const parsed = JSON.parse(generation);
          if (!options.rawGeneration && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            parsed.coverage ??= "direct";
            if (parsed.answerable && parsed.supportAssessment === undefined) {
              const messages = events.modelCalls.at(-1)!.messages;
              const question = messages[1].content.split("[직원 질문]\n").at(-1)!;
              const cited = options.results.filter((chunk) => parsed.usedChunkIds?.includes(chunk.chunk_id));
              parsed.supportAssessment = { requirements: requestedSupportKinds(question).map((kind) => ({ kind,
                support: parsed.coverage === "policy_only" ? "policy_only" : "direct",
                evidence: cited.map((chunk) => ({ chunkId: chunk.chunk_id, quote: chunk.content.slice(0, 120) })) })) };
            }
            if (parsed.answerable && parsed.supportAssessment) {
              const question = events.modelCalls.at(-1)!.messages[1].content.split("[직원 질문]\n").at(-1)!;
              parsed.supportAssessment.requestedTarget ??= question;
              for (const requirement of parsed.supportAssessment.requirements) for (const entry of requirement.evidence) {
                entry.role ??= requirement.support === "policy_only" ? "referral_policy" : requirement.kind;
                entry.target ??= options.results.find((chunk) => chunk.chunk_id === entry.chunkId)?.content.slice(0, 20) ?? "invalid";
                entry.targetRelation ??= "covers_requested";
              }
            }
            generation = JSON.stringify(parsed);
          }
        } catch { generation = options.generation!; }
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: generation }, finish_reason: options.finishReason ?? "stop" }] }) };
      },
    });
    return {
      events,
      postRequest: routeModule.exports.POST,
      post: (question: string) => routeModule.exports.POST(new Request("http://localhost:3001/api/rag/query", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, storeId, franchiseId: "untrusted-client-brand" }),
      })),
    };
  }

  test("actual generation payload requests strict per-question JSON schema rather than JSON mode", async () => {
    for (const question of ["유제품은 어떻게 보관해야 하나요?", "유제품 보관법", "물품 위치와 보관법", "마감 절차 알려줘", "마감 어케 해?"]) {
      const handler = api({ results: [chunk("payload", { content: "물품 보관 기준" })], rawGeneration: true,
        generation: JSON.stringify({ answerable: false, answer: "", usedChunkIds: [], coverage: "policy_only", supportAssessment: null }) });
      assert.equal((await handler.post(question)).status, 200);
      const payload = handler.events.modelCalls[0] as unknown as { response_format: {
        type: string; json_schema: { strict: boolean; schema: { properties: { supportAssessment: { anyOf: { properties?: {
          requirements: { minItems: number; maxItems: number; items: { properties: { kind: { enum: string[] } } } } } }[] } } } } } };
      assert.equal(payload.response_format.type, "json_schema");
      assert.equal(payload.response_format.json_schema.strict, true);
      const requirements = payload.response_format.json_schema.schema.properties.supportAssessment.anyOf[0].properties!.requirements;
      assert.deepEqual(requirements.items.properties.kind.enum, requestedSupportKinds(question));
      assert.equal(requirements.minItems, requestedSupportKinds(question).length);
      assert.equal(requirements.maxItems, requestedSupportKinds(question).length);
    }
  });

  test("actual query route asks an intent clarification for contextless open follow-up before model/search", async () => {
    const handler = api({ results: [], tracing: true });
    const response = await handler.post("그럼 개봉한 건?");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "insufficient");
    assert.match(body.answer, /위치.*개봉 후 관리 방법/u);
    assert.equal(handler.events.interpretationCalls.length, 0);
    assert.equal(handler.events.searchCalls.length, 0);
    assert.equal(handler.events.modelCalls.length, 0);
    assert.equal(body.responseKind, "clarification");
    assert.equal(handler.events.logs.length, 0);
    assert.equal(handler.events.completedFollowUps, 0);
    assert.equal(handler.events.trace.find(event => event.stage === "final")?.reason, "FOLLOW_UP_INTENT_AMBIGUOUS");
    assert.equal(JSON.stringify(handler.events.trace).includes("개봉한 건"), false);
  });

  test("strict schema does not replace the server check for duplicate requested kinds", async () => {
    const content = "물품은 밀봉하여 창고에 둔다.";
    const evidence = { chunkId: "duplicate", quote: content, role: "method", target: "물품", targetRelation: "same" };
    const handler = api({ results: [chunk("duplicate", { content })], rawGeneration: true, tracing: true,
      generation: JSON.stringify({ answerable: true, answer: content, coverage: "direct", usedChunkIds: ["duplicate"],
        supportAssessment: { requestedTarget: "물품", requirements: [
          { kind: "method", support: "direct", evidence: [evidence] }, { kind: "method", support: "direct", evidence: [evidence] },
        ] } }) });
    const response = await handler.post("물품 위치와 보관법");
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, "GENERATION_UNPARSABLE");
    assert.equal(handler.events.trace.find(event => event.stage === "support_validation")?.validationKind, "requirement_mismatch");
    assert.equal(handler.events.logs.length, 0);
    assert.equal(handler.events.followUps.length, 0);
    assert.equal(handler.events.modelCalls.length, 1);
  });

  test("target relation failure is written only to the private dev diagnostic sink", async () => {
    const question = "아이스 카페라떼 만들 때 우유 몇 ml 넣어?";
    const content = "HOT 카페라떼 우유 250ml\nICE 카페라떼 우유 240ml";
    const handler = api({ results: [chunk("private-target", { content })], development: true, rawGeneration: true,
      generation: JSON.stringify({ answerable: true, answer: "240ml", coverage: "direct", usedChunkIds: ["private-target"],
        supportAssessment: { requestedTarget: "아이스 카페라떼", requirements: [{ kind: "facts", support: "direct", evidence: [
          { chunkId: "private-target", quote: content, role: "facts", target: "HOT 카페라떼", targetRelation: "same" },
        ] }] } }) });
    const response = await handler.post(question);
    assert.equal(response.status, 500);
    const responseBody = await response.json();
    assert.deepEqual(Object.keys(responseBody).sort(), ["code", "error"]);
    assert.equal(JSON.stringify(responseBody).includes("아이스 카페라떼"), false);
    assert.equal(JSON.stringify(responseBody).includes("HOT 카페라떼"), false);
    assert.equal(handler.events.privateTargetWrites.length, 1);
    const record = JSON.parse(handler.events.privateTargetWrites[0].content);
    assert.equal(handler.events.privateTargetWrites[0].filePath, path.join("C:\\fixture", ".next", "dev", "rag-private-target-relations.jsonl"));
    assert.equal(record.traceId, response.headers.get("X-RAG-Trace-ID"));
    assert.equal(record.requestedTarget, "아이스 카페라떼");
    assert.equal(record.evidenceTarget, "HOT 카페라떼");
    assert.equal(record.targetRelation, "same");
    assert.equal(record.validationRule, "sameDeclaredSourceTarget:v3");
    assert.equal("quote" in record, false);
    assert.equal("question" in record, false);
    assert.equal("answer" in record, false);
    assert.equal(handler.events.validationLogs.some(line => line.includes("아이스 카페라떼") || line.includes("HOT 카페라떼")), false);

    const nonDevelopment = api({ results: [chunk("private-target-prod", { content })], rawGeneration: true,
      generation: JSON.stringify({ answerable: true, answer: "240ml", coverage: "direct", usedChunkIds: ["private-target-prod"],
        supportAssessment: { requestedTarget: "아이스 카페라떼", requirements: [{ kind: "facts", support: "direct", evidence: [
          { chunkId: "private-target-prod", quote: content, role: "facts", target: "HOT 카페라떼", targetRelation: "same" },
        ] }] } }) });
    const nonDevelopmentResponse = await nonDevelopment.post(question);
    assert.equal(nonDevelopmentResponse.status, 500);
    assert.equal(nonDevelopment.events.privateTargetWrites.length, 0);
  });

  test("private development decisions preserve bounded evidence metadata and final reasons without complete model output", async () => {
    const question = "유통기한 지난 우유 써도 돼?";
    const quote = "유통기한이 지난 식재료는 사용하지 않는다.";
    const generation = JSON.stringify({ answerable: true, answer: "private-full-model-answer-sentinel", coverage: "policy_only", usedChunkIds: ["private-decision"],
      supportAssessment: { requestedTarget: "우유", requirements: [
        { kind: "permission", support: "missing", evidence: [] },
        { kind: "conditions", support: "policy_only", evidence: [{ chunkId: "private-decision", quote, role: "referral_policy", target: "식재료", targetRelation: "covers_requested" }] },
      ] } });
    for (const development of [false, true]) for (const privateWriteError of [false, true]) {
      const handler = api({ results: [chunk("private-decision", { content: `${quote}\nprivate-full-chunk-sentinel` })],
        generation, rawGeneration: true, development, privateWriteError });
      const response = await handler.post(question);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.status, "answered");
      assert.equal(handler.events.privateDecisionWrites.length, development && !privateWriteError ? 1 : 0);
      assert.equal(handler.events.privateCaptureLogs.length, development ? 1 : 0);
      if (development) assert.equal(JSON.parse(handler.events.privateCaptureLogs[0].slice("[RAG_PRIVATE_DECISION] ".length)).captured, !privateWriteError);
      if (!development || privateWriteError) continue;
      const stored = handler.events.privateDecisionWrites[0];
      assert.equal(stored.mode, 0o600);
      assert.equal(stored.filePath, path.join("C:\\fixture", ".next", "dev", "rag-private-decisions.jsonl"));
      const record = JSON.parse(stored.content);
      assert.equal(record.traceId, response.headers.get("X-RAG-Trace-ID"));
      assert.equal(record.metadataAvailable, true);
      assert.deepEqual(record.review.expectedRequirementKinds, ["permission", "conditions"]);
      assert.equal(record.review.requirements[1].support, "policy_only");
      assert.equal(record.review.requirements[1].evidence[0].role, "referral_policy");
      assert.equal(record.review.requirements[1].evidence[0].relation, "covers_requested");
      assert.equal(record.review.requirements[1].evidence[0].quotePresent, true);
      assert.equal(record.review.requirements[1].evidence[0].policyLinked, true);
      assert.deepEqual(record.review.directKinds, ["permission", "conditions"]);
      assert.equal(record.final.reason, "SUPPORTED_ANSWER");
      assert.equal(stored.content.includes("private-full-model-answer-sentinel"), false);
      assert.equal(stored.content.includes("private-full-chunk-sentinel"), false);
      assert.equal(stored.content.includes(question), false);
      assert.equal(handler.events.validationLogs.some(line => line.includes(quote)), false);
    }
    const missing = api({ results: [], development: true });
    await missing.post(question);
    assert.equal(JSON.parse(missing.events.privateDecisionWrites[0].content).metadataAvailable, false);
    assert.equal(JSON.parse(missing.events.privateDecisionWrites[0].content).final.reason, "NO_SEARCH_CANDIDATES");
    const rejection = api({ results: [chunk("private-decision", { content: quote })], generation: generation.replace(quote, "unquoted-evidence"),
      rawGeneration: true, development: true });
    const response = await rejection.post(question);
    assert.equal(response.status, 500);
    const rejected = JSON.parse(rejection.events.privateDecisionWrites[0].content);
    assert.equal(rejected.review.validation, "rejected");
    assert.equal(rejected.review.failure.validationKind, "quote_mismatch");
    assert.equal(rejected.final.reason, "GENERATION_UNPARSABLE");
  });

  test("formal and colloquial workflow requests keep the same scoped procedure contract and original text", async () => {
    const content = "마감 절차: 재고를 확인하고 청소한 뒤 전원을 점검한다.";
    for (const question of ["마감 절차 알려줘", "마감 어케 해?"]) {
      const handler = api({ results: [chunk("workflow", { content })], rawGeneration: true,
        generation: JSON.stringify({ answerable: true, answer: content, coverage: "direct", usedChunkIds: ["workflow"],
          supportAssessment: { requestedTarget: "마감", requirements: [{ kind: "procedure", support: "direct", evidence: [
            { chunkId: "workflow", quote: content, role: "procedure", target: "마감", targetRelation: "same" },
          ] }] } }) });
      const response = await handler.post(question);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.status, "answered");
      assert.equal(body.answer, content);
      assert.deepEqual(handler.events.searchCalls, [{ question, storeId, franchiseId }]);
      assert.ok(handler.events.modelCalls[0].messages[0].content.endsWith("서버 지정 요구 항목: procedure."));
      assert.ok(handler.events.modelCalls[0].messages[1].content.endsWith(`[직원 질문]\n${question}`));
    }
    const unclear = api({ results: [] });
    const response = await unclear.post("이거 써도 됨?");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(body.answer.includes("대상"));
    assert.equal(unclear.events.searchCalls.length, 0);
    assert.equal(unclear.events.modelCalls.length, 0);
    assert.equal(unclear.events.followUps[0].escalate, false);
  });

  function staffChat(rag: ReturnType<typeof api>, savedStoreId?: string, createError?: { code: string; message: string }) {
    const chatSource = readFileSync(new URL("../../app/api/staff/chat/route.ts", import.meta.url), "utf8");
    const chatCompiled = ts.transpileModule(chatSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const trace: { phase?: string; conversationTag?: string | null; requestOrigin: string; effectiveStoreId: string; storeSource: string }[] = [];
    const forwardedUrls: string[] = [];
    const errors: string[] = [];
    const fakeAdmin = {
      from() {
        const query = {
          error: null,
          select: () => query, eq: () => query, insert: () => query, update: () => query,
          maybeSingle: async () => ({ data: { id: "conversation", store_id: savedStoreId ?? storeId }, error: null }),
          single: async () => ({ data: { id: "44444444-4444-4444-8444-444444444444" }, error: createError ?? null }),
        };
        return query;
      },
    };
    const dependencies: Record<string, unknown> = {
      "next/server": require("next/server.js"),
      "@/app/api/rag/query/route": { POST: async (request: Request) => { forwardedUrls.push(request.url); return rag.postRequest(request); } },
      "@/lib/rag/trace-identifiers": { conversationTraceTag },
      "@/lib/staff/conversations": { ...require("../../lib/staff/conversations.ts"), buildConversationTitle: () => "fixture", isMissingConversationTable: () => false },
      "@/lib/supabase/admin": { createAdminClient: () => fakeAdmin },
      "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "fixture-staff" } }, error: null }) } }) },
    };
    const chatModule = { exports: {} as { POST: (request: Request) => Promise<Response> } };
    new Script(chatCompiled, { filename: "actual-staff-chat-route.cjs" }).runInNewContext({
      module: chatModule, exports: chatModule.exports, Request, URL, Date,
      require: (name: string) => { assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name]; },
      process: { env: { NODE_ENV: "development", RAG_TRACE: "1" } },
      console: { info: (_label: string, event: typeof trace[number]) => trace.push(event), error: (...args: unknown[]) => errors.push(JSON.stringify(args)) },
    });
    return { trace, forwardedUrls, errors, post: (question: string, requestedStoreId: string, conversationId?: string) => chatModule.exports.POST(new Request("http://localhost:3001/api/staff/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, storeId: requestedStoreId, conversationId }),
    })) };
  }

  test("staff handler invokes private decision capture through the actual RAG route for metadata variants, exception and uncertain state", async () => {
    const quote = "유통기한이 지난 식재료는 사용하지 않는다.";
    for (const scenario of ["permission-policy", "conditions-role", "exception", "uncertain"]) {
      const uncertain = scenario === "uncertain";
      const question = uncertain ? "식재료의 상태가 확실하지 않은 경우 누구에게 확인하나요?" : "유통기한 지난 우유 써도 돼?";
      const selectedQuote = uncertain ? "식재료의 상태가 확실하지 않은 경우 사장님에게 확인한다." : quote;
      const requirements = uncertain ? [{ kind: "referral", support: "direct", evidence: [
        { chunkId: "staff-private", quote: selectedQuote, role: "referral_policy", target: "식재료", targetRelation: "same" },
      ] }] : ["permission", "conditions"].map(kind => {
        const allocated = scenario === "permission-policy" ? kind === "permission" : kind === "conditions";
        return { kind, support: allocated ? "policy_only" : "missing", evidence: allocated ? [
          { chunkId: "staff-private", quote: selectedQuote, role: scenario === "permission-policy" ? "permission" : "referral_policy",
            target: "식재료", targetRelation: "covers_requested" },
        ] : [] };
      });
      const handler = api({ development: true, rawGeneration: true,
        results: [chunk("staff-private", { content: selectedQuote + (scenario === "exception" ? "\n단, 승인받은 경우는 예외다." : "") })],
        generation: JSON.stringify({ answerable: true, answer: uncertain ? "사장님에게 확인하세요." : "미검증 모델 본문", coverage: uncertain ? "direct" : "policy_only",
          usedChunkIds: ["staff-private"], supportAssessment: { requestedTarget: uncertain ? "식재료" : "우유", requirements } }),
      });
      const chat = staffChat(handler);
      const response = await chat.post(question, storeId);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(chat.forwardedUrls.length, 1);
      assert.equal(handler.events.modelCalls.length, 1);
      assert.equal(handler.events.interpretationCalls.length, 0);
      assert.equal(handler.events.privateDecisionWrites.length, 1);
      const projection = JSON.parse(handler.events.privateDecisionWrites[0].content);
      assert.equal(projection.traceId, response.headers.get("X-RAG-Trace-ID"));
      assert.equal(projection.metadataAvailable, true);
      assert.equal(projection.final.status, body.status);
      assert.equal(projection.final.reason, scenario === "exception" ? "POLICY_ONLY_COVERAGE" : "SUPPORTED_ANSWER");
      assert.equal(body.status, scenario === "exception" ? "insufficient" : "answered");
      assert.equal(handler.events.logs[0].answer, body.answer);
      if (uncertain) {
        assert.ok(body.answer.includes("사장님에게 확인"));
        assert.deepEqual(projection.review.directKinds, ["referral"]);
      } else if (scenario === "exception") {
        assert.deepEqual(projection.review.directKinds, []);
        assert.equal(projection.review.stateConditionCovered, false);
      } else {
        assert.ok(body.answer.includes("사용하면 안 돼요"));
        assert.deepEqual(projection.review.directKinds, ["permission", "conditions"]);
        assert.equal(projection.review.stateConditionCovered, true);
      }
      assert.equal(handler.events.validationLogs.some(line => line.includes(selectedQuote)), false);
    }
  });

  test("A-D candidate staff flow uses store-specific locations, opened follow-up limits and HQ iced recipe", async () => {
    const soongsil = storeId;
    const isu = "99999999-9999-4999-8999-999999999999";
    for (const [requestedStore, side] of [[soongsil, "오른쪽"], [isu, "왼쪽"]]) {
      const handler = api({ effectiveStoreId: requestedStore, results: [chunk(`location-${side}`, {
        title: "재고 및 비품 보관 위치", content: `우유: 냉장고 ${side} 선반`, raw_similarity_score: .7,
      })] });
      const response = await staffChat(handler).post("우유 어디 둬?", requestedStore);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.ok(body.answer.includes(side));
      assert.equal(body.storeId, requestedStore);
      assert.equal(handler.events.searchCalls[0].storeId, requestedStore);
      assert.equal(handler.events.logs[0].storeId, requestedStore);
      assert.equal(handler.events.interpretationCalls.length, 0);
      assert.equal(handler.events.modelCalls.length, 0);
    }
    const policy = "매뉴얼에 없는 재료의 보관 방법은 사장님에게 확인한다.";
    const followQuestion = "그럼 개봉한 우유는 어떻게 관리해?";
    const follow = api({ results: [chunk("opened-policy", { content: policy })], previousQuestion: "우유 어디 둬?", rawGeneration: true,
      interpretation: { target: "", contextTarget: "우유", constraints: ["개봉한"], requirements: ["conditions", "method"], clarification: false },
      generation: JSON.stringify({ answerable: true, answer: policy, coverage: "policy_only", usedChunkIds: ["opened-policy"],
        supportAssessment: { requestedTarget: "우유", requirements: [
          { kind: "conditions", support: "missing", evidence: [] },
          { kind: "method", support: "policy_only", evidence: [{ chunkId: "opened-policy", quote: policy, role: "referral_policy", target: "재료", targetRelation: "covers_requested" }] },
        ] } }) });
    const followed = await staffChat(follow, soongsil).post(followQuestion, soongsil, "44444444-4444-4444-8444-444444444444");
    const followBody = await followed.json();
    assert.equal(followed.status, 200);
    assert.equal(followBody.status, "insufficient");
    assert.ok(followBody.answer.includes("구체적인 수행 방법"));
    assert.equal(/\d+\s*(?:일|시간|℃)/u.test(followBody.answer), false);
    assert.equal(follow.events.interpretationCalls.length, 1);
    assert.equal(follow.events.modelCalls.length, 1);
    assert.equal(follow.events.searchCalls[0].question, `${followQuestion}\n확인된 이전 질문 대상: 우유\n확인된 현재 질문 조건: 개봉한`);
  assert.ok(follow.events.modelCalls[0].messages[0].content.endsWith("서버 지정 요구 항목: conditions, method."));
    const recipe = "ICE 카페라떼\n우유 240ml";
    const drink = api({ results: [chunk("hq-iced", { title: "본사 음료 제조", content: recipe }),
      chunk("store-location", { title: "비품 보관 위치", content: "우유: 냉장고 오른쪽 선반" })], rawGeneration: true,
      generation: JSON.stringify({ answerable: true, answer: "아이스 카페라떼에는 우유 240ml를 넣어요.", coverage: "direct", usedChunkIds: ["hq-iced"],
        supportAssessment: { requestedTarget: "카페라떼", requirements: [{ kind: "facts", support: "direct", evidence: [
          { chunkId: "hq-iced", quote: recipe, role: "facts", target: "카페라떼", targetRelation: "same" },
        ] }] } }) });
    const drinkResponse = await staffChat(drink).post("아이스 카페라떼 만들 때 우유 몇 ml 넣어?", soongsil);
    const drinkBody = await drinkResponse.json();
    assert.equal(drinkResponse.status, 200);
    assert.equal(drinkBody.answer, "아이스 카페라떼에는 우유 240ml를 넣어요.");
    assert.equal(drinkBody.source.title, "본사 음료 제조");
    assert.equal(drinkBody.sources.length, 1);
    assert.equal(drink.events.interpretationCalls.length, 0);
    assert.equal(drink.events.modelCalls.length, 1);
  });

  test("staff API loads only owned same-store context and passes interpreted requirements to search, schema, answer and logs", async () => {
    const question = "그럼 개봉한 건 어떻게 해?";
    const content = "개봉한 우유는 뚜껑을 닫아 냉장 보관한다.";
    for (const denied of [false, true]) {
      const handler = api({ results: [chunk("opened-api", { content })], contextDenied: denied, previousQuestion: "우유 보관법", tracing: true,
        rawGeneration: true, interpretation: denied ? { target: "", contextTarget: null, constraints: ["개봉한"], requirements: ["conditions", "method"], clarification: true }
          : { target: "", contextTarget: "우유", constraints: ["개봉한"], requirements: ["conditions", "method"], clarification: false },
        generation: JSON.stringify({ answerable: true, answer: content, coverage: "direct", usedChunkIds: ["opened-api"],
          supportAssessment: { requestedTarget: "우유", requirements: [
            { kind: "conditions", support: "direct", evidence: [{ chunkId: "opened-api", quote: content, role: "conditions", target: "우유", targetRelation: "same" }] },
            { kind: "method", support: "direct", evidence: [{ chunkId: "opened-api", quote: content, role: "method", target: "우유", targetRelation: "same" }] },
          ] } }) });
      const response = await staffChat(handler, storeId).post(question, "99999999-9999-4999-8999-999999999999", "44444444-4444-4444-8444-444444444444");
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.storeId, storeId);
      assert.equal(handler.events.interpretationCalls.length, 1);
      const contextInput = JSON.parse(handler.events.interpretationCalls[0].messages[1].content);
      assert.equal(contextInput.recentMessages.length, denied ? 0 : 1);
      const ownership = handler.events.contextReads.find(read => read.table === "conversations")!;
      assert.equal(ownership.filters.user_id, "fixture-staff");
      assert.equal(ownership.filters.store_id, storeId);
      assert.equal(body.status, denied ? "insufficient" : "answered");
      assert.equal(handler.events.searchCalls.length, denied ? 0 : 1);
      assert.equal(handler.events.modelCalls.length, denied ? 0 : 1);
      assert.equal(handler.events.logs.length, denied ? 0 : 1);
      if (denied) assert.equal(handler.events.completedFollowUps, 0);
      if (!denied) {
        assert.equal(handler.events.logs[0].question, question);
        assert.equal(handler.events.logs[0].storeId, storeId);
        assert.equal(handler.events.searchCalls[0].question, `${question}\n확인된 이전 질문 대상: 우유\n확인된 현재 질문 조건: 개봉한`);
        assert.ok(handler.events.modelCalls[0].messages[0].content.endsWith("서버 지정 요구 항목: conditions, method."));
        const prompt = handler.events.modelCalls[0].messages[1].content;
        assert.ok(prompt.includes('[서버가 검증한 질문 해석]'));
        assert.ok(prompt.includes('"contextTarget":"우유"'));
        assert.ok(prompt.includes('"constraints":["개봉한"]'));
        assert.ok(prompt.includes("이전 위치 의도를 자동으로 고정하지 마세요"));
        assert.ok(body.answer.includes("개봉한 우유"));
        const delivery = handler.events.validationLogs.map(line => JSON.parse(line.slice("[RAG_VALIDATION] ".length)))
          .filter(event => event.stage === "condition_delivery");
        assert.equal(delivery.length, 2);
        assert.ok(delivery.every(event => event.conditionCount === 1 && event.contextTargetPresent === true && event.conditionsIncluded === true));
        assert.equal(JSON.stringify(delivery).includes("우유"), false);
        assert.equal(JSON.stringify(delivery).includes("개봉한"), false);
      }
    }
    const failed = api({ results: [], interpretationError: true });
    const response = await staffChat(failed).post("이거 써도 됨?", storeId);
    assert.equal(response.status, 500);
    assert.equal(failed.events.interpretationCalls.length, 1);
    assert.equal(failed.events.searchCalls.length, 0);
    assert.equal(failed.events.logs.length, 0);
    assert.equal(failed.events.followUps.length, 0);
  });

  test("B staff diagnostics distinguish interpretation anchor failures from answer generation and remain private", async () => {
    const handler = api({ results: [], previousQuestion: "우유 어디 둬?", development: true,
      interpretation: { target: "우유", contextTarget: "우유", constraints: ["개봉한"], requirements: ["method"], clarification: false } });
    const response = await staffChat(handler, storeId).post("그럼 개봉한 건 어떻게 해?", storeId, "44444444-4444-4444-8444-444444444444");
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, "GENERATION_UNPARSABLE");
    const logs = handler.events.validationLogs.map(line => JSON.parse(line.slice("[RAG_VALIDATION] ".length)));
    const failure = logs.find(event => event.stage === "interpretation_validation" && event.validationKind);
    assert.ok(failure);
    assert.equal(failure.service, "interpretation");
    assert.equal(failure.fieldPath, "interpretation.target");
    assert.equal(failure.validationKind, "question_target_mismatch");
    assert.equal(failure.failureLayer, "question_interpretation");
    assert.ok(logs.every(event => event.traceId === failure.traceId));
    assert.equal(JSON.stringify(logs).includes("우유"), false);
    assert.equal(JSON.stringify(logs).includes("개봉한"), false);
    assert.equal(handler.events.interpretationCalls.length, 1);
    assert.equal(handler.events.modelCalls.length, 0);
    assert.equal(handler.events.searchCalls.length, 0);
    assert.equal(handler.events.logs.length, 0);
    assert.equal(handler.events.followUps.length, 0);
    const valid = { target: "", contextTarget: "우유", constraints: ["개봉한"], requirements: ["conditions", "method"], clarification: false };
    const interpreter = createQuestionInterpreter(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop",
      message: { content: JSON.stringify(valid) } }] })), "fixture-key", () => { throw new Error("capture failed"); });
    assert.deepEqual(await interpreter("그럼 개봉한 건 어떻게 해?", [{ role: "user", content: "우유 어디 둬?" }]), valid);
    for (const [status, expectedKind] of [[429, "service_http_error"], [200, "response_truncated"]] as const) {
      const safe: Record<string, unknown>[] = [];
      const failed = createQuestionInterpreter(async () => status === 429 ? new Response("private service detail", { status })
        : new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "private incomplete content" } }] })),
      "fixture-key", event => safe.push(event));
      await assert.rejects(failed("그럼 개봉한 건?", []), error => error instanceof StructuredAnswerParseError
        && error.fieldPath === "interpretation.$" && error.validationKind === expectedKind);
      assert.equal(safe.at(-1)?.stage, "interpretation_validation");
      assert.equal(JSON.stringify(safe).includes("private"), false);
    }
  });

  test("source-backed particle spelling does not require an identity declaration and never equates a category to a member", async () => {
    for (const [question, target, sourceTarget, valid] of [
      ["우유는 어디에 두나요?", "우유는", "우유", true],
      ["우유는 어디에 두나요?", "우유", "우유는", true],
      ["유제품은 어떻게 보관하나요?", "유제품은", "우유", false],
    ] as const) {
      const content = `${sourceTarget} 창고 선반에 둔다.`;
      const handler = api({ results: [chunk("particle", { content })], rawGeneration: true,
        generation: JSON.stringify({ answerable: true, answer: content, coverage: "direct", usedChunkIds: ["particle"],
          supportAssessment: { requestedTarget: target, requirements: [{ kind: requestedSupportKinds(question)[0], support: "direct", evidence: [
            { chunkId: "particle", quote: content, role: requestedSupportKinds(question)[0], target: sourceTarget, targetRelation: "same" },
          ] }] } }) });
      assert.equal((await handler.post(question)).status, valid ? 200 : 500);
    }
  });

  test("actual staff/chat on 3001 passes the new request store and the saved conversation store to the actual RAG handler", async () => {
    for (const existing of [false, true]) {
      const handler = api({ results: [chunk("cafe", { title: "음료 제조", content: "4-3. 카페라떼\n우유 240ml, 스팀60~65℃.", raw_similarity_score: 0.408392, keyword_boost: 0.2 })], generation: '{"answerable":true,"answer":"우유 240ml, 스팀60~65℃.","usedChunkIds":["cafe"]}', tracing: true });
      const chat = staffChat(handler, existing ? storeId : undefined);
      const requestedStore = existing ? "99999999-9999-4999-8999-999999999999" : storeId;
      const question = "따뜻한 카페라떼 우유 얼마나 넣고 몇 도까지 데워요?";
      const response = await chat.post(question, requestedStore, existing ? "conversation" : undefined);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.storeId, storeId);
      assert.equal(body.status, "cautious");
      assert.ok(body.answer.includes("240ml"));
      assert.deepEqual(chat.forwardedUrls, ["http://localhost:3001/api/rag/query"]);
      assert.equal(chat.trace[0].requestOrigin, "http://localhost:3001");
      assert.equal(chat.trace[0].effectiveStoreId, storeId);
      assert.equal(chat.trace[0].effectiveStoreId, storeId);
      assert.equal(chat.trace[0].storeSource, existing ? "saved_conversation" : "new_request");
      assert.deepEqual(handler.events.searchCalls, [{ question, storeId, franchiseId }]);
      assert.equal(handler.events.trace.find((event) => event.stage === "menu_filter")?.afterCount, 1);
      assert.equal(handler.events.trace.find((event) => event.stage === "final")?.reason, "SUPPORTED_ANSWER");
    }
  });

  test("actual RAG and staff APIs forward only the fixed question-log failure warning while keeping the answer", async () => {
    for (const failed of [false, true]) {
      const handler = api({ results: [], questionLogError: failed });
      const response = await staffChat(handler).post("fixture question", storeId);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.status, "insufficient");
      assert.ok(body.answer.includes(NO_MANUAL_ANSWER));
      assert.ok(body.answer.includes("fixture question"));
      assert.equal(body.questionLogSaveError, failed ? "QUESTION_LOG_SAVE_FAILED" : undefined);
      assert.equal(body.historyAvailable, true);
      assert.equal(handler.events.logs.length, 1);
      assert.equal(handler.events.modelCalls.length, 0);
    }
  });

  test("developer trace header correlates staff responses while disabled tracing stays absent and save errors remain private", async () => {
    for (const tracing of [true, false]) {
      const handler = api({ results: [chunk("c1")], generation: '{"answerable":true,"answer":"fixture answer","usedChunkIds":["c1"]}', tracing });
      const privateValue = "private-person@example.test 010-1234-5678 sk-fixture-private";
      const chat = staffChat(handler, undefined, { code: "FIXTURE_FAILED", message: privateValue });
      const response = await chat.post("fixture question", storeId);
      const body = await response.json();
      assert.equal(body.historyAvailable, false);
      assert.equal(body.answer, "fixture answer");
      const traceId = response.headers.get("X-RAG-Trace-ID");
      if (tracing) assert.equal(traceId, handler.events.trace[0].traceId);
      else assert.equal(traceId, null);
      assert.equal(JSON.stringify(chat.errors).includes(privateValue), false);
      assert.equal(JSON.stringify(chat.errors).includes("fixture-staff"), false);
      assert.equal(JSON.stringify(chat.errors).includes("stack"), false);
      assert.ok(JSON.stringify(chat.errors).includes("CONVERSATION_SAVE_FAILED"));
    }
  });

  test("raw model schema omissions, bad scope and truncation return safe 500 codes with no persistence or automatic retry", async () => {
    const content = "물품은 창고에 둔다.";
    const good = { answerable: true, answer: content, coverage: "direct", usedChunkIds: ["scope"], supportAssessment: {
      requestedTarget: "물품", requirements: [{ kind: "location", support: "direct", evidence: [
        { chunkId: "scope", quote: content, role: "location", target: "물품", targetRelation: "same" },
      ] }],
    } };
    const cases = [
      { generation: JSON.stringify({ ...good, supportAssessment: undefined }), field: "supportAssessment", kind: "missing_field" },
      { generation: JSON.stringify({ ...good, supportAssessment: { ...good.supportAssessment, requestedTarget: undefined } }), field: "supportAssessment.requestedTarget", kind: "missing_or_invalid_target" },
      { generation: '{"answerable":true', field: "$", kind: "invalid_json" },
      { generation: JSON.stringify(good), finishReason: "length", field: "$", kind: "response_truncated" },
      { generation: "", finishReason: "content_filter", field: "$", kind: "empty_response" },
    ];
    for (const scenario of cases) {
      const handler = api({ results: [chunk("scope", { content })], tracing: true, rawGeneration: true,
        generation: scenario.generation, finishReason: scenario.finishReason });
      const response = await staffChat(handler).post("물품은 어디에 두나요?", storeId);
      const body = await response.json();
      assert.equal(response.status, 500);
      assert.equal(body.code, "GENERATION_UNPARSABLE");
      assert.equal(body.answer, undefined);
      const failure = handler.events.trace.find((event) => event.stage === "structured_validation" && event.validation === "rejected");
      assert.equal(failure?.fieldPath, scenario.field);
      assert.equal(failure?.validationKind, scenario.kind);
      assert.equal(failure?.failureLayer, scenario.kind === "invalid_json" ? "json_parse"
        : ["response_truncated", "empty_response"].includes(scenario.kind) ? "model_completion" : "response_schema");
      assert.equal(handler.events.trace.find((event) => event.stage === "model_completion")?.finishReason, scenario.finishReason ?? "stop");
      assert.equal(handler.events.modelCalls.length, 1);
      assert.equal(handler.events.logs.length, 0);
      assert.equal(handler.events.followUps.length, 0);
      assert.equal(JSON.stringify(handler.events.trace).includes(content), false);
    }
    for (const status of ["direct", "partial", "policy_only"] as const) {
      const support = status === "direct" ? "direct" : "policy_only";
      const handler = api({ results: [chunk("scope", { content })], tracing: true, rawGeneration: true,
        generation: JSON.stringify({ ...good, coverage: status, supportAssessment: { ...good.supportAssessment,
          requirements: [{ kind: "location", support, evidence: [{ ...good.supportAssessment.requirements[0].evidence[0], role: support === "direct" ? "location" : "referral_policy" }] }] } }) });
      const response = await handler.post("물품은 어디에 두나요?");
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.status, status === "direct" ? "answered" : "insufficient");
      assert.equal(handler.events.logs.length, 1);
    }
  });

  test("development records only safe validation and finish details when full RAG_TRACE is disabled", async () => {
    const handler = api({ results: [chunk("c1")], generation: '{"answerable":true,"answer":"private@example.test sk-fixture-only","coverage":"direct","usedChunkIds":["c1"]}',
      rawGeneration: true, development: true });
    const response = await handler.post("fixture question");
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, "GENERATION_UNPARSABLE");
    assert.equal(handler.events.trace.length, 0);
    assert.match(response.headers.get("X-RAG-Trace-ID") ?? "", /^[0-9a-f-]{36}$/);
    const logs = handler.events.validationLogs.map((line) => JSON.parse(line.slice("[RAG_VALIDATION] ".length)));
    assert.equal(logs.find((event) => event.stage === "model_completion")?.finishReason, "stop");
    assert.ok(logs.every(event => typeof event.observedAt === "string" && Number.isFinite(Date.parse(event.observedAt))));
    assert.equal(logs.find((event) => event.stage === "structured_validation")?.fieldPath, "supportAssessment");
    assert.equal(logs.find((event) => event.stage === "structured_validation")?.validationKind, "missing_field");
    assert.equal(logs.find((event) => event.stage === "structured_validation")?.failureLayer, "response_schema");
    assert.equal(JSON.stringify(logs).includes("private@example.test"), false);
    assert.equal(JSON.stringify(logs).includes("fixture question"), false);
    assert.equal(handler.events.logs.length, 0);
    assert.equal(handler.events.modelCalls.length, 1);
  });

  test("default development diagnostics preserve expected and received enum kinds without raw values", async () => {
    for (const invalidCoverage of [false, true]) {
      const handler = api({ results: [chunk("diagnostic", { content: "물품: 선반" })], rawGeneration: true, development: true,
        generation: JSON.stringify({ answerable: true, answer: "private-fixture", coverage: invalidCoverage ? "private-invalid-enum" : "direct",
          usedChunkIds: ["diagnostic"], supportAssessment: { requestedTarget: "물품", requirements: [{ kind: "location", support: "direct",
            evidence: [{ chunkId: "diagnostic", quote: "물품: 선반", role: "location", target: "물품", targetRelation: "same" }] }] } }),
      });
      assert.equal((await handler.post("물품 보관법")).status, 500);
      const logs = handler.events.validationLogs.map(line => JSON.parse(line.slice("[RAG_VALIDATION] ".length)));
      const failed = logs.find(event => event.validationKind);
      if (invalidCoverage) {
        assert.deepEqual(failed.allowedCoverageValues, ["direct", "partial", "policy_only", "clarification"]);
      } else {
        assert.deepEqual(failed.expectedRequirementKinds, ["method"]);
        assert.deepEqual(failed.receivedRequirementKinds, ["location"]);
        assert.equal(failed.requestedCount, 1);
        assert.equal(failed.receivedCount, 1);
      }
      assert.equal(typeof failed.storeTag, "string");
      assert.equal(failed.conversationTag, null);
      assert.equal(JSON.stringify(logs).includes("private"), false);
      assert.equal(JSON.stringify(logs).includes(storeId), false);
      assert.equal(JSON.stringify(logs).includes("물품"), false);
    }
    const safe: Record<string, unknown>[] = [];
    const trace = createRagDiagnosticTrace({ enabled: true, storeId: null, conversationId: null, emit: event => safe.push(event) });
    trace({ stage: "support_validation", expectedRequirementKinds: ["method", "private"], receivedRequirementKinds: ["location", {}],
      allowedCoverageValues: ["partial", "private"] });
    assert.deepEqual(safe[0].expectedRequirementKinds, ["method"]);
    assert.deepEqual(safe[0].receivedRequirementKinds, ["location"]);
    assert.deepEqual(safe[0].allowedCoverageValues, ["partial"]);
  });

  test("synthetic validation failures retain their first stage and 500 contract without history, persistence or retry", async () => {
    const fixture = JSON.parse(readFileSync(new URL("./synthetic-support-cases.json", import.meta.url), "utf8"));
    const content = "물품: 창고 선반";
    for (const observed of fixture.validationFailures.cases) {
      const handler = api({ results: [chunk("live-fixture", { title: "보관 위치", content })], tracing: true, rawGeneration: true,
        finishReason: observed.finishReason, generation: JSON.stringify({ answerable: true, answer: content,
          coverage: observed.validationKind === "invalid_enum" ? "invalid-fixture-value" : "direct", usedChunkIds: ["live-fixture"],
          supportAssessment: { requestedTarget: "물품", requirements: [{ kind: "location", support: "direct", evidence: [
            { chunkId: "live-fixture", quote: content, role: "location", target: "물품", targetRelation: "same" },
          ] }] } }),
      });
      const response = await staffChat(handler, storeId).post("물품 보관법", storeId, "conversation");
      assert.equal(response.status, 500);
      const body = await response.json();
      assert.equal(body.code, "GENERATION_UNPARSABLE");
      assert.equal(body.answer, undefined);
      const failed = handler.events.trace.find(event => event.validation === "rejected");
      assert.equal(failed?.stage, observed.stage);
      assert.equal(failed?.fieldPath, observed.fieldPath);
      assert.equal(failed?.validationKind, observed.validationKind);
      assert.equal(failed?.failureLayer, observed.failureLayer);
      assert.equal(handler.events.modelCalls.length, 1);
      assert.equal(handler.events.logs.length, 0);
      assert.equal(handler.events.followUps.length, 0);
      assert.equal(handler.events.contextReads.length, 0);
      assert.equal(handler.events.trace.find(event => event.stage === "history")?.reason, "NOT_A_CONTEXT_FOLLOW_UP");
      assert.equal(handler.events.trace.find(event => event.stage === "search_input")?.augmented, false);
    }
  });

  test("short method requests keep narrow location partial and accept genuinely supported methods", async () => {
    for (const direct of [false, true]) {
      const content = direct ? "물품은 밀봉한 뒤 창고에 보관한다." : "테스트 봉투: 창고 선반";
      const handler = api({ results: [chunk("short-method", { content })], tracing: true, rawGeneration: true,
        generation: JSON.stringify({ answerable: true, answer: content, coverage: "direct", usedChunkIds: ["short-method"],
          supportAssessment: { requestedTarget: "물품", requirements: [{ kind: "method", support: "direct", evidence: [
            { chunkId: "short-method", quote: content, role: direct ? "method" : "location",
              target: direct ? "물품" : "테스트 봉투", targetRelation: direct ? "same" : "subset" },
          ] }] } }),
      });
      const response = await staffChat(handler).post("물품 보관법", storeId);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.status, direct ? "answered" : "insufficient");
      assert.ok(body.answer.includes(content));
      if (!direct) assert.ok(body.answer.includes("질문의 대상 범위 전체에 적용할 수 없습니다"));
      assert.equal(handler.events.followUps[0].escalate, !direct);
      assert.equal(handler.events.modelCalls.length, 1);
    }
  });

  test("normal absence, all-missing, policy-only and partial scope remain expressible under the strict generation contract", async () => {
    const content = "우유: 매장 냉장고 오른쪽 선반\n매뉴얼에 없는 재료의 보관 방법은 사장님에게 확인한다.";
    const policy = { chunkId: "shortage", quote: "매뉴얼에 없는 재료의 보관 방법은 사장님에게 확인한다.",
      role: "referral_policy", target: "재료", targetRelation: "covers_requested" };
    const location = { chunkId: "shortage", quote: "우유: 매장 냉장고 오른쪽 선반",
      role: "location", target: "우유", targetRelation: "subset" };
    const responses = [
      { answerable: false, answer: "", usedChunkIds: [] },
      { answerable: false, answer: "", usedChunkIds: [], coverage: "policy_only" },
      { answerable: false, answer: "", usedChunkIds: [], coverage: "policy_only", supportAssessment: null },
      { answerable: false, answer: "", usedChunkIds: [], coverage: "partial", supportAssessment: { requestedTarget: "유제품",
        requirements: [{ kind: "method", support: "missing", evidence: [] }] } },
      { answerable: true, answer: "현재 제공된 근거에서 전체 방법을 확인하지 못했습니다.", usedChunkIds: [], coverage: "partial",
        supportAssessment: { requestedTarget: "유제품", requirements: [{ kind: "method", support: "missing", evidence: [] }] } },
      { answerable: true, answer: policy.quote, usedChunkIds: ["shortage"], coverage: "policy_only",
        supportAssessment: { requestedTarget: "유제품", requirements: [{ kind: "method", support: "policy_only", evidence: [policy] }] } },
      { answerable: true, answer: content, usedChunkIds: ["shortage"], coverage: "partial",
        supportAssessment: { requestedTarget: "유제품", requirements: [{ kind: "method", support: "direct", evidence: [location, policy] }] } },
    ];
    for (const question of ["유제품은 어떻게 보관해야 하나요?", "유제품 보관법"]) {
      for (const generation of responses) {
        const handler = api({ results: [chunk("shortage", { title: "재고 및 비품 보관 위치", content })], rawGeneration: true,
          generation: JSON.stringify(generation), tracing: true });
        const response = await staffChat(handler).post(question, storeId);
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.status, "insufficient");
        assert.equal(body.code, undefined);
        assert.equal(handler.events.modelCalls.length, 1);
        assert.equal(handler.events.logs.length, 1);
        assert.equal(handler.events.followUps[0].escalate, true);
        assert.ok(handler.events.modelCalls[0].messages[0].content.endsWith("서버 지정 요구 항목: method."));
        assert.equal(handler.events.trace.some(event => ["structured_validation", "support_validation"].includes(event.stage ?? "")
          && event.validation === "rejected"), false);
        if (generation.coverage === "partial" && generation.usedChunkIds.length) {
          assert.ok(body.answer.includes("확인된 대상은 우유"));
          assert.ok(body.answer.includes("질문의 대상 범위 전체에 적용할 수 없습니다"));
        }
      }
    }
  });

  test("actual route support comparison retains safety/source and saves insufficient even when model labels policy as direct", async () => {
    const content = "직원은 내부 부품을 임의로 분해하지 않는다. 필요한 경우 관리자에게 보고한다.";
    const handler = api({ results: [chunk("policy", { content, raw_similarity_score: .64 })], tracing: true,
      generation: JSON.stringify({ answerable: true, coverage: "direct", answer: "관리자에게 보고합니다.", usedChunkIds: ["policy"],
        supportAssessment: { requirements: [{ kind: "procedure", support: "policy_only", evidence: [{ chunkId: "policy", quote: content }] }] } }) });
    const response = await handler.post("장비 내부 부품 분해 순서는 무엇인가요?");
    const body = await response.json();
    assert.equal(body.status, "insufficient");
    assert.equal(body.source.manualId, "manual-policy");
    assert.equal(body.similarity, .64);
    assert.ok(body.answer.includes(content));
    assert.ok(body.answer.includes("현재 제공된 근거에서 구체적인 작업 절차"));
    assert.equal(handler.events.logs[0].status, "insufficient");
    assert.equal(handler.events.followUps[0].escalate, true);
    assert.equal(handler.events.trace.find((event) => event.stage === "structured_validation")?.coverage, "direct");
    assert.equal(handler.events.trace.find((event) => event.stage === "final")?.supportCoverage, "policy_only");
    assert.equal(JSON.stringify(handler.events.trace).includes(content), false);
  });

  test("actual staff/chat preserves ambiguous menu clarification and RAG diagnostic stages", async () => {
    const handler = api({ results: [chunk("cafe", { title: "음료 제조", content: "4-3 카페라떼\n카페라떼 우유240ml.", raw_similarity_score: 0.408392, keyword_boost: 0.2 })], tracing: true });
    const chat = staffChat(handler);
    const response = await chat.post("따뜻한 라떼 우유 얼마나 넣고 몇 도까지 데워요?", storeId);
    const body = await response.json();
    assert.equal(body.answer.split("\n")[0], "어떤 라떼 메뉴를 말씀하시나요? 정확한 메뉴명을 알려주세요.");
    assert.equal(/240|220|온도가 다르/u.test(body.answer), false);
    assert.equal(handler.events.modelCalls.length, 0);
    assert.equal(handler.events.trace.find((event) => event.stage === "generation")?.mode, "menu_clarification");
  });

  test("actual POST diagnostic reasons distinguish empty search, menu exclusion, low score and search failure", async () => {
    const scenarios = [
      { options: { results: [] as ManualChunkMatch[] }, reason: "NO_SEARCH_CANDIDATES", status: 200 },
      { options: { results: [chunk("vanilla", { title: "음료 제조", content: "4-4. 바닐라라떼", raw_similarity_score: 0.8 })] }, reason: "ALL_MENU_CANDIDATES_EXCLUDED", status: 200 },
      { options: { results: [chunk("cafe", { title: "음료 제조", content: "4-3. 카페라떼", raw_similarity_score: 0.1, keyword_boost: 0.35 })] }, reason: "BELOW_EVIDENCE_THRESHOLD", status: 200 },
      { options: { results: [] as ManualChunkMatch[], searchError: true }, reason: "SEARCH_FAILED", status: 500 },
    ];
    for (const scenario of scenarios) {
      const handler = api({ ...scenario.options, tracing: true });
      const response = await handler.post("따뜻한 카페라떼 우유 얼마나 넣어요?");
      assert.equal(response.status, scenario.status);
      assert.ok(handler.events.trace.some((event) => event.reason === scenario.reason));
      if (scenario.status === 500) {
        assert.equal(handler.events.logs.length, 0);
        assert.equal(handler.events.followUps.length, 0);
        assert.equal(handler.events.trace.some((event) => event.stage === "search" && event.candidateCount === 0), false);
      } else {
        assert.equal((await response.json()).status, "insufficient");
        assert.equal(handler.events.followUps[0].escalate, true);
      }
      assert.equal(handler.events.modelCalls.length, 0);
    }
    const disabled = api({ results: [] });
    await disabled.post("카페라떼 우유량은?");
    assert.deepEqual(disabled.events.trace, []);
  });

  test("actual POST returns only clarification for all title formats without analytic logging or alerts", async () => {
    for (const heading of ["4-3. 카페라떼", "4-3 카페라떼", "카페라떼", "제조 안내"]) {
      const cafe = chunk("cafe", { title: "음료 제조 및 레시피 관리", content: `${heading}\n카페라떼 HOT 우유 240ml, 스팀 60~65℃.`, raw_similarity_score: 0.408392, keyword_boost: 0.2 });
      const vanilla = chunk("vanilla", { title: cafe.title, content: "바닐라라떼 HOT 우유 220ml, 스팀 60~65℃.", raw_similarity_score: 0.45, keyword_boost: 0.2 });
      const handler = api({ results: [vanilla, cafe] });
      const question = "따뜻한 라떼 우유 얼마나 넣고 몇 도까지 데워요?";
      const response = await handler.post(question);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.answer.split("\n")[0], "어떤 라떼 메뉴를 말씀하시나요? 정확한 메뉴명을 알려주세요.");
      assert.equal(/240|220|60|65|℃|온도가 다르|제조 순서/u.test(body.answer), false);
      assert.equal(handler.events.modelCalls.length, 0);
      assert.equal(body.status, "cautious");
      assert.equal(body.responseKind, "clarification");
      assert.equal(handler.events.logs.length, 0);
      assert.deepEqual(handler.events.searchCalls, [{ question, storeId, franchiseId }]);
      assert.equal(handler.events.completedFollowUps, 0);
    }
  });

  test("actual POST preserves explicit latte and stock answers through the existing generation boundary", async () => {
    for (const scenario of [
      { question: "HOT 카페라떼의 우유량과 스팀 온도는 얼마인가요?", content: "4-3. 카페라떼\nHOT 우유 240ml, 스팀 온도 60~65℃." },
      { question: "따뜻한 카페라떼 우유 얼마나 넣고 몇 도까지 데워요?", content: "4-3. 카페라떼\nHOT 우유 240ml, 스팀 온도 60~65℃." },
      { question: "우유가 거의 없는데 제가 바로 주문 넣어도 돼요?", content: "실제·추가 재고 확인 후 점주에게 보고한다. 직원 임의 발주 금지." },
    ]) {
      const handler = api({ results: [chunk("c1", { title: "운영 매뉴얼", content: scenario.content, raw_similarity_score: 0.7 })], generation: JSON.stringify({ answerable: true, answer: scenario.content, usedChunkIds: ["c1"] }) });
      const response = await handler.post(scenario.question);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.answer, scenario.content);
      assert.equal(body.status, "answered");
      assert.equal(handler.events.modelCalls.length, 1);
      assert.equal(handler.events.modelCalls[0].model, "gpt-4o");
      assert.ok(handler.events.modelCalls[0].messages[1].content.endsWith(`[직원 질문]\n${scenario.question}`));
      assert.equal(handler.events.logs[0].answer, scenario.content);
      assert.deepEqual(handler.events.followUps, [{ storeId, escalate: false }]);
    }
  });

  test("actual POST with no relevant latte evidence withholds recipes and preserves escalation", async () => {
    const handler = api({ results: [chunk("unrelated", { title: "포장 안내", content: "포장 순서를 확인합니다.", raw_similarity_score: 0.8 })] });
    const response = await handler.post("따뜻한 라떼 우유 얼마나 넣고 몇 도까지 데워요?");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "insufficient");
    assert.ok(body.answer.includes(NO_MANUAL_ANSWER));
    assert.ok(body.answer.includes("따뜻한 라떼 우유 얼마나 넣고 몇 도까지 데워요?"));
    assert.ok(body.answer.includes("현재 제공된 근거에서"));
    assert.equal(body.source, null);
    assert.equal(handler.events.modelCalls.length, 0);
    assert.equal(handler.events.logs[0].status, "insufficient");
    assert.deepEqual(handler.events.followUps, [{ storeId, escalate: true }]);
    assert.equal(handler.events.completedFollowUps, 1);
  });

  test("new unspecified family-pack requests clarify rather than treating the top B candidate as the chosen kind", async () => {
    const packB = chunk("pack-b", { title: "세트 메뉴", content: "B 패밀리팩 구성은 버거 3개입니다.", raw_similarity_score: 0.85 });
    const packA = chunk("pack-a", { title: "세트 메뉴", content: "A 패밀리팩은 다른 구성입니다.", raw_similarity_score: 0.7 });
    for (const results of [[packB, packA], [packB]]) {
      const handler = api({ results });
      const chat = staffChat(handler);
      const response = await chat.post("패밀리팩 어떻게 챙겨요?", storeId);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.answer, "어떤 종류의 패밀리팩을 말씀하시나요? 정확한 종류를 알려주세요.");
      assert.equal(/3개|제조|B 패밀리팩/u.test(body.answer), false);
      assert.equal(handler.events.modelCalls.length, 0);
      assert.equal(handler.events.followUps[0].escalate, false);
    }
    const exact = api({ results: [packB], generation: '{"answerable":true,"answer":"B 패밀리팩 구성은 버거 3개입니다.","usedChunkIds":["pack-b"]}' });
    const response = await staffChat(exact).post("B 패밀리팩 어떻게 챙겨요?", storeId);
    assert.ok((await response.json()).answer.includes("버거 3개"));
    assert.equal(exact.events.modelCalls.length, 1);
  });

  test("owned same-store conversation's latest explicit B question is context, never an assistant guess", async () => {
    const packB = chunk("pack-b", { title: "세트 메뉴", content: "B 패밀리팩 구성은 버거 3개입니다.", raw_similarity_score: 0.75 });
    const packA = chunk("pack-a", { title: "세트 메뉴", content: "A 패밀리팩 구성은 별도입니다.", raw_similarity_score: 0.9 });
    const handler = api({ results: [packA, packB], previousQuestion: "B 패밀리팩 구성을 알려주세요.", generation: '{"answerable":true,"answer":"B 패밀리팩 구성은 버거 3개입니다.","usedChunkIds":["pack-b"]}' });
    const conversationId = "44444444-4444-4444-8444-444444444444";
    const question = "패밀리팩 어떻게 챙겨요?";
    const response = await staffChat(handler, storeId).post(question, storeId, conversationId);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(body.answer.includes("B 패밀리팩"));
    assert.equal(handler.events.modelCalls.length, 1);
    const prompt = handler.events.modelCalls[0].messages[1].content;
    assert.ok(prompt.includes("[서버가 확인한 직전 사용자 질문의 종류]"));
    assert.ok(prompt.includes("B 패밀리팩"));
    assert.equal(prompt.includes("A 패밀리팩"), false);
    assert.ok(prompt.endsWith(`[직원 질문]\n${question}`));
    assert.equal(handler.events.logs[0].question, question);
    assert.ok(handler.events.searchCalls[0].question.includes("B 패밀리팩"));
    assert.deepEqual(handler.events.contextReads[0].filters, { id: conversationId, user_id: "fixture-staff", store_id: storeId });
    assert.deepEqual(handler.events.contextReads[1].filters, { conversation_id: conversationId, role: "user" });
  });

  test("actual staff/chat connects a referential follow-up only to the verified latest explicit pack target", async () => {
    const question = "그거 어떻게 챙겨요?";
    const handler = api({ results: [chunk("pack-b", { content: "B 패밀리팩 구성은 버거 3개입니다.", raw_similarity_score: 0.75 })], previousQuestion: "B 패밀리팩 구성 알려줘", generation: '{"answerable":true,"answer":"B 패밀리팩 구성은 버거 3개입니다.","usedChunkIds":["pack-b"]}' });
    const response = await staffChat(handler, storeId).post(question, storeId, "44444444-4444-4444-8444-444444444444");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(body.answer.includes("B 패밀리팩"));
    assert.equal(handler.events.searchCalls[0].question, `${question} B 패밀리팩`);
    assert.equal(handler.events.logs[0].question, question);
    assert.ok(handler.events.modelCalls[0].messages[1].content.endsWith(`[직원 질문]\n${question}`));
    assert.deepEqual(handler.events.contextReads[1].filters, { conversation_id: "44444444-4444-4444-8444-444444444444", role: "user" });
  });

  test("trace compares first response conversation with follow-up request and proves history and search augmentation", async () => {
    const conversationId = "44444444-4444-4444-8444-444444444444";
    const handler = api({ results: [chunk("pack-b", { content: "B 패밀리팩 구성은 버거 3개입니다.", raw_similarity_score: 0.75 })], previousQuestion: "B 패밀리팩 구성 알려줘", generation: '{"answerable":true,"answer":"B 패밀리팩 구성은 버거 3개입니다.","usedChunkIds":["pack-b"]}', tracing: true });
    const chat = staffChat(handler);
    const first = await chat.post("B 패밀리팩 구성 알려줘", storeId);
    assert.equal((await first.json()).conversationId, conversationId);
    const firstTag = chat.trace.find((event) => event.phase === "response")?.conversationTag;
    assert.equal(firstTag, conversationTraceTag(conversationId));
    const second = await chat.post("그거 어떻게 챙겨요?", storeId, conversationId);
    assert.equal(second.status, 200);
    assert.equal(chat.trace.filter((event) => event.phase === "request").at(-1)?.conversationTag, firstTag);
    const history = handler.events.trace.find((event) => event.reason === "VERIFIED_PREVIOUS_USER_TARGET");
    assert.equal(history?.previousUserQuestionFound, true);
    assert.equal(history?.variantIsB, true);
    assert.equal(history?.conversationTag, firstTag);
    const input = handler.events.trace.filter((event) => event.stage === "search_input").at(-1);
    assert.equal(input?.augmented, true);
    assert.equal(input?.confirmedTargetIncluded, true);
    assert.equal(input?.includesBFamilyPack, true);
    const printed = JSON.stringify([chat.trace, handler.events.trace]);
    for (const raw of [conversationId, "fixture-staff", "B 패밀리팩 구성 알려줘", "그거 어떻게 챙겨요?", "fixture-only-not-a-real-key"]) assert.equal(printed.includes(raw), false);
  });

  test("embedding and answer 401/429 are traceable system errors, never no-manual answers", async () => {
    for (const httpStatus of [401, 429]) {
      for (const service of ["embedding", "answer"]) {
        const handler = api({ results: [chunk("pack-b", { content: "B 패밀리팩 구성입니다.", raw_similarity_score: 0.8 })], tracing: true,
          embeddingStatus: service === "embedding" ? httpStatus : undefined, answerStatus: service === "answer" ? httpStatus : undefined });
        const response = await handler.post("B 패밀리팩 구성 알려줘");
        const body = await response.json();
        assert.equal(response.status, 500);
        assert.equal(body.answer, undefined);
        assert.equal(body.status, undefined);
        assert.equal(handler.events.logs.length, 0);
        assert.equal(handler.events.followUps.length, 0);
        assert.ok(handler.events.trace.some((event) => event.stage === "external_api" && event.service === service && event.httpStatus === httpStatus));
        assert.ok(handler.events.trace.some((event) => event.reason === (service === "embedding" ? "SEARCH_FAILED" : "GENERATION_FAILED")));
        assert.equal(handler.events.trace.filter((event) => event.stage === "final").length, 1);
        assert.equal(handler.events.trace.find((event) => event.stage === "final")?.status, "system_error");
        assert.ok(handler.events.trace.some((event) => event.stage === "escalation" && event.reason === "SYSTEM_ERROR"));
      }
    }
  });

  test("unresolved referential follow-ups ask for a target without searching or using assistant guesses", async () => {
    for (const scenario of [
      { noConversation: true, previousQuestion: "B 패밀리팩 구성 알려줘" },
      { previousQuestion: "패밀리팩 어떻게 챙겨요?" },
      { previousQuestion: "B 패밀리팩과 A 패밀리팩 구성 알려줘" },
      { previousQuestion: "B 패밀리팩과 카페라떼 준비는?" },
      { previousQuestion: "급여일은 언제예요?" },
      { previousQuestion: "B 패밀리팩", contextDenied: true },
      { previousQuestion: "B 패밀리팩", contextError: true },
    ]) {
      const handler = api({ results: [chunk("pack-b", { content: "B 패밀리팩", raw_similarity_score: 0.9 })], ...scenario });
      const response = await staffChat(handler, scenario.noConversation ? undefined : storeId)
        .post("그거 어떻게 챙겨요?", storeId, scenario.noConversation ? undefined : "44444444-4444-4444-8444-444444444444");
      const body = await response.json();
      assert.equal(body.answer, "어떤 메뉴나 항목을 말씀하시나요? 대상을 알려주세요.");
      assert.equal(body.status, "insufficient");
      assert.equal(handler.events.searchCalls.length, 0);
      assert.equal(handler.events.modelCalls.length, 0);
      assert.equal(handler.events.logs.length, 0);
      assert.equal(handler.events.completedFollowUps, 0);
    }
  });

  test("an explicit new stock topic is not rebound to the previous pack target", async () => {
    const question = "그거 말고 우유 재고가 부족하면 어떻게 해요?";
    const answer = "재고 확인 후 점주에게 보고하고 직원은 임의 발주하지 않습니다.";
    const handler = api({ results: [chunk("stock", { content: answer, raw_similarity_score: 0.75 })], previousQuestion: "B 패밀리팩 구성 알려줘", generation: JSON.stringify({ answerable: true, answer, usedChunkIds: ["stock"] }) });
    const response = await staffChat(handler, storeId).post(question, storeId, "44444444-4444-4444-8444-444444444444");
    assert.equal((await response.json()).answer, answer);
    assert.equal(handler.events.searchCalls[0].question, question);
    assert.equal(handler.events.contextReads.length, 0);
    assert.equal(handler.events.modelCalls[0].messages[1].content.includes("B 패밀리팩"), false);
    assert.equal(handler.events.logs[0].question, question);
  });

  test("new chats, inaccessible history, changed topic and read failures cannot supply a B context", async () => {
    const pack = chunk("pack-b", { content: "B 패밀리팩 구성은 버거 3개입니다.", raw_similarity_score: 0.75 });
    for (const scenario of [
      { previousQuestion: "B 패밀리팩", noConversation: true },
      { previousQuestion: "B 패밀리팩", contextDenied: true },
      { previousQuestion: "B 패밀리팩", contextError: true },
      { previousQuestion: "급여일이 언제예요?" },
      { previousQuestion: "A 패밀리팩과 B 패밀리팩은 어떻게 달라요?" },
      { previousQuestion: "B 패밀리팩 말고 다른 메뉴를 알려주세요." },
    ]) {
      const handler = api({ results: [pack], ...scenario });
      const response = await staffChat(handler, scenario.noConversation ? undefined : storeId)
        .post("패밀리팩 어떻게 챙겨요?", storeId, scenario.noConversation ? undefined : "44444444-4444-4444-8444-444444444444");
      const body = await response.json();
      assert.ok(body.answer.startsWith("어떤 종류의 패밀리팩을 말씀하시나요?"));
      assert.equal(/3개|B 패밀리팩/u.test(body.answer), false);
      assert.equal(handler.events.modelCalls.length, 0);
      if (scenario.contextDenied || scenario.contextError) assert.equal(handler.events.contextReads.some((read) => read.table === "conversation_messages"), false);
      if (scenario.noConversation) assert.equal(handler.events.contextReads.length, 0);
    }
  });

  test("explicit current A overrides previous B, and missing context evidence remains insufficient", async () => {
    const packA = chunk("pack-a", { content: "A 패밀리팩은 A의 구성입니다.", raw_similarity_score: 0.75 });
    const packB = chunk("pack-b", { content: "B 패밀리팩은 B의 구성입니다.", raw_similarity_score: 0.85 });
    const handler = api({ results: [packB, packA], previousQuestion: "B 패밀리팩", generation: '{"answerable":true,"answer":"A 패밀리팩은 A의 구성입니다.","usedChunkIds":["pack-a"]}' });
    const response = await staffChat(handler, storeId).post("A 패밀리팩 어떻게 챙겨요?", storeId, "44444444-4444-4444-8444-444444444444");
    const body = await response.json();
    assert.equal(body.source.manualId, packA.manual_id);
    assert.equal(handler.events.contextReads.length, 0);
    assert.equal(handler.events.modelCalls[0].messages[1].content.includes("B 패밀리팩"), false);
    const missing = api({ results: [packA], previousQuestion: "B 패밀리팩" });
    const withheld = await staffChat(missing, storeId).post("패밀리팩 어떻게 챙겨요?", storeId, "44444444-4444-4444-8444-444444444444");
    assert.equal((await withheld.json()).status, "insufficient");
    assert.equal(missing.events.modelCalls.length, 0);
    assert.equal(missing.events.followUps[0].escalate, true);
  });

  test("client supplied family-pack kind and previous question cannot replace server-verified history", async () => {
    const handler = api({ results: [chunk("pack-b", { content: "B 패밀리팩 구성은 버거 3개입니다.", raw_similarity_score: 0.8 })] });
    const response = await handler.postRequest(new Request("http://localhost:3001/api/rag/query", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "패밀리팩 어떻게 챙겨요?", storeId, familyPackVariant: "B", previousQuestion: "B 패밀리팩" }),
    }));
    const body = await response.json();
    assert.equal(body.answer, "어떤 종류의 패밀리팩을 말씀하시나요? 정확한 종류를 알려주세요.");
    assert.equal(handler.events.modelCalls.length, 0);
    assert.equal(handler.events.contextReads.length, 0);
  });

  test("actual POST rejects unauthorized staff or unresolved server scope before search and generation", async () => {
    for (const [authorization, status] of [["UNAUTHENTICATED", 401], ["FORBIDDEN", 403]] as const) {
      const handler = api({ results: [], authorization });
      assert.equal((await handler.post("라떼 우유 얼마나 넣어요?")).status, status);
      assert.equal(handler.events.scopeCalls, 0);
      assert.equal(handler.events.searchCalls.length, 0);
      assert.equal(handler.events.modelCalls.length, 0);
      assert.equal(handler.events.logs.length, 0);
    }
    const handler = api({ results: [], scopeResolved: false });
    assert.equal((await handler.post("라떼 우유 얼마나 넣어요?")).status, 500);
    assert.equal(handler.events.searchCalls.length, 0);
    assert.equal(handler.events.modelCalls.length, 0);
    assert.equal(handler.events.logs.length, 0);
  });
});

describe("라우트 연결부", () => {
  test("actual embedding wrapper attaches safe 401/429 metadata without response body or real network", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_API_KEY = "fixture-embedding-key";
      for (const status of [401, 429]) {
        globalThis.fetch = async (url, init) => {
          assert.equal(url, "https://api.openai.com/v1/embeddings");
          assert.ok(init?.headers);
          return { ok: false, status, json: async () => { throw new Error("ERROR_BODY_MUST_NOT_BE_READ"); } } as unknown as Response;
        };
        await assert.rejects(createEmbedding("B 패밀리팩"), (error: unknown) => {
          const failure = error as Error & { diagnosticService?: string; diagnosticHttpStatus?: number };
          assert.equal(failure.diagnosticService, "embedding");
          assert.equal(failure.diagnosticHttpStatus, status);
          assert.equal(failure.message.includes("fixture-embedding-key"), false);
          return true;
        });
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
    }
  });

  test("local diagnostics separate RPC, gate and actually cited scores without a network call", async () => {
    const report = await diagnoseRagCase({
      question: "따뜻한 카페라떼 우유 얼마나 넣고 몇 도까지 데워요?",
      matches: [chunk("unused", { raw_similarity_score: 0.9 }), chunk("latte", { raw_similarity_score: 0.45, keyword_boost: 0.25, similarity_score: 0.7 })],
      generation: '{"answerable":true,"answer":"매뉴얼 값대로 제조합니다.","usedChunkIds":["latte"]}',
    }, { storeId: "store", franchiseId: "brand" });
    assert.equal(report.candidates[1].rpcRankScore, 0.7);
    assert.equal(report.candidates[1].evidenceScore, 0.6);
    assert.equal(report.candidates[1].appKeywordSupport, 0.15);
    assert.equal(report.candidates[1].selected, true);
    assert.equal(report.candidates[0].selected, false);
    assert.equal(report.final && "evidenceScore" in report.final ? report.final.evidenceScore : null, 0.6);
    assert.equal(report.final && "status" in report.final ? report.final.status : null, "answered");
  });

  test("query-only diagnostics do not confuse unexecuted search with no evidence", async () => {
    const report = await diagnoseRagCase({ question: "HOT 카페라떼의 우유량과 스팀 온도는 얼마인가요?" }, { storeId: "store", franchiseId: "brand" });
    assert.equal(report.mode, "query_only");
    assert.equal(report.searchStatus, null);
    assert.equal(report.final, null);
    assert.deepEqual(report.candidates, []);
    assert.equal(report.topCandidateEvidenceScore, null);
    assert.equal(report.generationExecuted, false);
  });

  test("diagnostics preserve the resolver's unparsable generation classification", async () => {
    const report = await diagnoseRagCase({ question: "카페라떼 제조", matches: [chunk("c1")], generation: "invalid json" }, { storeId: "store", franchiseId: "brand" });
    assert.deepEqual(report.final, { errorCode: "GENERATION_UNPARSABLE" });
    assert.equal(report.generationExecuted, true);
  });

  test("default CLI input executes all seven query plans without network or invented final decisions", async () => {
    const filename = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../examples/rag-diagnostics/questions.json");
    const previousFetch = globalThis.fetch;
    const previousEnv = process.env.NODE_ENV;
    let calls = 0;
    try {
      process.env.NODE_ENV = "test";
      globalThis.fetch = async () => { calls++; throw new Error("NETWORK_FORBIDDEN"); };
      const reports = await runDiagnostic(["--input", filename]);
      assert.ok(Array.isArray(reports));
      assert.equal(reports.length, 7);
      for (const report of reports) {
        assert.equal(report.mode, "query_only");
        assert.equal(report.searchStatus, null);
        assert.equal(report.final, null);
        assert.equal(report.generationExecuted, false);
        assert.equal(report.metadataComplete, false);
      }
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
    }
  });

  test("diagnostics flag foreign metadata and never generate from it", async () => {
    let generationCalls = 0;
    const report = await diagnoseRagCase({ question: "라떼 우유량", matches: [{ ...chunk("foreign"), store_id: "other", franchise_id: "other", scope_type: "store", status: "approved" }] }, { storeId: "store", franchiseId: "brand" }, async () => { generationCalls++; return ""; });
    assert.equal(report.scopeDenied, true);
    assert.equal(report.candidates[0].scopeVerification, "denied");
    assert.equal(report.final, null);
    assert.equal(generationCalls, 0);
  });

  test("diagnostic output masks credentials and rejects production or accidental generation flags before IO", async () => {
    const hidden = redactDiagnostic({ question: "Bearer token-value", title: "sk-test-secret", payload: "Cookie: session=private", nested: ["my-credential"] }, ["my-credential"]);
    const printed = JSON.stringify(hidden);
    for (const secret of ["token-value", "sk-test-secret", "private", "my-credential"]) assert.equal(printed.includes(secret), false);
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      await assert.rejects(runDiagnostic(["--input", "not-read.json", "--live"]), /DEVELOPMENT_ONLY/);
      process.env.NODE_ENV = "test";
      await assert.rejects(runDiagnostic(["--input", "not-read.json", "--live"]), /LIVE_REQUIRES_DEVELOPMENT/);
      await assert.rejects(runDiagnostic(["--input", "not-read.json", "--generate"]), /INVALID_ARGUMENTS/);
    } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
  });

  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/api/rag/query/route.ts"),
    "utf8",
  );

  test("보호된 임계값은 그대로 두고 게이트에 같은 값을 넘긴다", () => {
    assert.match(source, /const ANSWERED_THRESHOLD = 0\.60;/);
    assert.match(source, /const CAUTIOUS_THRESHOLD = 0\.40;/);
    assert.match(source, /answered: ANSWERED_THRESHOLD, cautious: CAUTIOUS_THRESHOLD/);
  });

  test("system_error는 로그 저장·에스컬레이션 전에 500으로 끊는다", () => {
    const systemError = source.indexOf('outcome.kind === "system_error"');
    const finalizeCall = source.indexOf("finalizeRagQueryResponse({");
    assert.ok(systemError > 0, "system_error 분기가 있어야 한다");
    assert.ok(finalizeCall > systemError, "로그 저장은 system_error 분기 뒤에 온다");
  });

  test("에스컬레이션은 최종 insufficient일 때만 건다", () => {
    assert.match(source, /escalate: outcome\.escalate,/);
  });

  test("구조화 출력을 요구한다", () => {
    assert.match(source, /response_format: buildGroundedAnswerResponseFormat\(question, interpretation\?\.requirements\)/);
    assert.match(source, /buildGroundedAnswerMessages\(question, chunks, familyPackVariant, interpretation\?\.requirements, interpretation\)/);
  });

  test("질문 원문을 로그에 남기지 않는다", () => {
    assert.match(source, /questionLength: question\.length/);
    assert.equal(/console\.(info|log)\([^)]*\bquestion\b\s*[,)]/.test(source), false);
  });
});
