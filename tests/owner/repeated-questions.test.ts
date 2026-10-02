import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MANUAL_IMPROVEMENT_DRAFT_CONSTRAINTS,
  MAX_ANALYZED_QUESTION_LOGS,
  QUESTION_LOG_PAGE_SIZE,
  REPEATED_QUESTION_CATEGORY_LABELS,
  REPEATED_QUESTION_MIN_COUNT,
  REPEATED_QUESTION_THRESHOLDS_VALIDATED,
  REPEATED_QUESTION_WINDOW_DAYS,
  buildRepeatedQuestionReport,
  fetchRepeatedQuestionsForStore,
  normalizeRepeatedQuestionKey,
  toManualImprovementDraftInput,
  type QuestionLogRow,
} from "../../lib/owner/repeated-questions.ts";

const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MANUAL_1 = "11111111-1111-4111-8111-111111111111";
const MANUAL_2 = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-28T00:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

let sequence = 0;

function row(overrides: Partial<QuestionLogRow> = {}): QuestionLogRow {
  sequence += 1;
  return {
    id: `log-${sequence}`,
    question: "환불 규정 알려주세요",
    status: "insufficient",
    store_id: STORE_A,
    source_manual_id: null,
    created_at: daysAgo(1),
    ...overrides,
  };
}

function repeat(count: number, overrides: Partial<QuestionLogRow> = {}): QuestionLogRow[] {
  return Array.from({ length: count }, () => row(overrides));
}

describe("normalizeRepeatedQuestionKey (안전하게 흡수하는 차이)", () => {
  test("띄어쓰기 차이는 같은 키가 된다", () => {
    assert.equal(
      normalizeRepeatedQuestionKey("재고 확인 어떻게"),
      normalizeRepeatedQuestionKey("재고확인  어떻게"),
    );
  });

  test("끝 문장부호 차이는 같은 키가 된다", () => {
    const base = normalizeRepeatedQuestionKey("마감 순서");
    for (const variant of ["마감 순서?", "마감 순서!!", "마감 순서...", "마감 순서~~", "  마감 순서  "]) {
      assert.equal(normalizeRepeatedQuestionKey(variant), base, variant);
    }
  });

  test("정중체 어미 차이는 같은 키가 된다", () => {
    const keys = [
      "환불 규정 알려주세요",
      "환불 규정 알려줘",
      "환불 규정 궁금해요",
      "환불 규정?",
    ].map(normalizeRepeatedQuestionKey);

    assert.equal(new Set(keys).size, 1, JSON.stringify(keys));
  });

  test("영문 대소문자 차이는 같은 키가 된다", () => {
    assert.equal(normalizeRepeatedQuestionKey("POS 사용법"), normalizeRepeatedQuestionKey("pos 사용법"));
  });

  test("NFD로 들어온 한글도 같은 키가 된다", () => {
    const nfc = "재고 확인";
    assert.equal(normalizeRepeatedQuestionKey(nfc), normalizeRepeatedQuestionKey(nfc.normalize("NFD")));
  });
});

describe("normalizeRepeatedQuestionKey (합치면 안 되는 차이)", () => {
  test("서로 다른 업무 질문은 다른 키로 남는다", () => {
    const keys = [
      "환불 어떻게 하나요",
      "발주 어떻게 하나요",
      "청소 어떻게 하나요",
      "마감 어떻게 하나요",
    ].map(normalizeRepeatedQuestionKey);

    assert.equal(new Set(keys).size, 4);
  });

  test("대상이 다르면 합치지 않는다", () => {
    assert.notEqual(
      normalizeRepeatedQuestionKey("원두 발주 언제 하나요"),
      normalizeRepeatedQuestionKey("우유 발주 언제 하나요"),
    );
  });

  test("조사·어순·동의어는 흡수하지 않는다(과도한 병합 방지)", () => {
    assert.notEqual(normalizeRepeatedQuestionKey("환불은 어떻게"), normalizeRepeatedQuestionKey("환불 어떻게"));
    assert.notEqual(normalizeRepeatedQuestionKey("환불 방법"), normalizeRepeatedQuestionKey("반품 방법"));
  });

  test("어미를 떼면 줄기가 너무 짧아지는 경우에는 떼지 않는다", () => {
    // "원인가" -> "원"처럼 1글자로 줄어드는 축약을 막는다.
    assert.equal(normalizeRepeatedQuestionKey("원인가"), "원인가");
  });

  test("빈 문자열과 문장부호만 있는 입력은 키를 만들지 않는다", () => {
    for (const value of ["", "   ", "???", "!!!"]) {
      assert.equal(normalizeRepeatedQuestionKey(value), "");
    }
  });
});

