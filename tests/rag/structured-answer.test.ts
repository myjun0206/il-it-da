import assert from "node:assert/strict";
import { recordProviderUsage } from "../../lib/rag/provider-usage.ts";
import { describe, test } from "node:test";

import {
  StructuredAnswerParseError,
  parseStructuredAnswer,
  selectProvidedChunkIds,
  requestedSupportKinds,
  explicitRequestedSupportKinds,
  hasExplicitSupportIntent,
  normalizeTargetText,
  buildGroundedAnswerResponseFormat,
  COVERAGE_VALUES,
  SUPPORT_VALUES,
  EVIDENCE_ROLES,
  TARGET_RELATIONS,
  sameDeclaredSourceTarget,
  questionContainsTargetSequence,
  sourceContainsDeclaredTarget,
} from "../../lib/rag/structured-answer.ts";

describe("parseStructuredAnswer", () => {
  test("usage recording tolerates a broken logging sink and never invents missing token counts", () => {
    const original = console.info;
    console.info = () => { throw new Error("synthetic logging unavailable"); };
    try {
      const recorded = recordProviderUsage({ service: "generation", model: "gpt-4o", httpStatus: 200, inputTokens: 100, outputTokens: 10 });
      assert.equal(recorded.estimatedUsd, .00035);
      const unknown = recordProviderUsage({ service: "generation", model: "gpt-4o", httpStatus: 429, inputTokens: null, outputTokens: null });
      assert.equal(unknown.usageVerified, false);
      assert.equal(unknown.estimatedUsd, null);
    } finally { console.info = original; }
  });
  test("source targets tolerate terminal punctuation and known temperature spelling without allowing other entities", () => {
    assert.equal(sourceContainsDeclaredTarget("마감 전 확인 사항\n현재 주문 상태를 확인한다.", "마감 전 확인 사항."), true);
    assert.equal(sourceContainsDeclaredTarget("아이스 바닐라라떼\n우유 187ml", "ICE 바닐라라떼"), true);
    assert.equal(sourceContainsDeclaredTarget("ICE 바닐라라떼", "HOT 바닐라라떼"), false);
    assert.equal(sourceContainsDeclaredTarget("ICE 시연라떼", "ICE 바닐라라떼"), false);
    assert.equal(sourceContainsDeclaredTarget("수", "수은."), false);
  });
  test("temperature spelling aliases preserve exact menu and mode in requested targets", () => {
    assert.equal(questionContainsTargetSequence("아이스 바닐라라떼 레시피 알려줘", "ICE 바닐라라떼"), true);
    assert.equal(questionContainsTargetSequence("ICED 바닐라라떼 레시피", "아이스 바닐라라떼"), true);
    assert.equal(questionContainsTargetSequence("핫 바닐라라떼 레시피", "HOT 바닐라라떼"), true);
    assert.equal(questionContainsTargetSequence("아이스 바닐라라떼 레시피", "HOT 바닐라라떼"), false);
    assert.equal(questionContainsTargetSequence("아이스 바닐라라떼 레시피", "ICE 카페라떼"), false);
    assert.equal(questionContainsTargetSequence("아이스 시연라떼 레시피", "ICE 바닐라라떼"), false);
    assert.equal(questionContainsTargetSequence("아이스 바닐라라떼 레시피", "ICE 시연바닐라라떼"), false);
  });

  test("particle equivalence remains narrow and does not collapse a one-character substance target", () => {
    assert.equal(sameDeclaredSourceTarget("우유는", "우유", "우유를 냉장 보관한다."), true);
    assert.equal(sameDeclaredSourceTarget("수은", "수", "수은을 사용하지 않는다."), false);
    assert.equal(sameDeclaredSourceTarget("유제품은", "우유", "유제품과 우유"), false);
    assert.equal(sameDeclaredSourceTarget("커피콩", "원두", "커피콩과 원두"), false);
  });
  test("field phrasing keeps location, method and workflow requirements consistent", () => {
    for (const question of ["우유는 어디에 보관하나요?", "우유 어디 둬?", "우유 냉장고 어디 칸임?"]) {
      assert.deepEqual(requestedSupportKinds(question), ["location"]);
    }
    for (const question of ["유제품은 어떻게 보관해야 하나요?", "유제품 보관법"]) {
      assert.deepEqual(requestedSupportKinds(question), ["method"]);
    }
    for (const question of ["마감 절차 알려줘", "마감 어케 해?", "오픈 어케 해?"]) {
      assert.deepEqual(requestedSupportKinds(question), ["procedure"]);
    }
    assert.deepEqual(requestedSupportKinds("도구 어케 씻어?"), ["method"]);
    assert.deepEqual(requestedSupportKinds("이거 써도 됨?"), ["permission"]);
    assert.deepEqual(requestedSupportKinds("마감 때 물품 어케 보관해?"), ["method"]);
  });

  test("explicit follow-up intent is distinct from an elliptical target-only question", () => {
    assert.deepEqual(explicitRequestedSupportKinds("개봉한 우유는 얼마나 보관해?"), ["conditions", "duration"]);
    assert.deepEqual(explicitRequestedSupportKinds("개봉한 우유도 같은 곳에 둬?"), ["location", "conditions"]);
    assert.deepEqual(explicitRequestedSupportKinds("개봉한 우유는 어떻게 관리해?"), ["conditions", "method"]);
    assert.deepEqual(explicitRequestedSupportKinds("유통기한 지난 우유 써도 돼?"), ["permission", "conditions"]);
    assert.deepEqual(explicitRequestedSupportKinds("개봉한 우유의 유통기한은 언제까지야?"), ["conditions", "timing"]);
    assert.deepEqual(explicitRequestedSupportKinds("그럼 개봉한 건?"), ["conditions"]);
    assert.equal(hasExplicitSupportIntent("그럼 개봉한 건?"), false);
    assert.equal(hasExplicitSupportIntent("우유는 몇 도로 보관해?"), true);
    assert.deepEqual(requestedSupportKinds("그럼 개봉한 건?"), ["facts"]);
  });

  test("strict generation schema shares parser enums and closes every object with all fields required", () => {
    const format = buildGroundedAnswerResponseFormat("물품 위치와 보관법");
    const schema = format.json_schema.schema;
    assert.equal(format.type, "json_schema");
    assert.equal(format.json_schema.strict, true);
    assert.equal(schema.type, "object");
    assert.equal("anyOf" in schema, false);
    assert.deepEqual(schema.properties.coverage.enum, [...COVERAGE_VALUES]);
    const assessment = schema.properties.supportAssessment.anyOf[0];
    assert.ok("properties" in assessment);
    const requirement = assessment.properties.requirements;
    assert.deepEqual(requirement.items.properties.kind.enum, ["location", "method"]);
    assert.equal(requirement.minItems, 2);
    assert.equal(requirement.maxItems, 2);
    assert.deepEqual(requirement.items.properties.support.enum, [...SUPPORT_VALUES]);
    assert.deepEqual(requirement.items.properties.evidence.items.properties.role.enum, [...EVIDENCE_ROLES]);
    assert.deepEqual(requirement.items.properties.evidence.items.properties.targetRelation.enum, [...TARGET_RELATIONS]);
    function inspect(value: unknown) {
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if (node.type === "object") {
        assert.equal(node.additionalProperties, false);
        assert.deepEqual([...(node.required as string[])].sort(), Object.keys(node.properties as object).sort());
      }
      for (const child of Object.values(node)) inspect(child);
    }
    inspect(schema);
  });

  test("strict false nullable assessment is absence, but never bypasses true support validation", () => {
    const base = { answerable: false, answer: "", usedChunkIds: [], coverage: "policy_only", supportAssessment: null };
    const parsed = parseStructuredAnswer(JSON.stringify(base), true, true, true);
    assert.equal(parsed.answerable, false);
    assert.equal(parsed.supportAssessment, undefined);
    assert.throws(() => parseStructuredAnswer(JSON.stringify({ ...base, answerable: true, answer: "fixture" }), true, true, true), StructuredAnswerParseError);
    assert.throws(() => parseStructuredAnswer(JSON.stringify({ ...base, coverage: "invalid" }), true, true, true), StructuredAnswerParseError);
  });

  test("target spelling normalization is NFC and whitespace only, not semantic equivalence", () => {
    assert.equal(normalizeTargetText(" 원두\t\n A "), "원두 A");
    assert.equal(normalizeTargetText("우유".normalize("NFD")), "우유");
    assert.notEqual(normalizeTargetText("우유"), normalizeTargetText("유제품"));
    assert.notEqual(normalizeTargetText("원두"), normalizeTargetText("커피콩"));
    assert.notEqual(normalizeTargetText("AB"), normalizeTargetText("A B"));
  });

  test("parse failures expose only schema paths and categories, never raw JSON or field values", () => {
    const base = { answerable: true, answer: "private@example.test sk-test-only", coverage: "partial", usedChunkIds: ["c1"],
      supportAssessment: { requestedTarget: "물품", requirements: [{ kind: "location", support: "direct", evidence: [
        { chunkId: "c1", quote: "물품은 창고에 둔다.", role: "location", target: "물품", targetRelation: "same" },
      ] }] } };
    const scenarios: [unknown, string, string][] = [
      ["", "$", "empty_response"], ['{"answerable":true', "$", "invalid_json"],
      [{ ...base, coverage: undefined }, "coverage", "missing_field"],
      [{ ...base, coverage: "private@example.test" }, "coverage", "invalid_enum"],
      [{ ...base, supportAssessment: undefined }, "supportAssessment", "missing_field"],
      [{ ...base, supportAssessment: { ...base.supportAssessment, requestedTarget: undefined } }, "supportAssessment.requestedTarget", "missing_or_invalid_target"],
    ];
    for (const [value, fieldPath, validationKind] of scenarios) {
      assert.throws(() => parseStructuredAnswer(typeof value === "string" ? value : JSON.stringify(value), true, true, true),
        (error: unknown) => error instanceof StructuredAnswerParseError && error.fieldPath === fieldPath && error.validationKind === validationKind
          && !error.message.includes("private@example.test") && !error.message.includes("sk-test-only"));
    }
    for (const [field, value] of [["role", "bad-role"], ["targetRelation", "all"]] as const) {
      const entry = { ...base.supportAssessment.requirements[0].evidence[0], [field]: value };
      const response = { ...base, supportAssessment: { ...base.supportAssessment, requirements: [{ ...base.supportAssessment.requirements[0], evidence: [entry] }] } };
      assert.throws(() => parseStructuredAnswer(JSON.stringify(response), true, true, true), (error: unknown) => error instanceof StructuredAnswerParseError
        && error.fieldPath === `supportAssessment.requirements[0].evidence[0].${field}` && error.validationKind === "invalid_enum");
    }
    assert.equal(parseStructuredAnswer(JSON.stringify(base), true, true, true).coverage, "partial");
  });

  test("strict evidence scope accepts partial and requires bounded role/target/relationship metadata", () => {
    const evidence = { chunkId: "location", quote: "물품: 창고 선반", role: "location", target: "물품", targetRelation: "subset" };
    const raw = (entry: unknown, requestedTarget: unknown = "소모품") => JSON.stringify({ answerable: true, answer: "fixture", coverage: "partial", usedChunkIds: ["location"],
      supportAssessment: { requestedTarget, requirements: [{ kind: "method", support: "direct", evidence: [entry] }] } });
    assert.equal(parseStructuredAnswer(raw(evidence), true, true, true).coverage, "partial");
    for (const entry of [{ ...evidence, role: undefined }, { ...evidence, target: "" }, { ...evidence, targetRelation: "all" },
      { ...evidence, role: ["location"] }, { ...evidence, targetRelation: undefined }]) {
      assert.throws(() => parseStructuredAnswer(raw(entry), true, true, true), StructuredAnswerParseError);
    }
    assert.throws(() => parseStructuredAnswer(raw(evidence, null), true, true, true), StructuredAnswerParseError);
  });

  test("strict support schema requires bounded typed requirements and evidence, without inspecting answer wording", () => {
    const good = { requirements: [{ kind: "procedure", support: "policy_only", evidence: [{ chunkId: "c1", quote: "관리자에게 보고한다." }] }] };
    const raw = (supportAssessment: unknown) => JSON.stringify({ answerable: true, answer: "분해해도 된다는 문자열이어도 metadata를 검증한다", coverage: "direct", usedChunkIds: ["c1"], supportAssessment });
    assert.deepEqual(parseStructuredAnswer(raw(good), true, true).supportAssessment, good);
    for (const invalid of [undefined, null, {}, [], { requirements: [] },
      { requirements: [{ kind: "unknown", support: "direct", evidence: [] }] },
      { requirements: [{ kind: "method", support: "direct", evidence: [] }] },
      { requirements: [{ kind: "method", support: "missing", evidence: good.requirements[0].evidence }] },
      { requirements: [{ kind: "method", support: "policy_only", evidence: [{ chunkId: "c1", quote: " " }] }] }]) {
      assert.throws(() => parseStructuredAnswer(raw(invalid), true, true), StructuredAnswerParseError);
    }
    assert.doesNotThrow(() => parseStructuredAnswer(JSON.stringify({ answerable: false, answer: "", usedChunkIds: [] }), true, true));
  });

  test("question requirements distinguish performing procedures from permission and mixed timing/method", () => {
    assert.deepEqual(requestedSupportKinds("커피머신 내부 부품 세척 순서는 무엇인가요?"), ["procedure"]);
    assert.deepEqual(requestedSupportKinds("튀김기 부품을 분해해도 되나요?"), ["permission"]);
    assert.deepEqual(requestedSupportKinds("이 장비를 사용해도 돼요?"), ["permission"]);
    assert.deepEqual(requestedSupportKinds("손 위생은 언제, 어떻게 해야 하나요?"), ["method", "timing"]);
    assert.deepEqual(requestedSupportKinds("모르는 업무 확인 절차는?"), ["procedure"]);
    assert.deepEqual(requestedSupportKinds("물품은 어디에 보관하나요?"), ["location"]);
    assert.deepEqual(requestedSupportKinds("물품의 보관 조건과 기간은?"), ["conditions", "duration"]);
    assert.deepEqual(requestedSupportKinds("물품은 어떻게 보관하나요?"), ["method"]);
    assert.deepEqual(requestedSupportKinds("물품 보관법은 누구에게 확인하나요?"), ["referral"]);
  });

  test("compound requests retain permission, location and method without treating referral wording as an action request", () => {
    assert.deepEqual(requestedSupportKinds("장비를 분해해도 되나요? 가능하면 작업 순서도 알려주세요."), ["permission", "procedure"]);
    assert.deepEqual(requestedSupportKinds("물품은 어디에 어떻게 보관하나요?"), ["location", "method"]);
    assert.deepEqual(requestedSupportKinds("물품의 보관 방법과 위치는?"), ["location", "method"]);
    assert.deepEqual(requestedSupportKinds("장비를 사용해도 되나요? 언제 어떻게 사용하나요?"), ["permission", "method", "timing"]);
    assert.deepEqual(requestedSupportKinds("물품 보관 방법은 누구에게 확인하나요?"), ["referral"]);
  });

  test("short action-method nouns request method support, not general facts or legal information", () => {
    for (const question of ["유제품 보관법", "장비 사용법", "도구 세척법", "물품 포장법은?", "보관법"]) {
      assert.deepEqual(requestedSupportKinds(question), ["method"]);
    }
    assert.deepEqual(requestedSupportKinds("물품 위치와 보관법"), ["location", "method"]);
    assert.deepEqual(requestedSupportKinds("물품 보관법은 누구에게 확인하나요?"), ["referral"]);
    assert.deepEqual(requestedSupportKinds("근로기준법이란?"), ["facts"]);
  });

  test("coverage is explicit typed metadata and strict mode does not infer it from answer text", () => {
    for (const coverage of ["direct", "policy_only", "clarification"] as const) {
      assert.equal(parseStructuredAnswer(JSON.stringify({ answerable: true, answer: "관리자에게 확인합니다.", usedChunkIds: ["c1"], coverage }), true).coverage, coverage);
    }
    for (const coverage of [["direct"], {}, null, 1, "unknown"]) {
      assert.throws(() => parseStructuredAnswer(JSON.stringify({ answerable: true, answer: "답변", usedChunkIds: ["c1"], coverage }), true), StructuredAnswerParseError);
    }
    assert.throws(() => parseStructuredAnswer('{"answerable":true,"answer":"관리자에게 확인합니다.","usedChunkIds":["c1"]}', true), StructuredAnswerParseError);
  });

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
