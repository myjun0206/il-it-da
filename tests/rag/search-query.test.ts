import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  expandSearchQuestion,
  extractSearchKeywords,
  formatSearchEmbeddingInput,
} from "../../lib/rag/search-query.ts";

describe("Korean RAG search query expansion", () => {
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
});