import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isManualItemLine, splitTextIntoManualItems } from "../../lib/manuals/detect-manual-item.ts";

describe("splitTextIntoManualItems (Excel/CSV/text cell -> detail item split rules)", () => {
  test("splits on a leading plain number line ('1.', '2.') into independent items", () => {
    const items = splitTextIntoManualItems("1. 문을 연다\n2. 환기를 한다\n3. 조명을 켠다");
    assert.deepEqual(items, ["1. 문을 연다", "2. 환기를 한다", "3. 조명을 켠다"]);
  });

  test("also recognizes '1)' style leading numbers as boundaries", () => {
    const items = splitTextIntoManualItems("1) 첫번째\n2) 두번째");
    assert.deepEqual(items, ["1) 첫번째", "2) 두번째"]);
  });

  test("groups a 'N-N.' sub-numbered trigger line together with its following lines until the next trigger", () => {
    const items = splitTextIntoManualItems("4-1. 청소 절차\n세부 설명 한 줄\n4-2. 점검 절차\n또 다른 설명");
    assert.deepEqual(items, ["4-1. 청소 절차\n세부 설명 한 줄", "4-2. 점검 절차\n또 다른 설명"]);
  });

  test("groups an indented trigger line together with its plain (non-triggering) follow-up lines", () => {
    const items = splitTextIntoManualItems(
      "공지사항\n\t안내 섹션 시작\n이어지는 설명 텍스트\n\t다음 안내 섹션\n또 다른 설명",
    );
    assert.deepEqual(items, [
      "공지사항",
      "안내 섹션 시작\n이어지는 설명 텍스트",
      "다음 안내 섹션\n또 다른 설명",
    ]);
  });

  test("each new indented line starts its own fresh section (does not stay locked to the first trigger)", () => {
    const items = splitTextIntoManualItems("헤더\n\t1. 첫 섹션\n\t2. 두번째 섹션");
    assert.deepEqual(items, ["헤더", "1. 첫 섹션", "2. 두번째 섹션"]);
  });

  test("falls back to blank-line paragraph splitting when no numbered/indented boundary is found", () => {
    const items = splitTextIntoManualItems("첫 번째 문단입니다.\n\n두 번째 문단입니다.");
    assert.deepEqual(items, ["첫 번째 문단입니다.", "두 번째 문단입니다."]);
  });

  test("treats a single plain block of Korean text with no boundary as one item", () => {
    const items = splitTextIntoManualItems("영업 종료 후 매장을 청소하고 소등한다.");
    assert.deepEqual(items, ["영업 종료 후 매장을 청소하고 소등한다."]);
  });

  test("returns an empty array for blank/whitespace-only text", () => {
    assert.deepEqual(splitTextIntoManualItems(""), []);
    assert.deepEqual(splitTextIntoManualItems("   \n  \n"), []);
  });

  test("handles CRLF line endings the same as LF for numbered boundaries", () => {
    const items = splitTextIntoManualItems("1. 첫줄\r\n2. 둘째줄\r\n3. 셋째줄");
    assert.deepEqual(items, ["1. 첫줄", "2. 둘째줄", "3. 셋째줄"]);
  });

  test("handles CRLF line endings for indentation-triggered sections", () => {
    const items = splitTextIntoManualItems("헤더\r\n\t안내 시작\r\n이어지는 내용");
    assert.deepEqual(items, ["헤더", "안내 시작\n이어지는 내용"]);
  });

  test("isManualItemLine identifies a plain numbered boundary line but not a sub-numbered or indented one", () => {
    assert.equal(isManualItemLine("1. 항목"), true);
    assert.equal(isManualItemLine("4-1. 항목"), false);
    assert.equal(isManualItemLine("\t1. 항목"), false);
    assert.equal(isManualItemLine("일반 텍스트"), false);
  });
});
