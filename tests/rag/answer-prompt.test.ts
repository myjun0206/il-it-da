import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ANSWER_SYSTEM_PROMPT,
  buildAnswerPromptMessages,
  buildManualContext,
} from "../../lib/rag/answer-prompt.ts";

const PEAK_TIME_CONTENT = "12시부터 14시까지와 16시부터 18시까지 주문이 증가합니다.";
const OPEN_TIME_CONTENT = "평일은 오전 7시 30분, 주말은 오전 8시 30분까지 출근합니다.";

describe("RAG answer prompt", () => {
  test("includes safety rules for complete grounded answers", () => {
    assert.match(ANSWER_SYSTEM_PROMPT, /여러 시간, 위치, 조건/);
    assert.match(ANSWER_SYSTEM_PROMPT, /빠짐없이 답변/);
    assert.match(ANSWER_SYSTEM_PROMPT, /숫자, 시간, 위치/);
    assert.match(ANSWER_SYSTEM_PROMPT, /축약하거나 생략하지 말고/);
    assert.match(ANSWER_SYSTEM_PROMPT, /근거에 없는 행동을 추론하여 지시하지 마라/);
    assert.match(ANSWER_SYSTEM_PROMPT, /추측하거나 지어 내지 마라/);
    assert.match(ANSWER_SYSTEM_PROMPT, /위치 변경/);
    assert.match(ANSWER_SYSTEM_PROMPT, /임의로 이동하거나 복구하라고 지시하지 말고/);
    assert.match(ANSWER_SYSTEM_PROMPT, /매장 관리자에게 확인/);
    assert.match(ANSWER_SYSTEM_PROMPT, /제공된 근거 안에서만 작성/);
  });

  test("builds manual context without changing chunk content", () => {
    assert.equal(
      buildManualContext([
        { title: "피크타임", content: PEAK_TIME_CONTENT },
        { title: "오픈", content: OPEN_TIME_CONTENT },
      ]),
      `[매뉴얼 1: 피크타임]\n${PEAK_TIME_CONTENT}\n\n[매뉴얼 2: 오픈]\n${OPEN_TIME_CONTENT}`,
    );
  });

  test("builds system and user messages for the answer request", () => {
    assert.deepEqual(buildAnswerPromptMessages("질문", "근거"), [
      { role: "system", content: ANSWER_SYSTEM_PROMPT },
      { role: "user", content: "[참고 매뉴얼]\n근거\n\n[직원 질문]\n질문" },
    ]);
  });
});