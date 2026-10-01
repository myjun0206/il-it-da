import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  StructuredAnswerParseError,
  parseStructuredAnswer,
  selectProvidedChunkIds,
} from "../../lib/rag/structured-answer.ts";

describe("parseStructuredAnswer", () => {
  test("답변 가능 결과를 그대로 읽는다", () => {
    assert.deepEqual(
      parseStructuredAnswer('{"answerable":true,"answer":"평일 7시 30분","usedChunkIds":["c1","c2"]}'),
      { answerable: true, answer: "평일 7시 30분", usedChunkIds: ["c1", "c2"] },
    );
  });

  test("근거 부족 결과는 빈 답변으로 읽는다", () => {
    assert.deepEqual(parseStructuredAnswer('{"answerable":false,"answer":"","usedChunkIds":[]}'), {
      answerable: false,
      answer: "",
      usedChunkIds: [],
    });
  });

  test("문구를 정규식으로 찾지 않고 answerable 필드만 본다", () => {
    const parsed = parseStructuredAnswer(
      '{"answerable":true,"answer":"잘 모르겠습니다라는 표현이 포함된 매뉴얼 문장","usedChunkIds":["c1"]}',
    );
    assert.equal(parsed.answerable, true);
  });

  test("usedChunkIds가 없거나 형식이 깨져도 빈 배열로 둔다", () => {
    assert.deepEqual(parseStructuredAnswer('{"answerable":true,"answer":"a"}').usedChunkIds, []);
    assert.deepEqual(
      parseStructuredAnswer('{"answerable":true,"answer":"a","usedChunkIds":[1,null,"  ","c1"]}').usedChunkIds,
      ["c1"],
    );
  });

  for (const raw of [
    "",
    "   ",
    "not json",
    "[]",
    "null",
    '{"answer":"a"}',
    '{"answerable":"true","answer":"a"}',
    '{"answerable":true,"answer":"   "}',
  ]) {
    test(`파싱 실패는 예외로 구분한다: ${JSON.stringify(raw)}`, () => {
      assert.throws(() => parseStructuredAnswer(raw), StructuredAnswerParseError);
    });
  }

  test("문자열이 아닌 입력도 예외로 구분한다", () => {
    for (const raw of [null, undefined, 42, {}]) {
      assert.throws(() => parseStructuredAnswer(raw), StructuredAnswerParseError);
    }
  });
});

describe("selectProvidedChunkIds", () => {
  test("실제로 제공한 근거 id만 남긴다", () => {
    assert.deepEqual(selectProvidedChunkIds(["c2", "c9"], ["c1", "c2", "c3"]), ["c2"]);
  });

  test("제공하지 않은 id만 왔다면 아무것도 남지 않는다", () => {
    assert.deepEqual(selectProvidedChunkIds(["made-up"], ["c1", "c2"]), []);
  });

  test("결과 순서는 제공 순서를 따른다", () => {
    assert.deepEqual(selectProvidedChunkIds(["c3", "c1"], ["c1", "c2", "c3"]), ["c1", "c3"]);
  });

  test("중복 id는 한 번만 남는다", () => {
    assert.deepEqual(selectProvidedChunkIds(["c1", "c1"], ["c1", "c2"]), ["c1"]);
  });
});
