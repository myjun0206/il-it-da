import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  expandSearchQuestion,
  extractSearchKeywords,
  formatSearchEmbeddingInput,
} from "../../lib/rag/search-query.ts";

describe("Korean RAG search query expansion", () => {
  test("beverage temperature and steaming hints preserve the question without assigning a latte menu", () => {
    const question = "따뜻한 라떼 우유 얼마나 넣고 몇 도까지 데워요?";
    const expanded = expandSearchQuestion(question);
    assert.ok(expanded.startsWith(question));
    assert.ok(expanded.includes("HOT"));
    assert.ok(expanded.includes("스팀 온도"));
    for (const menu of ["카페라떼", "바닐라라떼", "딸기라떼"]) assert.equal(expanded.includes(menu), false);
    const exact = "HOT 카페라떼 우유 240ml를 60~65℃로 스팀하나요?";
    assert.ok(expandSearchQuestion(exact).startsWith(exact));
    assert.ok(expandSearchQuestion(exact).includes("우유 데우기"));
  });

  test("negation, ICE contrast, flavor and unrelated tasks do not acquire HOT steaming assumptions", () => {
    for (const question of ["따뜻한 라떼 말고 ICE 바닐라라떼 우유 얼마나 넣어요?", "우유를 데우지 않고 딸기라떼를 만들어요?", "우유가 거의 없는데 주문 넣어도 돼요?", "튀김기 청소 어떻게 해?"]) {
      const expanded = expandSearchQuestion(question);
      assert.ok(expanded.startsWith(question));
      assert.equal(expanded.includes("HOT"), false);
      assert.equal(expanded.includes("스팀 온도"), false);
    }
  });

  test("stock shortage plus procurement wording retrieves inventory intent without rewriting authorization", () => {
    for (const question of [
      "우유가 거의 없는데 제가 바로 주문 넣어도 돼요?",
      "컵이 얼마 안 남았어요. 주문을 해도 되나요?",
      "소모품이 부족한데 발주해도 되나요?",
      "시럽이 부족한데 주문을 좀 넣어도 돼요?",
    ]) {
      const keywords = extractSearchKeywords(question);
      assert.ok(keywords.includes("재고"), question);
      assert.ok(keywords.includes("발주"), question);
      assert.ok(formatSearchEmbeddingInput(question).includes(question));
    }
    assert.equal(extractSearchKeywords("우유를 데워도 돼요?").includes("발주"), false);
    assert.equal(extractSearchKeywords("패밀리팩 주문 들어왔어요").includes("재고 확인"), false);
    assert.equal(extractSearchKeywords("직원이 부족한데 패밀리팩 주문이 들어왔어요").includes("재고 확인"), false);
  });

  test("bundle counts expand only the requested composition, never a specific menu or size", () => {
    for (const question of [
      "패밀리팩 주문 들어왔는데 버거랑 사이드랑 음료 몇 개씩 챙겨요?",
      "커플 콤보 음료 몇 잔 담아요?",
      "피크닉 묶음은 몇 개 챙기나요?",
    ]) {
      const keywords = extractSearchKeywords(question);
      assert.ok(keywords.includes("구성"), question);
      assert.ok(keywords.includes("수량"), question);
      const expanded = expandSearchQuestion(question);
      assert.ok(expanded.startsWith(question));
      assert.equal(expanded.includes("B 패밀리팩"), false);
      assert.equal(expanded.includes("라지"), false);
    }
    assert.equal(extractSearchKeywords("패밀리팩 환불할 수 있나요?").includes("구성"), false);
    assert.equal(extractSearchKeywords("시럽은 몇 펌프 넣나요?").includes("구성"), false);
  });

  test("colloquial cleaning keeps its target and never acquires disassembly intent", () => {
    for (const question of ["튀김기 청소 어떻게 해?", "튀김기 청소는 어떻게 하면 좋아?", "오븐 청소 어떻게 해요?"]) {
      const keywords = extractSearchKeywords(question);
      assert.ok(keywords.includes("청소"));
      assert.ok(keywords.includes(question.startsWith("튀김기") ? "튀김기" : "오븐"));
      assert.equal(expandSearchQuestion(question).includes("분해"), false);
    }
    const question = "노량진역점 튀김기 내부 부품을 임의로 분해하지 않고 청소할 수 있나요?";
    assert.ok(formatSearchEmbeddingInput(question).includes(question));
    assert.ok(extractSearchKeywords(question).includes("내부"));
  });

  test("expands the Isu weekday business-hours question", () => {
    const question = "이수점은 평일에 언제부터 언제까지 하나요?";
    const expanded = formatSearchEmbeddingInput(question);

    assert.match(expanded, new RegExp(question));
    assert.match(expanded, /영업시간/);
    assert.match(expanded, /운영시간/);
    assert.equal(extractSearchKeywords(question).includes("이수점"), false);
    assert.ok(extractSearchKeywords(question).includes("평일"));
  });

  test("expands the Soongsil weekend opening question", () => {
    const question = "숭실대점은 주말에 문 여나요?";
    const expanded = expandSearchQuestion(question);

    assert.match(expanded, new RegExp(question));
    assert.match(expanded, /오픈/);
    assert.equal(extractSearchKeywords(question).includes("숭실대점"), false);
    assert.ok(extractSearchKeywords(question).includes("주말"));
  });

  test("expands strawberry syrup storage location intent", () => {
    const question = "딸기청은 어디 보관되어 있나요?";
    const keywords = extractSearchKeywords(question);

    assert.match(expandSearchQuestion(question), /위치/);
    assert.ok(keywords.includes("딸기청"));
    assert.ok(keywords.includes("보관 위치"));
    assert.ok(keywords.includes("재고/발주"));
  });

  test("expands coffee machine location intent", () => {
    const question = "커피머신은 어디에 있나요?";
    const expanded = expandSearchQuestion(question);

    assert.match(expanded, /장비/);
    assert.match(expanded, /장비관리/);
    assert.ok(extractSearchKeywords(question).includes("커피머신"));
  });

  test("expands ice maker location intent", () => {
    const question = "제빙기는 어디에 있나요?";
    const keywords = extractSearchKeywords(question);

    assert.ok(keywords.includes("제빙기"));
    assert.ok(keywords.includes("위치"));
    assert.ok(keywords.includes("장비"));
    assert.ok(keywords.includes("장비관리"));
    assert.equal(keywords.includes("보관 위치"), false);
  });

  test("does not add 업무 keywords to an out-of-scope question", () => {
    const question = "오늘 날씨가 어떻게 되나요?";
    const keywords = extractSearchKeywords(question);
    const businessKeywords = [
      "영업시간",
      "운영시간",
      "오픈",
      "마감",
      "위치",
      "보관 위치",
      "커피머신",
      "커피 머신",
      "장비",
      "평일",
      "주말",
      "청소",
      "재고",
      "발주",
      "원두",
      "딸기청",
      "제빙기",
    ];

    assert.equal(keywords.filter((keyword) => businessKeywords.includes(keyword)).length, 0);
  });

  test("includes refund-related terms in embedding input", () => {
    const input = formatSearchEmbeddingInput("환불은 어떻게 하나요?");

    assert.match(input, /결제/);
    assert.match(input, /취소/);
  });

  test("includes ordering-related terms in embedding input", () => {
    const input = formatSearchEmbeddingInput("발주는 어떻게 하나요?");

    assert.match(input, /주문/);
    assert.match(input, /입고/);
  });

  test("removes general weather-question stopwords from keywords", () => {
    const keywords = extractSearchKeywords("오늘 날씨가 어떻게 되나요?");

    assert.equal(keywords.includes("오늘"), false);
    assert.equal(keywords.includes("어떻게"), false);
    assert.equal(keywords.includes("되나요"), false);
  });

  test("keeps store names in embedding input but excludes them from boost keywords", () => {
    const isuQuestion = "이수점에서는 딸기청을 보관하나요?";
    const soongsilQuestion = "숭실대점에는 제빙기가 있나요?";

    assert.match(formatSearchEmbeddingInput(isuQuestion), /이수점에서는/);
    assert.match(formatSearchEmbeddingInput(soongsilQuestion), /숭실대점에는/);
    assert.equal(extractSearchKeywords(isuQuestion).includes("이수점"), false);
    assert.equal(extractSearchKeywords(soongsilQuestion).includes("숭실대점"), false);
  });

  test("adds storage inventory intent for strawberry syrup and beans", () => {
    for (const question of ["딸기청은 어디에 보관하나요?", "원두는 어디에 보관되어 있나요?"]) {
      const keywords = extractSearchKeywords(question);
      assert.ok(keywords.includes("보관 위치"));
      assert.ok(keywords.includes("재고/발주"));
    }
  });

  test("leaves no boost keywords for an arbitrary out-of-scope question", () => {
    assert.deepEqual(extractSearchKeywords("매뉴얼에 없는 임의의 질문에 답해줘."), []);
  });

  test("caps extracted keywords at MAX_KEYWORD_COUNT (16) even with more distinct candidates", () => {
    const manyDistinctKeywordsQuestion = Array.from(
      { length: 20 },
      (_, index) => `키워드${index + 1}`,
    ).join(" ");

    assert.equal(extractSearchKeywords(manyDistinctKeywordsQuestion).length, 16);
  });
});