describe("normalizeRepeatedQuestionKey (운영 판단이 반대인 쌍)", () => {
  // 허용/금지, 필수/면제, 가능/불가처럼 점주 판단이 정반대인 질문은 절대 합쳐지면 안 된다.
  const OPPOSITE_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ["이거 해도 돼요?", "이거 하면 안 돼요?"],
    ["폐기해야 해요?", "폐기하지 않아도 돼요?"],
    ["환불 가능해요?", "환불 불가능해요?"],
    ["재고 있어요?", "재고 없어요?"],
    ["지금 청소 하나요?", "지금 청소 안 하나요?"],
    ["교환 되나요?", "교환 안 되나요?"],
    ["사용해도 되나요?", "사용하면 안 되나요?"],
    ["반품 받아야 하나요?", "반품 안 받아도 되나요?"],
    ["영수증 필요한가요?", "영수증 필요 없나요?"],
    ["마감 청소 해야 돼요?", "마감 청소 안 해도 돼요?"],
    ["포장 가능한가요?", "포장 불가능한가요?"],
    ["할인 적용돼요?", "할인 적용 안 돼요?"],
    ["지금 발주 넣어요?", "지금 발주 넣지 말까요?"],
    ["이거 버려요?", "이거 버리지 말아요?"],
    ["교육 이수해야 합니까?", "교육 이수 안 해도 합니까?"],
  ];

  for (const [allowed, forbidden] of OPPOSITE_PAIRS) {
    test(`"${allowed}" / "${forbidden}" 는 같은 그룹이 되지 않는다`, () => {
      assert.notEqual(
        normalizeRepeatedQuestionKey(allowed),
        normalizeRepeatedQuestionKey(forbidden),
      );
    });
  }

  test("부정·금지 표지가 포함된 어미는 제거 목록에 없다", () => {
    // 제거 대상 어미가 안/않/못/없/말/불을 품고 있으면 반대 의미가 같은 키로 무너진다.
    for (const [allowed, forbidden] of OPPOSITE_PAIRS) {
      const forbiddenKey = normalizeRepeatedQuestionKey(forbidden);
      assert.match(forbiddenKey, /안|않|못|없|말|불/u, `${forbidden} -> ${forbiddenKey}`);
      assert.notEqual(forbiddenKey, normalizeRepeatedQuestionKey(allowed));
    }
  });

  test("집계 단계에서도 반대 의미 질문이 한 그룹으로 묶이지 않는다", () => {
    const report = buildRepeatedQuestionReport(
      [
        ...repeat(2, { question: "이거 해도 돼요?" }),
        ...repeat(2, { question: "이거 하면 안 돼요?" }),
      ],
      { storeId: STORE_A, now: NOW, minCount: 2 },
    );

    assert.equal(report.groups.length, 2);
    assert.deepEqual(report.groups.map((g) => g.repeatCount), [2, 2]);
  });
});

describe("normalizeRepeatedQuestionKey (명사 잘림 방지)", () => {
  test("'인가'(허가)로 끝나는 명사를 잘라내지 않는다", () => {
    for (const noun of ["출입인가", "출입 인가", "사업 인가", "건축 인가"]) {
      const key = normalizeRepeatedQuestionKey(noun);
      assert.match(key, /인가$/u, `${noun} -> ${key}`);
    }
  });

  test("'출입 인가'와 '출입 되나요'는 다른 그룹이다", () => {
    assert.notEqual(
      normalizeRepeatedQuestionKey("출입인가"),
      normalizeRepeatedQuestionKey("출입 되나요?"),
    );
  });

  test("정중형 '인가요'는 그대로 흡수한다", () => {
    assert.equal(normalizeRepeatedQuestionKey("환불 대상인가요?"), normalizeRepeatedQuestionKey("환불 대상"));
  });
});

