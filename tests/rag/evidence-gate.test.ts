import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  KEYWORD_SUPPORT_CAP,
  MIN_SEMANTIC_SIMILARITY,
  applyEvidenceGate,
  keywordSupportFor,
  scoreChunk,
} from "../../lib/rag/evidence-gate.ts";
import type { ManualChunkMatch } from "../../lib/rag/types.ts";

const THRESHOLDS = { answered: 0.6, cautious: 0.4 };

let sequence = 0;

function chunk(overrides: Partial<ManualChunkMatch> = {}): ManualChunkMatch {
  sequence += 1;
  const raw = overrides.raw_similarity_score ?? 0.5;
  const boost = overrides.keyword_boost ?? 0;
  return {
    chunk_id: `chunk-${sequence}`,
    manual_id: `manual-${sequence}`,
    title: "제목",
    category: "카테고리",
    content: "내용",
    raw_similarity_score: raw,
    keyword_boost: boost,
    // 018이 내려주는 랭킹 점수(0.35 boost일 때 0.60 바닥이 깔린 값)를 그대로 흉내 낸다.
    similarity_score: overrides.similarity_score
      ?? (boost === 0.35 ? Math.max(0.6, raw + boost) : Math.min(1, raw + boost)),
    ...overrides,
  };
}

describe("키워드 가산점이 answered를 강제하지 못한다", () => {
  test("A. 환불 질문에 붙은 '결제 단말기 청소' 청크는 확정 답변이 되지 않는다", () => {
    // 018 랭킹 점수는 0.60이지만 의미 유사도는 0.05뿐인 실제 재현 조건.
    const unrelated = chunk({ raw_similarity_score: 0.05, keyword_boost: 0.35 });
    assert.equal(unrelated.similarity_score, 0.6, "018 랭킹 점수는 여전히 0.60이다");

    const gate = applyEvidenceGate([unrelated], THRESHOLDS);
    assert.equal(gate.searchStatus, "insufficient");
    assert.deepEqual(gate.usableChunks, []);
  });

  test("B. 낮은 원래 유사도는 가산점으로도 answered까지 오르지 않는다", () => {
    for (const raw of [0, 0.1, 0.19]) {
      const gate = applyEvidenceGate([chunk({ raw_similarity_score: raw, keyword_boost: 0.35 })], THRESHOLDS);
      assert.equal(gate.searchStatus, "insufficient", `raw=${raw}`);
    }
  });

  test("의미가 닿지 않으면 키워드 가산점 자체를 주지 않는다", () => {
    assert.equal(keywordSupportFor(chunk({ raw_similarity_score: MIN_SEMANTIC_SIMILARITY - 0.01, keyword_boost: 0.35 })), 0);
    assert.equal(
      keywordSupportFor(chunk({ raw_similarity_score: MIN_SEMANTIC_SIMILARITY, keyword_boost: 0.35 })),
      KEYWORD_SUPPORT_CAP,
    );
  });

  test("가산점은 상한까지만 더해진다", () => {
    const scored = scoreChunk(chunk({ raw_similarity_score: 0.5, keyword_boost: 0.35 }));
    assert.equal(scored.keywordSupport, KEYWORD_SUPPORT_CAP);
    assert.equal(Number(scored.evidenceScore.toFixed(4)), 0.65);
  });
});

describe("정상 검색은 과도하게 막지 않는다", () => {
  test("근거가 충분하면 answered로 남는다", () => {
    const gate = applyEvidenceGate([chunk({ raw_similarity_score: 0.72, keyword_boost: 0 })], THRESHOLDS);
    assert.equal(gate.searchStatus, "answered");
    assert.equal(gate.usableChunks.length, 1);
  });

  test("키워드가 겹치는 진짜 근거는 가산점으로 answered가 될 수 있다", () => {
    const gate = applyEvidenceGate([chunk({ raw_similarity_score: 0.55, keyword_boost: 0.3 })], THRESHOLDS);
    assert.equal(gate.searchStatus, "answered");
  });

  test("중간 점수는 cautious로 남는다", () => {
    const gate = applyEvidenceGate([chunk({ raw_similarity_score: 0.45, keyword_boost: 0 })], THRESHOLDS);
    assert.equal(gate.searchStatus, "cautious");
    assert.equal(gate.usableChunks.length, 1);
  });

  test("기준 미만 근거는 모델에게 넘기지 않는다", () => {
    const gate = applyEvidenceGate(
      [chunk({ raw_similarity_score: 0.7 }), chunk({ raw_similarity_score: 0.3 })],
      THRESHOLDS,
    );
    assert.equal(gate.usableChunks.length, 1);
    assert.equal(gate.searchStatus, "answered");
  });

  test("여러 근거는 evidenceScore 내림차순으로 정렬된다", () => {
    const low = chunk({ raw_similarity_score: 0.62 });
    const high = chunk({ raw_similarity_score: 0.81 });
    const gate = applyEvidenceGate([low, high], THRESHOLDS);
    assert.deepEqual(
      gate.usableChunks.map((item) => item.match.chunk_id),
      [high.chunk_id, low.chunk_id],
    );
  });

  test("무관한 키워드 청크가 진짜 근거를 밀어내지 않는다", () => {
    const real = chunk({ raw_similarity_score: 0.58, keyword_boost: 0 });
    const keywordOnly = chunk({ raw_similarity_score: 0.02, keyword_boost: 0.35 });
    const gate = applyEvidenceGate([keywordOnly, real], THRESHOLDS);
    assert.deepEqual(gate.usableChunks.map((item) => item.match.chunk_id), [real.chunk_id]);
    assert.equal(gate.searchStatus, "cautious");
  });

  test("검색 결과가 없으면 insufficient이고 점수는 null이다", () => {
    assert.deepEqual(applyEvidenceGate([], THRESHOLDS), {
      searchStatus: "insufficient",
      usableChunks: [],
      topEvidenceScore: null,
    });
  });

  test("점수가 NaN이거나 범위를 벗어나도 안전하게 처리한다", () => {
    const gate = applyEvidenceGate(
      [chunk({ raw_similarity_score: Number.NaN, keyword_boost: Number.NaN })],
      THRESHOLDS,
    );
    assert.equal(gate.searchStatus, "insufficient");
    assert.equal(gate.topEvidenceScore, 0);
    assert.equal(scoreChunk(chunk({ raw_similarity_score: 1.4, keyword_boost: 0.3 })).evidenceScore, 1);
  });
});
