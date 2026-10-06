import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildBossQuestionDetailUrl,
  buildBossQuestionsUrl,
  classifyPendingQuestionsResponse,
  pickQuestionsStore,
  visibleQuestionsState,
} from "../../lib/owner/boss-questions-view.ts";

const STORE_A = { storeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", storeName: "A점" };
const STORE_B = { storeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", storeName: "B점" };
const FOREIGN_STORE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const QUESTION_A = {
  id: "11111111-1111-4111-8111-111111111111",
  question: "A점 폐기 기준이 뭔가요?",
  status: "insufficient",
  createdAt: "2026-09-29T01:00:00.000Z",
  originReason: "manual_gap",
  repeatCount: 1,
};

describe("pickQuestionsStore (URL storeId 대조)", () => {
  test("승인된 내 매장이면 URL의 매장을 채택한다", () => {
    const choice = pickQuestionsStore([STORE_A, STORE_B], STORE_A, STORE_B.storeId);
    assert.deepEqual(choice, { store: STORE_B, requestedStoreRejected: false });
  });

  test("승인 목록에 없는 매장 id는 신뢰하지 않고 현재 매장을 유지한다", () => {
    const choice = pickQuestionsStore([STORE_A, STORE_B], STORE_A, FOREIGN_STORE_ID);
    assert.deepEqual(choice, { store: STORE_A, requestedStoreRejected: true });
  });

  test("URL에 매장이 없으면 기존 현재 매장 선택을 따른다", () => {
    assert.deepEqual(pickQuestionsStore([STORE_A, STORE_B], STORE_B, null), {
      store: STORE_B,
      requestedStoreRejected: false,
    });
    assert.deepEqual(pickQuestionsStore([STORE_A], STORE_A, "  "), {
      store: STORE_A,
      requestedStoreRejected: false,
    });
  });

  test("승인된 매장이 없으면 URL 매장도 채택하지 않는다", () => {
    assert.deepEqual(pickQuestionsStore([], null, STORE_A.storeId), {
      store: null,
      requestedStoreRejected: true,
    });
  });
});

describe("classifyPendingQuestionsResponse", () => {
  test("성공 응답은 질문 목록으로 분류한다", () => {
    const state = classifyPendingQuestionsResponse(STORE_A.storeId, 200, {
      success: true,
      data: { questions: [QUESTION_A], limit: 20 },
    });
    assert.equal(state.kind, "ready");
    assert.deepEqual(state.kind === "ready" ? state.questions : [], [QUESTION_A]);
  });

  test("처리 상태가 없는 답변 가능 반복 질문도 검토 항목으로 분류한다", () => {
    const repeatedReview = {
      ...QUESTION_A,
      status: "cautious",
      resolutionStatus: null,
      resolutionRevision: null,
      originReason: "frequent_question",
      repeatCount: 5,
    };
    const state = classifyPendingQuestionsResponse(STORE_A.storeId, 200, {
      success: true,
      data: { questions: [repeatedReview], limit: 20 },
    });

    assert.deepEqual(state.kind === "ready" ? state.questions : [], [repeatedReview]);
  });

  test("빈 목록은 오류가 아니라 빈 상태다", () => {
    const state = classifyPendingQuestionsResponse(STORE_A.storeId, 200, {
      success: true,
      data: { questions: [], limit: 20 },
    });
    assert.deepEqual(state, { kind: "ready", storeId: STORE_A.storeId, questions: [], resolutionFeatureAvailable: true });
  });

  test("401·403은 권한 오류로 구분한다", () => {
    for (const status of [401, 403]) {
      const state = classifyPendingQuestionsResponse(STORE_A.storeId, status, { success: false, error: "x" });
      assert.equal(state.kind, "forbidden", String(status));
    }
  });

  test("500·깨진 본문은 조회 실패로 분류한다", () => {
    assert.equal(classifyPendingQuestionsResponse(STORE_A.storeId, 500, { success: false }).kind, "error");
    assert.equal(classifyPendingQuestionsResponse(STORE_A.storeId, 400, { success: false }).kind, "error");
    assert.equal(classifyPendingQuestionsResponse(STORE_A.storeId, 200, null).kind, "error");
    assert.equal(classifyPendingQuestionsResponse(STORE_A.storeId, 200, { success: true, data: {} }).kind, "error");
  });

  test("형식이 깨진 질문 항목은 제외한다", () => {
    const state = classifyPendingQuestionsResponse(STORE_A.storeId, 200, {
      success: true,
      data: { questions: [QUESTION_A, { ...QUESTION_A, originReason: "unknown" }, { id: 1 }, null] },
    });
    assert.deepEqual(state.kind === "ready" ? state.questions : [], [QUESTION_A]);
  });
});

describe("visibleQuestionsState (매장 전환 시 섞임 방지)", () => {
  test("다른 매장의 결과는 새 매장 아래 보이지 않고 로딩으로 취급한다", () => {
    const previous = classifyPendingQuestionsResponse(STORE_A.storeId, 200, {
      success: true,
      data: { questions: [QUESTION_A] },
    });
    assert.deepEqual(visibleQuestionsState(previous, STORE_B.storeId), {
      kind: "loading",
      storeId: STORE_B.storeId,
    });
  });

  test("오류 상태도 매장이 다르면 새 매장에 넘어오지 않는다", () => {
    assert.equal(
      visibleQuestionsState({ kind: "forbidden", storeId: STORE_A.storeId }, STORE_B.storeId).kind,
      "loading",
    );
  });

  test("같은 매장 결과만 그대로 보여준다", () => {
    const state = {
      kind: "ready" as const,
      storeId: STORE_B.storeId,
      questions: [],
      resolutionFeatureAvailable: true,
    };
    assert.strictEqual(visibleQuestionsState(state, STORE_B.storeId), state);
    assert.equal(visibleQuestionsState(null, STORE_B.storeId).kind, "loading");
  });
});

describe("알림 링크와 화면 연결", () => {
  test("매장 id를 인코딩해 /boss/questions 링크를 만든다", () => {
    assert.equal(buildBossQuestionsUrl(STORE_A.storeId), `/boss/questions?storeId=${STORE_A.storeId}`);
    assert.equal(buildBossQuestionsUrl("a&b=c"), "/boss/questions?storeId=a%26b%3Dc");
  });

  test("상세 페이지 링크에 질문 id와 매장 id를 안전하게 인코딩한다", () => {
    assert.equal(
      buildBossQuestionDetailUrl("question/1", "store&1"),
      "/boss/questions/question%2F1?storeId=store%261",
    );
  });

  const viewSource = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/boss/questions/BossQuestionsView.tsx"),
    "utf8",
  );

  test("화면은 GET /api/boss/question-logs로 목록을 조회하고 PATCH로 처리 상태를 변경한다", () => {
    assert.match(viewSource, /\/api\/boss\/question-logs\?\$\{queryParams\.toString\(\)\}/);
    assert.match(viewSource, /method:\s*["']PATCH["']/);
  });

  test("알림의 질문 id는 승인 매장으로 채택됐을 때만 목록 API에 넘겨 완료·범위 밖 질문도 포함시킨다", () => {
    assert.match(
      viewSource,
      /storeState\.status === "ready" && !storeState\.requestedStoreRejected \? highlightQuestionId : null/,
    );
    assert.match(viewSource, /if \(highlightForFetch\) queryParams\.set\("questionId", highlightForFetch\);/);
  });

  test("각 카드 우측 하단에 원인별 배지와 반복 횟수를 표시한다", () => {
    assert.match(viewSource, /originReason === "frequent_question"/);
    assert.match(viewSource, /flex items-end justify-between/);
    assert.match(viewSource, /반복 질문 \(\{question\.repeatCount\}회\)/);
    assert.match(viewSource, /매뉴얼 근거 부족/);
    assert.equal((viewSource.match(/<Repeat2\b/g) ?? []).length, 1);
    assert.equal((viewSource.match(/<BookOpen\b/g) ?? []).length, 1);
  });

  test("처리 시작 버튼은 상태 변경 후 상세 처리 페이지로 이동한다", () => {
    assert.match(viewSource, /question\.resolutionStatus &&/);
    assert.match(viewSource, /반복 검토/);
    assert.match(viewSource, /처리 시작/);
    assert.match(viewSource, /router\.push\(buildBossQuestionDetailUrl\(question\.id, storeState\.store\.storeId\)\)/);
    assert.match(viewSource, /setUpdateSuccess\(nextStatus === "resolved" \? "질문을 처리 완료로 변경했습니다\."/);
  });

  test("확인 중 카드 클릭은 상세로 이동하고 카드 내부 버튼 클릭은 전파되지 않는다", () => {
    assert.match(viewSource, /const isInProgress = question\.resolutionStatus === "in_progress"/);
    assert.match(viewSource, /role=\{isInProgress \? "link" : undefined\}/);
    assert.match(viewSource, /tabIndex=\{isInProgress \? 0 : undefined\}/);
    assert.match(viewSource, /onClick=\{isInProgress \? \(\) => router\.push\(detailUrl\) : undefined\}/);
    assert.match(viewSource, /cursor-pointer hover:border-\[var\(--color-primary\)\]/);
    assert.match(viewSource, /event\.stopPropagation\(\)/);
  });

  test("상세 페이지는 ID로 기존 질문 API를 조회하고 원문·유입 사유·상태 전이를 제공한다", () => {
    const detailSource = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/boss/questions/[id]/BossQuestionDetailView.tsx"),
      "utf8",
    );
    const routeSource = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/boss/questions/[id]/page.tsx"),
      "utf8",
    );
    const listPageSource = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/boss/questions/page.tsx"),
      "utf8",
    );

    assert.match(routeSource, /params: Promise<\{ id: string \}>/);
    assert.match(routeSource, /questionId=\{id\}/);
    assert.match(detailSource, /resolutionStatus: "all"/);
    assert.match(detailSource, /questionId,/);
    assert.match(detailSource, /detail\.question\.question/);
    assert.match(detailSource, /detail\.question\.originReason === "frequent_question"/);
    assert.match(detailSource, /handleStatusChange\("resolved"\)/);
    assert.match(detailSource, /보류 질문으로 돌아가기/);
    assert.match(detailSource, /buildBossQuestionsUrl\(detail\.store\.storeId\)/);
    assert.doesNotMatch(detailSource, /목록으로/);
    assert.doesNotMatch(listPageSource, /resolutionStatus/);
    assert.match(viewSource, /useState<QuestionResolutionFilter>\("active"\)/);
    const filterTabs = viewSource.match(/const RESOLUTION_FILTER_TABS:[\s\S]*?\];/)?.[0] ?? "";
    assert.match(filterTabs, /label: "확인 필요"/);
    assert.doesNotMatch(filterTabs, /label: "미처리"|label: "확인 중"/);
  });

  test("URL storeId는 승인된 점주 매장 목록과 대조한 뒤에만 쓴다", () => {
    assert.match(viewSource, /resolveOwnerCurrentStore\(\)/);
    assert.match(viewSource, /pickQuestionsStore\(resolution\.stores, resolution\.current, requestedStoreId\)/);
    assert.equal(/question-logs\?storeId=\$\{encodeURIComponent\(requestedStoreId/.test(viewSource), false);
  });

  test("사이드바 '보류 질문' 메뉴가 /boss/questions를 가리키고 화면의 활성 id와 일치한다", () => {
    const sidebarSource = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../components/owner/OwnerSidebar.tsx"),
      "utf8",
    );
    assert.match(
      sidebarSource,
      /\{ id: "questions", label: "보류 질문", icon: \w+, href: "\/boss\/questions" \}/,
    );
    assert.match(viewSource, /<OwnerSidebar activeMenu="questions"/);
  });

  test("알림 없이 들어오면 현재 선택한 승인 매장을 쓴다", () => {
    assert.deepEqual(pickQuestionsStore([STORE_A, STORE_B], STORE_B, null), {
      store: STORE_B,
      requestedStoreRejected: false,
    });
  });
});