describe("buildRepeatedQuestionReport (실제 함수 실행)", () => {
  test("같은 질문이 기준 이상 반복되면 한 그룹으로 집계한다", () => {
    const report = buildRepeatedQuestionReport(
      [
        row({ question: "환불 규정 알려주세요", created_at: daysAgo(5) }),
        row({ question: "환불 규정 알려줘", created_at: daysAgo(3) }),
        row({ question: "환불 규정?", created_at: daysAgo(1) }),
      ],
      { storeId: STORE_A, now: NOW },
    );

    assert.equal(report.groups.length, 1);
    assert.equal(report.groups[0].repeatCount, 3);
    assert.equal(report.groups[0].representativeQuestion, "환불 규정?");
    assert.equal(report.groups[0].firstAskedAt, daysAgo(5));
    assert.equal(report.groups[0].lastAskedAt, daysAgo(1));
    assert.equal(report.analyzedLogCount, 3);
  });

  test("기준 미만으로 반복된 질문은 그룹에 넣지 않는다", () => {
    const report = buildRepeatedQuestionReport(repeat(2), { storeId: STORE_A, now: NOW });

    assert.deepEqual(report.groups, []);
    assert.equal(report.analyzedLogCount, 2);
  });

  test("서로 다른 질문은 각각 세어 기준을 넘지 못하면 제외된다", () => {
    const report = buildRepeatedQuestionReport(
      [
        ...repeat(2, { question: "환불 어떻게" }),
        ...repeat(2, { question: "발주 어떻게" }),
        ...repeat(2, { question: "청소 어떻게" }),
      ],
      { storeId: STORE_A, now: NOW },
    );

    assert.deepEqual(report.groups, []);
    assert.equal(report.analyzedLogCount, 6);
  });

  test("다른 매장 질문은 섞이지 않는다", () => {
    const report = buildRepeatedQuestionReport(
      [
        ...repeat(3, { question: "환불 어떻게", store_id: STORE_A }),
        ...repeat(5, { question: "환불 어떻게", store_id: STORE_B }),
      ],
      { storeId: STORE_A, now: NOW },
    );

    assert.equal(report.groups.length, 1);
    assert.equal(report.groups[0].repeatCount, 3);
    assert.equal(report.analyzedLogCount, 3);
  });

  test("store_id가 NULL인 022 이전 로그는 제외한다", () => {
    const report = buildRepeatedQuestionReport(
      [
        ...repeat(2, { question: "환불 어떻게" }),
        ...repeat(4, { question: "환불 어떻게", store_id: null }),
      ],
      { storeId: STORE_A, now: NOW },
    );

    assert.deepEqual(report.groups, []);
    assert.equal(report.analyzedLogCount, 2);
  });

  test("기간 밖 로그는 제외한다", () => {
    const report = buildRepeatedQuestionReport(
      [
        ...repeat(2, { question: "환불 어떻게", created_at: daysAgo(2) }),
        ...repeat(3, { question: "환불 어떻게", created_at: daysAgo(30) }),
      ],
      { storeId: STORE_A, now: NOW },
    );

    assert.deepEqual(report.groups, []);
    assert.equal(report.analyzedLogCount, 2);
  });

  test("반복 횟수가 많은 그룹이 먼저 온다", () => {
    const report = buildRepeatedQuestionReport(
      [
        ...repeat(3, { question: "환불 어떻게" }),
        ...repeat(5, { question: "발주 어떻게" }),
        ...repeat(4, { question: "청소 어떻게" }),
      ],
      { storeId: STORE_A, now: NOW },
    );

    assert.deepEqual(report.groups.map((g) => g.repeatCount), [5, 4, 3]);
  });

  test("형식이 깨진 로그는 조용히 건너뛴다", () => {
    const report = buildRepeatedQuestionReport(
      [
        ...repeat(3, { question: "환불 어떻게" }),
        row({ question: 123 }),
        row({ status: "unknown" }),
        row({ created_at: "not-a-date" }),
        row({ question: "   " }),
      ],
      { storeId: STORE_A, now: NOW },
    );

    assert.equal(report.groups.length, 1);
    assert.equal(report.analyzedLogCount, 3);
  });

  test("기준값은 설정으로 바꿀 수 있고 리포트에 그대로 담긴다", () => {
    const report = buildRepeatedQuestionReport(repeat(2, { question: "환불 어떻게" }), {
      storeId: STORE_A,
      now: NOW,
      windowDays: 30,
      minCount: 2,
    });

    assert.equal(report.groups.length, 1);
    assert.equal(report.windowDays, 30);
    assert.equal(report.minCount, 2);
  });

  test("기본 기준값과 '검증 전 가정' 표시를 리포트에 남긴다", () => {
    const report = buildRepeatedQuestionReport([], { storeId: STORE_A, now: NOW });

    assert.equal(report.windowDays, REPEATED_QUESTION_WINDOW_DAYS);
    assert.equal(report.minCount, REPEATED_QUESTION_MIN_COUNT);
    assert.equal(report.windowDays, 7);
    assert.equal(report.minCount, 3);
    assert.equal(report.thresholdsValidated, false);
    assert.equal(REPEATED_QUESTION_THRESHOLDS_VALIDATED, false);
  });

  test("검증된 매장 id가 비어 있으면 아무것도 집계하지 않는다", () => {
    const report = buildRepeatedQuestionReport(repeat(5), { storeId: "", now: NOW });

    assert.deepEqual(report.groups, []);
    assert.equal(report.analyzedLogCount, 0);
  });
});

