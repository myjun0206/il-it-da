import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveRagAnswer } from "../../lib/rag/resolve-rag-answer.ts";
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

describe("라우트 연결부", () => {
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
    assert.match(source, /outcome\.escalate \? escalateInsufficientQuestion\(storeId\) : undefined/);
  });

  test("구조화 출력을 요구한다", () => {
    assert.match(source, /response_format: \{ type: "json_object" \}/);
    assert.match(source, /buildGroundedAnswerMessages\(question, chunks\)/);
  });

  test("질문 원문을 로그에 남기지 않는다", () => {
    assert.match(source, /questionLength: question\.length/);
    assert.equal(/console\.(info|log)\([^)]*\bquestion\b\s*[,)]/.test(source), false);
  });
});
