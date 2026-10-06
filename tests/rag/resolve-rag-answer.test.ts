import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import ts from "typescript";
import { conversationTraceTag } from "../../lib/rag/trace-identifiers.ts";
import { createEmbedding } from "../../lib/rag/openai-embeddings.ts";

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

function expectResolved(outcome: Awaited<ReturnType<typeof resolveRagAnswer>>) {
  assert.equal(outcome.kind, "resolved");
  if (outcome.kind !== "resolved") throw new Error("unreachable");
  return outcome;
}

describe("근거가 충분한 질문", () => {
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
    assert.equal(outcome.response.answer, NO_MANUAL_ANSWER);
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
    assert.equal(outcome.response.answer, NO_MANUAL_ANSWER);
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
    assert.equal(outcome.response.answer, NO_MANUAL_ANSWER);
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
      assert.equal(outcome.response.answer, NO_MANUAL_ANSWER);
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
  const storeId = "7b151c36-4e24-4516-93b1-5b1c1ceac6cc";
  const franchiseId = "2bb2f2ca-53f9-48b9-935d-540fe05478d9";
  const source = readFileSync(new URL("../../app/api/rag/query/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const require = createRequire(import.meta.url);

  function api(options: { results: ManualChunkMatch[]; authorization?: string; scopeResolved?: boolean; generation?: string; searchError?: boolean; tracing?: boolean; previousQuestion?: string; contextDenied?: boolean; contextError?: boolean; embeddingStatus?: number; answerStatus?: number }) {
    const events = {
      searchCalls: [] as { question: string; storeId: string; franchiseId: string }[],
      modelCalls: [] as { model: string; messages: { content: string }[] }[],
      logs: [] as { question: string; answer: string; status: string; storeId: string | null }[],
      followUps: [] as { storeId: string; escalate: boolean }[],
      completedFollowUps: 0,
      scopeCalls: 0,
      trace: [] as { stage?: string; reason?: string; [key: string]: unknown }[],
      contextReads: [] as { table: string; filters: Record<string, string> }[],
    };
    const contextClient = {
      from(table: string) {
        const filters: Record<string, string> = {};
        events.contextReads.push({ table, filters });
        const query = {
          select: () => query,
          eq: (field: string, value: string) => { filters[field] = value; return query; },
          order: (field: string, options: { ascending: boolean }) => { assert.equal(field, "created_at"); assert.equal(options.ascending, false); return query; },
          limit: (count: number) => { assert.equal(count, 1); return query; },
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
      "@/lib/rag/answer-prompt": { buildGroundedAnswerMessages },
      "@/lib/rag/trace-identifiers": { conversationTraceTag },
      "@/lib/rag/manual-menu-intent": { canUseFamilyPackHistory, priorFamilyPackVariant },
      "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "fixture-staff" } }, error: null }) } }) },
      "@/lib/rag/authorize-rag-store-access": {
        authorizeRagStoreAccessForRequest: async (requested: string) => { assert.equal(requested, storeId); return { status: options.authorization ?? "AUTHORIZED" }; },
        resolveRagStoreFranchiseForRequest: async (requested: string) => { events.scopeCalls++; assert.equal(requested, storeId); return options.scopeResolved === false ? { status: "UNRESOLVED" } : { status: "RESOLVED", franchiseId }; },
      },
      "@/lib/rag/finalize-rag-query-response": { finalizeRagQueryResponse },
      "@/lib/rag/resolve-rag-answer": { resolveRagAnswer },
      "@/lib/rag/validate-query-request": { validateQueryRequest },
      "@/lib/rag/save-question-log": { saveQuestionLog: async (input: typeof events.logs[number]) => { events.logs.push(input); return { saved: true, questionLogId: "33333333-3333-4333-8333-333333333333" }; } },
      "@/lib/notifications/notify-repeated-question": { createQuestionLogFollowUp: (input: { storeId: string; escalate: boolean }) => { events.followUps.push({ storeId: input.storeId, escalate: input.escalate }); return async () => { events.completedFollowUps++; }; } },
      "@/lib/supabase/admin": { createAdminClient: () => contextClient },
      "@/lib/rag/search-manual-chunks": { searchManualChunks: async (question: string, requestedStore: string, requestedFranchise: string) => { events.searchCalls.push({ question, storeId: requestedStore, franchiseId: requestedFranchise }); if (options.embeddingStatus) throw Object.assign(new Error("MOCK_EMBEDDING_HTTP_FAILURE"), { diagnosticService: "embedding", diagnosticHttpStatus: options.embeddingStatus }); if (options.searchError) throw new Error("SEARCH_FIXTURE_FAILURE"); return options.results; } },
    };
    const routeModule = { exports: {} as { POST: (request: Request) => Promise<Response> } };
    new Script(compiled, { filename: "actual-rag-query-route.cjs" }).runInNewContext({
      module: routeModule,
      exports: routeModule.exports,
      require: (name: string) => { assert.ok(Object.hasOwn(dependencies, name), `Unmocked API dependency: ${name}`); return dependencies[name]; },
      process: { env: { OPENAI_API_KEY: "fixture-only-not-a-real-key", NODE_ENV: options.tracing ? "development" : "test", RAG_TRACE: options.tracing ? "1" : undefined } },
      AbortController,
      URL,
      setTimeout,
      clearTimeout,
      console: { info: (label: string, event: typeof events.trace[number]) => { if (label === "[RAG_TRACE]") events.trace.push(event); }, error: () => {} },
      fetch: async (url: string, init: RequestInit) => {
        assert.equal(url, "https://api.openai.com/v1/chat/completions");
        events.modelCalls.push(JSON.parse(init.body as string));
        if (options.answerStatus) return { ok: false, status: options.answerStatus, json: async () => ({}) };
        assert.ok(options.generation, "Model must not be invoked for unresolved menus");
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: options.generation } }] }) };
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

  function staffChat(rag: ReturnType<typeof api>, savedStoreId?: string) {
    const chatSource = readFileSync(new URL("../../app/api/staff/chat/route.ts", import.meta.url), "utf8");
    const chatCompiled = ts.transpileModule(chatSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const trace: { phase?: string; conversationTag?: string | null; requestOrigin: string; effectiveStoreId: string; expectedIsuStore: boolean; storeSource: string }[] = [];
    const forwardedUrls: string[] = [];
    const fakeAdmin = {
      from() {
        const query = {
          error: null,
          select: () => query, eq: () => query, insert: () => query, update: () => query,
          maybeSingle: async () => ({ data: { id: "conversation", store_id: savedStoreId ?? storeId }, error: null }),
          single: async () => ({ data: { id: "44444444-4444-4444-8444-444444444444" }, error: null }),
        };
        return query;
      },
    };
    const dependencies: Record<string, unknown> = {
      "next/server": require("next/server.js"),
      "@/app/api/rag/query/route": { POST: async (request: Request) => { forwardedUrls.push(request.url); return rag.postRequest(request); } },
      "@/lib/rag/trace-identifiers": { conversationTraceTag },
      "@/lib/staff/conversations": { buildConversationTitle: () => "fixture", isMissingConversationTable: () => false },
      "@/lib/supabase/admin": { createAdminClient: () => fakeAdmin },
      "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "fixture-staff" } }, error: null }) } }) },
    };
    const chatModule = { exports: {} as { POST: (request: Request) => Promise<Response> } };
    new Script(chatCompiled, { filename: "actual-staff-chat-route.cjs" }).runInNewContext({
      module: chatModule, exports: chatModule.exports, Request, URL, Date,
      require: (name: string) => { assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name]; },
      process: { env: { NODE_ENV: "development", RAG_TRACE: "1" } },
      console: { info: (_label: string, event: typeof trace[number]) => trace.push(event), error: () => {} },
    });
    return { trace, forwardedUrls, post: (question: string, requestedStoreId: string, conversationId?: string) => chatModule.exports.POST(new Request("http://localhost:3001/api/staff/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, storeId: requestedStoreId, conversationId }),
    })) };
  }

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
      assert.equal(chat.trace[0].expectedIsuStore, true);
      assert.equal(chat.trace[0].storeSource, existing ? "saved_conversation" : "new_request");
      assert.deepEqual(handler.events.searchCalls, [{ question, storeId, franchiseId }]);
      assert.equal(handler.events.trace.find((event) => event.stage === "menu_filter")?.afterCount, 1);
      assert.equal(handler.events.trace.find((event) => event.stage === "final")?.reason, "SUPPORTED_ANSWER");
    }
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

  test("actual POST returns only clarification for all title formats, with zero Chat calls and normal logging", async () => {
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
      assert.equal(handler.events.logs.length, 1);
      assert.equal(handler.events.logs[0].answer, body.answer);
      assert.equal(handler.events.logs[0].question, question);
      assert.equal(handler.events.logs[0].storeId, storeId);
      assert.deepEqual(handler.events.searchCalls, [{ question, storeId, franchiseId }]);
      assert.deepEqual(handler.events.followUps, [{ storeId, escalate: false }]);
      assert.equal(handler.events.completedFollowUps, 1);
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
    assert.equal(body.answer, NO_MANUAL_ANSWER);
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
      assert.equal(handler.events.followUps[0].escalate, true);
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
    assert.match(source, /response_format: \{ type: "json_object" \}/);
    assert.match(source, /buildGroundedAnswerMessages\(question, chunks, familyPackVariant\)/);
  });

  test("질문 원문을 로그에 남기지 않는다", () => {
    assert.match(source, /questionLength: question\.length/);
    assert.equal(/console\.(info|log)\([^)]*\bquestion\b\s*[,)]/.test(source), false);
  });
});