describe("상태별 분류", () => {
  test("전부 insufficient면 매뉴얼 공백 후보다", () => {
    const report = buildRepeatedQuestionReport(repeat(3, { status: "insufficient" }), {
      storeId: STORE_A,
      now: NOW,
    });

    assert.equal(report.groups[0].category, "manual_gap_candidate");
    assert.deepEqual(report.groups[0].statusCounts, { answered: 0, cautious: 0, insufficient: 3 });
  });

  test("답변 가능한 질문의 반복은 교육·안내 개선 후보다", () => {
    const report = buildRepeatedQuestionReport(
      [
        ...repeat(2, { question: "마감 순서", status: "answered" }),
        ...repeat(1, { question: "마감 순서", status: "cautious" }),
      ],
      { storeId: STORE_A, now: NOW },
    );

    assert.equal(report.groups[0].category, "guidance_gap_candidate");
    assert.deepEqual(report.groups[0].statusCounts, { answered: 2, cautious: 1, insufficient: 0 });
  });

  test("답변 가능·불가가 섞이면 mixed로 표시한다", () => {
    const report = buildRepeatedQuestionReport(
      [
        ...repeat(2, { question: "마감 순서", status: "answered" }),
        ...repeat(1, { question: "마감 순서", status: "insufficient" }),
      ],
      { storeId: STORE_A, now: NOW },
    );

    assert.equal(report.groups[0].category, "mixed_candidate");
    assert.deepEqual(report.groups[0].statusCounts, { answered: 2, cautious: 0, insufficient: 1 });
  });

  test("insufficient가 과반이면 매뉴얼 공백 후보로 올린다", () => {
    const report = buildRepeatedQuestionReport(
      [
        ...repeat(1, { question: "마감 순서", status: "answered" }),
        ...repeat(2, { question: "마감 순서", status: "insufficient" }),
      ],
      { storeId: STORE_A, now: NOW },
    );

    assert.equal(report.groups[0].category, "manual_gap_candidate");
  });

  test("모든 분류가 '후보'임을 이름과 라벨로 드러낸다", () => {
    for (const [category, label] of Object.entries(REPEATED_QUESTION_CATEGORY_LABELS)) {
      assert.match(category, /_candidate$/, category);
      assert.match(label, /후보|혼재/, label);
      assert.match(label, /점주 확인 필요/, label);
    }
  });

  test("그룹에 단정적이지 않은 라벨을 함께 담는다", () => {
    const report = buildRepeatedQuestionReport(repeat(3, { status: "insufficient" }), {
      storeId: STORE_A,
      now: NOW,
    });

    assert.equal(report.groups[0].categoryLabel, "매뉴얼 공백 후보 (점주 확인 필요)");
    assert.equal(report.groups[0].categoryLabel.includes("확정"), false);
  });

  test("이 단계에서는 알림을 보내거나 매뉴얼을 고치지 않는다", async () => {
    // 집계 함수는 읽기 전용 결과만 돌려준다. 쓰기 경로가 있으면 가짜 client가 예외를 던진다.
    const { client } = fakeClient({ rows: repeat(3) });
    const result = await fetchRepeatedQuestionsForStore(client, { storeId: STORE_A, now: NOW });

    assert.equal(result.status, "ok");
  });
});

