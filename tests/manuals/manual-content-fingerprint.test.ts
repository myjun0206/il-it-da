import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildManualContentFingerprint,
  normalizeFingerprintText,
  normalizeManualGroupsForFingerprint,
  type FingerprintScope,
} from "../../lib/manuals/manual-content-fingerprint.ts";
import { parseConfirmedManualGroups } from "../../lib/manuals/parse-confirmed-manual-groups.ts";
import type { ManualGroupInput } from "../../lib/rag/save-manual-sections.ts";

const HQ: FingerprintScope = { scopeType: "hq", franchiseId: "franchise-1", storeId: null };
const STORE_1: FingerprintScope = { scopeType: "store", franchiseId: "franchise-1", storeId: "store-1" };

const AURORA: ManualGroupInput[] = [
  {
    category: "주문·결제·고객 응대",
    topic: "오로라 환불 처리 규칙",
    items: ["1. 영수증을 확인한다.", "2. 결제 수단으로 환불한다."],
  },
];

describe("normalizeFingerprintText (실제 함수 실행)", () => {
  test("CRLF와 LF는 같은 값으로 정규화된다", () => {
    assert.equal(normalizeFingerprintText("가\r\n나\r다"), normalizeFingerprintText("가\n나\n다"));
  });

  test("앞뒤 공백과 줄별 공백 차이를 흡수한다", () => {
    assert.equal(normalizeFingerprintText("  오로라 규칙  \n  내용 "), "오로라 규칙\n내용");
  });

  test("연속 공백/탭은 한 칸으로 줄인다", () => {
    assert.equal(normalizeFingerprintText("환불\t\t처리    규칙"), "환불 처리 규칙");
  });

  test("실제 글자가 다르면 정규화 후에도 다르다", () => {
    assert.notEqual(normalizeFingerprintText("환불 규칙"), normalizeFingerprintText("환불 규정"));
  });

  test("같은 한글이 NFC/NFD로 들어와도 같은 값으로 정규화된다", () => {
    const text = "오로라 환불 처리 규칙";
    assert.notEqual(text.normalize("NFC"), text.normalize("NFD"), "NFC와 NFD 원본은 서로 다른 문자열이어야 한다");
    assert.equal(normalizeFingerprintText(text.normalize("NFD")), normalizeFingerprintText(text.normalize("NFC")));
  });
});

