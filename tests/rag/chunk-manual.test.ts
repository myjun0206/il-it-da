import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { chunkManualText, type ChunkManualOptions } from "../../lib/rag/chunk-manual.ts";

const DEFAULT_MAX_SIZE = 1_200;

describe("chunkManualText", () => {
  test("returns a single chunk for a short valid Korean sentence", () => {
    const chunks = chunkManualText("일잇다는 매장 운영 매뉴얼을 쉽게 찾도록 돕습니다.");

    assert.equal(chunks.length, 1);
  });

  test("keeps the returned short sentence content identical to the original", () => {
    const text = "고객 응대 전에는 오늘의 예약 현황을 확인합니다.";

    assert.deepEqual(chunkManualText(text), [text]);
  });

  test("trims surrounding whitespace and collapses repeated inline spaces", () => {
    const chunks = chunkManualText("  첫째 줄은   공백을 정리합니다.\n\n\n  둘째\t줄도   정리합니다.  ");

    assert.deepEqual(chunks, ["첫째 줄은 공백을 정리합니다.\n\n둘째 줄도 정리합니다."]);
  });

  test("rejects empty strings and whitespace-only strings", () => {
    assert.throws(() => chunkManualText(""), /cannot be empty/i);
    assert.throws(() => chunkManualText(" \n\t \r\n "), /cannot be empty/i);
  });

  test("rejects non-string runtime input", () => {
    assert.throws(
      () => chunkManualText(12345 as unknown as string),
      /must be a string/i,
    );
  });

  test("rejects input longer than 50000 characters", () => {
    assert.throws(
      () => chunkManualText("가".repeat(50_001)),
      /exceeds maximum allowed length/i,
    );
  });

  test("splits a long Korean sentence into multiple chunks", () => {
    const chunks = chunkManualText("고객 안내 문장을 반복합니다. ".repeat(180));

    assert.ok(chunks.length > 1);
  });

  test("never returns empty chunks for long input", () => {
    const chunks = chunkManualText("운영 절차를 차례대로 설명합니다. ".repeat(180));

    assert.ok(chunks.every((chunk) => chunk.length > 0));
    assert.ok(chunks.every((chunk) => chunk.trim() === chunk));
  });

  test("keeps every chunk within the default maxSize of 1200 characters", () => {
    const chunks = chunkManualText("정산과 마감 절차를 자세히 안내합니다. ".repeat(220));

    assert.ok(chunks.every((chunk) => chunk.length <= DEFAULT_MAX_SIZE));
  });

  test("does not skip middle content for repeated 3000-character input", () => {
    const text = "가".repeat(3_000);
    const chunks = chunkManualText(text, { overlapSize: 0 });

    assert.ok(chunks.length > 2);
    assert.equal(chunks.join(""), text);
  });

  test("preserves paragraph boundaries when a good paragraph cut is available", () => {
    const firstParagraph = "첫 번째 문단은 접객 절차를 설명합니다. ".repeat(8).trim();
    const secondParagraph = "두 번째 문단은 마감 점검 절차를 설명합니다. ".repeat(8).trim();
    const chunks = chunkManualText(`${firstParagraph}\n\n${secondParagraph}`, {
      targetSize: 220,
      maxSize: 300,
      overlapSize: 0,
    });

    assert.equal(chunks[0], firstParagraph);
    assert.equal(chunks[1], secondParagraph);
  });

  test("preserves sentence boundaries when a good sentence cut is available", () => {
    const firstSentence = `${"가".repeat(180)}.`;
    const secondSentence = `${"나".repeat(180)}.`;
    const chunks = chunkManualText(`${firstSentence} ${secondSentence}`, {
      targetSize: 220,
      maxSize: 300,
      overlapSize: 0,
    });

    assert.equal(chunks[0], firstSentence);
    assert.equal(chunks[1], secondSentence);
  });

  test("splits normally when overlapSize is zero", () => {
    const text = "중복 없이 이어지는 운영 매뉴얼 문장입니다. ".repeat(150);
    const chunks = chunkManualText(text, { targetSize: 300, maxSize: 360, overlapSize: 0 });

    assert.ok(chunks.length > 1);
    assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), text.trim());
  });

  test("rejects invalid targetSize maxSize and overlapSize options", () => {
    const text = "옵션 검증용 문장입니다.";
    const invalidOptions: ChunkManualOptions[] = [
      { targetSize: 199 },
      { targetSize: 2_001 },
      { targetSize: 250.5 },
      { targetSize: 300, maxSize: 299 },
      { maxSize: 4_001 },
      { targetSize: 300, overlapSize: -1 },
      { targetSize: 300, overlapSize: 300 },
      { targetSize: 300, overlapSize: 20.5 },
    ];

    for (const options of invalidOptions) {
      assert.throws(() => chunkManualText(text, options));
    }
  });

  test("keeps every custom-option chunk within the configured maxSize", () => {
    const chunks = chunkManualText("재고 확인 절차와 발주 기준을 설명합니다. ".repeat(130), {
      targetSize: 260,
      maxSize: 320,
      overlapSize: 40,
    });

    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.length <= 320));
  });

  test("returns deterministic chunks for the same input and options", () => {
    const text = "반복 실행해도 같은 청크가 나와야 합니다. ".repeat(140);
    const options = { targetSize: 300, maxSize: 360, overlapSize: 50 };

    assert.deepEqual(chunkManualText(text, options), chunkManualText(text, options));
  });
});