describe("확인할 매뉴얼 후보", () => {
  test("로그의 출처가 하나로 일치할 때만 후보 매뉴얼 id를 담는다", () => {
    const report = buildRepeatedQuestionReport(
      repeat(3, { question: "마감 순서", status: "answered", source_manual_id: MANUAL_1 }),
      { storeId: STORE_A, now: NOW },
    );

    assert.equal(report.groups[0].candidateManualId, MANUAL_1);
  });

  test("출처가 엇갈리면 null로 둔다", () => {
    const report = buildRepeatedQuestionReport(
      [
        ...repeat(2, { question: "마감 순서", status: "answered", source_manual_id: MANUAL_1 }),
        ...repeat(1, { question: "마감 순서", status: "answered", source_manual_id: MANUAL_2 }),
      ],
      { storeId: STORE_A, now: NOW },
    );

    assert.equal(report.groups[0].candidateManualId, null);
  });

  test("출처가 없으면 null로 둔다", () => {
    const report = buildRepeatedQuestionReport(repeat(3), { storeId: STORE_A, now: NOW });

    assert.equal(report.groups[0].candidateManualId, null);
  });
});

describe("AI 초안 입력 데이터 계약", () => {
  test("대표 질문·반복 횟수·기간·상태별 건수만 담는다", () => {
    const report = buildRepeatedQuestionReport(
      [
        row({ question: "환불 규정 알려주세요", created_at: daysAgo(5) }),
        row({ question: "환불 규정 알려줘", created_at: daysAgo(3) }),
        row({ question: "환불 규정?", created_at: daysAgo(1) }),
      ],
      { storeId: STORE_A, now: NOW },
    );
    const input = toManualImprovementDraftInput(report.groups[0], report);

    assert.deepEqual(Object.keys(input).sort(), [
      "category",
      "categoryLabel",
      "constraints",
      "manualToVerify",
      "repeatCount",
      "representativeQuestion",
      "reviewStatus",
      "statusCounts",
      "storeId",
      "window",
    ]);
    assert.equal(input.repeatCount, 3);
    assert.equal(input.window.days, 7);
  });

  test("항상 점주 검토 전 초안으로 표시한다", () => {
    const report = buildRepeatedQuestionReport(repeat(3), { storeId: STORE_A, now: NOW });
    const input = toManualImprovementDraftInput(report.groups[0], report);

    assert.equal(input.reviewStatus, "draft_pending_owner_review");
    assert.equal(input.constraints, MANUAL_IMPROVEMENT_DRAFT_CONSTRAINTS);
    assert.ok(input.constraints.some((rule) => rule.includes("새로 만들지 않는다")));
    assert.ok(input.constraints.some((rule) => rule.includes("점주 검토 전 초안")));
  });

  test("insufficient 반복을 원인 확정으로 읽지 말라고 명시한다", () => {
    assert.ok(
      MANUAL_IMPROVEMENT_DRAFT_CONSTRAINTS.some((rule) =>
        rule.includes("원인 확정이 아니다")
        && rule.includes("검색 실패")
        && rule.includes("임계값")),
      JSON.stringify(MANUAL_IMPROVEMENT_DRAFT_CONSTRAINTS),
    );
  });

  test("후보 매뉴얼을 근거로 단정하지 말라고 명시한다", () => {
    assert.ok(
      MANUAL_IMPROVEMENT_DRAFT_CONSTRAINTS.some((rule) =>
        rule.includes("manualToVerify")
        && rule.includes("보장이 아니다")
        && rule.includes("점주가 확인")),
      JSON.stringify(MANUAL_IMPROVEMENT_DRAFT_CONSTRAINTS),
    );
  });

  test("출처가 확인된 경우에만 확인할 매뉴얼 후보를 넣는다", () => {
    const withCandidate = buildRepeatedQuestionReport(
      repeat(3, { status: "answered", source_manual_id: MANUAL_1 }),
      { storeId: STORE_A, now: NOW },
    );
    assert.deepEqual(
      toManualImprovementDraftInput(withCandidate.groups[0], withCandidate).manualToVerify,
      { manualId: MANUAL_1 },
    );

    const without = buildRepeatedQuestionReport(repeat(3), { storeId: STORE_A, now: NOW });
    assert.equal(toManualImprovementDraftInput(without.groups[0], without).manualToVerify, null);
  });

  test("개별 질문 원문이나 답변 본문을 통째로 넘기지 않는다", () => {
    const report = buildRepeatedQuestionReport(
      [
        row({ question: "환불 규정 알려주세요", created_at: daysAgo(5) }),
        row({ question: "환불 규정 알려줘", created_at: daysAgo(3) }),
        row({ question: "환불 규정 궁금해요", created_at: daysAgo(1) }),
      ],
      { storeId: STORE_A, now: NOW },
    );
    const input = toManualImprovementDraftInput(report.groups[0], report);
    const serialized = JSON.stringify(input);

    // 대표 질문 1개만 담기고 나머지 표현은 넘어가지 않는다.
    assert.equal(input.representativeQuestion, "환불 규정 궁금해요");
    assert.equal(serialized.includes("알려주세요"), false);
    assert.equal(serialized.includes("알려줘"), false);
    assert.equal(serialized.includes("log-"), false);
    assert.equal(serialized.includes("similarity"), false);
  });
});