describe("buildManualContentFingerprint (실제 함수 실행)", () => {
  test("같은 내용·같은 범위는 항상 같은 지문을 만든다", () => {
    assert.equal(buildManualContentFingerprint(HQ, AURORA), buildManualContentFingerprint(HQ, AURORA));
  });

  test("CRLF/LF 차이와 앞뒤 공백 차이는 같은 지문이다", () => {
    const messy: ManualGroupInput[] = [
      {
        category: "  주문·결제·고객 응대 ",
        topic: "오로라 환불 처리 규칙\r\n",
        items: ["1. 영수증을 확인한다.\r\n", "  2. 결제 수단으로 환불한다.  "],
      },
    ];
    assert.equal(buildManualContentFingerprint(HQ, messy), buildManualContentFingerprint(HQ, AURORA));
  });

  test("macOS 등에서 온 NFD 한글도 같은 지문을 만든다", () => {
    const nfd: ManualGroupInput[] = [
      {
        category: AURORA[0].category!.normalize("NFD"),
        topic: AURORA[0].topic.normalize("NFD"),
        items: (AURORA[0].items as string[]).map((item) => item.normalize("NFD")),
      },
    ];
    assert.equal(buildManualContentFingerprint(HQ, nfd), buildManualContentFingerprint(HQ, AURORA));
  });

  test("내용이 실제로 바뀐 개정판은 다른 지문이다", () => {
    const revised: ManualGroupInput[] = [
      { ...AURORA[0], items: ["1. 영수증을 확인한다.", "2. 7일 이내에만 환불한다."] },
    ];
    assert.notEqual(buildManualContentFingerprint(HQ, revised), buildManualContentFingerprint(HQ, AURORA));
  });

  test("제목이 같아도 내용이 다르면 다른 지문이다", () => {
    const sameTitle: ManualGroupInput[] = [{ ...AURORA[0], items: ["완전히 다른 내용"] }];
    assert.notEqual(buildManualContentFingerprint(HQ, sameTitle), buildManualContentFingerprint(HQ, AURORA));
  });

  test("HQ와 store는 같은 내용이어도 다른 지문이다", () => {
    assert.notEqual(buildManualContentFingerprint(STORE_1, AURORA), buildManualContentFingerprint(HQ, AURORA));
  });

  test("다른 store는 같은 내용이어도 다른 지문이다", () => {
    const store2: FingerprintScope = { ...STORE_1, storeId: "store-2" };
    assert.notEqual(buildManualContentFingerprint(store2, AURORA), buildManualContentFingerprint(STORE_1, AURORA));
  });

  test("다른 franchise는 같은 내용이어도 다른 지문이다", () => {
    const other: FingerprintScope = { ...HQ, franchiseId: "franchise-2" };
    assert.notEqual(buildManualContentFingerprint(other, AURORA), buildManualContentFingerprint(HQ, AURORA));
  });

  test("같은 store끼리는 franchise 값과 무관하게 같은 지문이다(store 범위는 store_id로 판정)", () => {
    const sameStoreOtherFranchise: FingerprintScope = { ...STORE_1, franchiseId: "franchise-9" };
    assert.equal(
      buildManualContentFingerprint(sameStoreOtherFranchise, AURORA),
      buildManualContentFingerprint(STORE_1, AURORA),
    );
  });

  test("항목 순서는 의미가 있으므로 재배열하면 다른 지문이다", () => {
    const reordered: ManualGroupInput[] = [{ ...AURORA[0], items: [...AURORA[0].items].reverse() }];
    assert.notEqual(buildManualContentFingerprint(HQ, reordered), buildManualContentFingerprint(HQ, AURORA));
  });

  test("정규화 결과는 객체가 아닌 배열이라 key 순서에 영향을 받지 않는다", () => {
    const normalized = normalizeManualGroupsForFingerprint(AURORA);
    assert.equal(Array.isArray(normalized[0]), true);
    assert.equal(JSON.stringify(normalized).includes("category"), false);
    assert.equal(JSON.stringify(normalized).includes("topic"), false);
  });

  test("지문은 64자리 16진수 SHA-256이며 본문을 그대로 담지 않는다", () => {
    const hash = buildManualContentFingerprint(HQ, AURORA);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash.includes("오로라"), false);
  });

  test("제외된 항목은 파싱 단계에서 빠져 지문에도 반영되지 않는다", () => {
    const withExcluded = parseConfirmedManualGroups([
      {
        title: "오로라 환불 처리 규칙",
        topCategoryLabel: "주문·결제·고객 응대",
        items: [{ content: "1. 영수증을 확인한다." }, { content: "2. 결제 수단으로 환불한다." }],
      },
      {
        title: "저장하지 않을 항목",
        topCategoryLabel: "주문·결제·고객 응대",
        items: [{ content: "무시되어야 한다" }],
        excluded: true,
      },
    ]);

    assert.ok(withExcluded);
    assert.equal(buildManualContentFingerprint(HQ, withExcluded), buildManualContentFingerprint(HQ, AURORA));
  });

  test("클라이언트 임시 ID(tempId)는 확정 페이로드에 없어 지문에 섞이지 않는다", () => {
    const parsed = parseConfirmedManualGroups([
      {
        tempId: "preview-manual-0",
        title: "오로라 환불 처리 규칙",
        topCategoryLabel: "주문·결제·고객 응대",
        scopeType: "store",
        items: [
          { tempId: "preview-item-0-0", content: "1. 영수증을 확인한다." },
          { tempId: "preview-item-0-1", content: "2. 결제 수단으로 환불한다." },
        ],
      },
    ]);

    assert.ok(parsed);
    assert.equal(buildManualContentFingerprint(HQ, parsed), buildManualContentFingerprint(HQ, AURORA));
  });
});