type FakeClientOptions = {
  rows?: QuestionLogRow[];
  failQuery?: boolean;
  throwQuery?: boolean;
};

/** 001+022의 question_logs만 흉내낸다. 쓰기 경로는 아예 제공하지 않는다. */
function fakeClient(options: FakeClientOptions = {}) {
  const rows = options.rows ?? [];
  const selectedColumns: string[] = [];
  const appliedRanges: Array<[number, number]> = [];
  let appliedGte: { column: string; value: string } | null = null;
  let appliedLte: { column: string; value: string } | null = null;

  const client = {
    from(table: string) {
      if (table !== "question_logs") {
        throw new Error(`Unexpected table: ${table}`);
      }
      if (options.throwQuery) {
        throw new Error("fetch failed");
      }

      return {
        select(columns: string) {
          selectedColumns.push(columns);
          const filters: Record<string, unknown> = {};
          const query = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return query;
            },
            gte(column: string, value: string) {
              appliedGte = { column, value };
              return query;
            },
            lte(column: string, value: string) {
              appliedLte = { column, value };
              return query;
            },
            order() {
              return query;
            },
            range(from: number, to: number) {
              appliedRanges.push([from, to]);
              if (options.failQuery) {
                return Promise.resolve({
                  data: null,
                  error: { code: "42703", message: 'column "x" does not exist: select * from question_logs' },
                });
              }
              const matched = rows
                .filter((item) => item.store_id === filters.store_id)
                .filter((item) => !appliedGte || String(item.created_at) >= appliedGte.value)
                .filter((item) => !appliedLte || String(item.created_at) <= appliedLte.value)
                .slice(from, to + 1);
              return Promise.resolve({ data: matched, error: null });
            },
          };
          return query;
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, inspect: () => ({ selectedColumns, appliedRanges, appliedGte, appliedLte }) };
}

describe("fetchRepeatedQuestionsForStore (가짜 DB로 실제 함수 실행)", () => {
  test("검증된 매장의 반복 질문만 집계한다", async () => {
    const { client } = fakeClient({
      rows: [
        ...repeat(3, { question: "환불 어떻게", store_id: STORE_A }),
        ...repeat(9, { question: "환불 어떻게", store_id: STORE_B }),
      ],
    });
    const result = await fetchRepeatedQuestionsForStore(client, { storeId: STORE_A, now: NOW });

    assert.equal(result.status, "ok");
    const report = result.status === "ok" ? result.report : null;
    assert.equal(report?.groups.length, 1);
    assert.equal(report?.groups[0].repeatCount, 3);
    assert.equal(report?.storeId, STORE_A);
  });

  test("반복이 없으면 빈 그룹으로 성공한다", async () => {
    const { client } = fakeClient({ rows: repeat(1) });
    const result = await fetchRepeatedQuestionsForStore(client, { storeId: STORE_A, now: NOW });

    assert.equal(result.status, "ok");
    assert.deepEqual(result.status === "ok" ? result.report.groups : null, []);
  });

  test("매장 id가 없으면 조회하지 않는다", async () => {
    const { client, inspect } = fakeClient({ rows: repeat(5) });
    for (const storeId of ["", "   "]) {
      const result = await fetchRepeatedQuestionsForStore(client, { storeId, now: NOW });
      assert.equal(result.status, "invalid_store");
    }
    assert.equal(inspect().selectedColumns.length, 0);
  });

  test("필요한 컨럼만 읽고 기간을 건다 (페이지 단위)", async () => {
    const { client, inspect } = fakeClient({ rows: repeat(3) });
    await fetchRepeatedQuestionsForStore(client, { storeId: STORE_A, now: NOW });
    const applied = inspect();

    assert.equal(applied.selectedColumns[0], "id, question, status, store_id, source_manual_id, created_at");
    assert.deepEqual(applied.appliedRanges[0], [0, QUESTION_LOG_PAGE_SIZE - 1]);
    assert.equal(applied.appliedGte?.column, "created_at");
    assert.equal(applied.appliedGte?.value, daysAgo(REPEATED_QUESTION_WINDOW_DAYS));
    assert.equal(applied.appliedLte?.value, NOW.toISOString());
  });

  test("서버 max-rows보다 많은 7일 로그도 끝까지 읽어 누락 없이 집계한다", async () => {
    const many = [
      ...repeat(2500, { question: "다른 질문", created_at: daysAgo(0.5) }),
      ...repeat(3, { question: "환불 어떻게", created_at: daysAgo(6) }),
    ];
    const { client, inspect } = fakeClient({ rows: many });
    const result = await fetchRepeatedQuestionsForStore(client, { storeId: STORE_A, now: NOW });

    assert.equal(result.status, "ok");
    assert.equal(result.status === "ok" && result.truncated, false);
    const groups = result.status === "ok" ? result.report.groups : [];
    assert.equal(groups.find((g) => g.groupKey === normalizeRepeatedQuestionKey("환불 어떻게"))?.repeatCount, 3);
    assert.ok(inspect().appliedRanges.length >= 3);
  });

  test("분석 상한에 닿으면 truncated로 알린다", async () => {
    const { client } = fakeClient({ rows: repeat(MAX_ANALYZED_QUESTION_LOGS + 5, { created_at: daysAgo(1) }) });
    const result = await fetchRepeatedQuestionsForStore(client, { storeId: STORE_A, now: NOW });

    assert.equal(result.status === "ok" && result.truncated, true);
  });

  test("정확히 상한만큼이면 truncated가 아니고 상한을 넘는 오래된 로그만 버린다", async () => {
    const exact = fakeClient({ rows: repeat(MAX_ANALYZED_QUESTION_LOGS, { created_at: daysAgo(1) }) });
    const exactResult = await fetchRepeatedQuestionsForStore(exact.client, { storeId: STORE_A, now: NOW });
    assert.equal(exactResult.status === "ok" && exactResult.truncated, false);
    assert.equal(exactResult.status === "ok" && exactResult.report.analyzedLogCount, MAX_ANALYZED_QUESTION_LOGS);

    const over = fakeClient({ rows: repeat(MAX_ANALYZED_QUESTION_LOGS + 1, { created_at: daysAgo(1) }) });
    const overResult = await fetchRepeatedQuestionsForStore(over.client, { storeId: STORE_A, now: NOW });
    assert.equal(overResult.status === "ok" && overResult.report.analyzedLogCount, MAX_ANALYZED_QUESTION_LOGS);
  });

  test("조회 실패는 원본 DB 오류 없이 failed로 수렴한다", async () => {
    const { client } = fakeClient({ failQuery: true, rows: repeat(3) });
    const result = await fetchRepeatedQuestionsForStore(client, { storeId: STORE_A, now: NOW });

    assert.equal(result.status, "failed");
    const serialized = JSON.stringify(result);
    for (const leak of ["42703", "does not exist", "select * from"]) {
      assert.equal(serialized.includes(leak), false, `leaks ${leak}`);
    }
  });

  test("예외가 나도 호출부로 던지지 않는다", async () => {
    const { client } = fakeClient({ throwQuery: true, rows: repeat(3) });
    const result = await fetchRepeatedQuestionsForStore(client, { storeId: STORE_A, now: NOW });

    assert.equal(result.status, "failed");
  });
});
