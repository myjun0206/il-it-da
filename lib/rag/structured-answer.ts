import { sameLatteEntityTarget } from "@/lib/rag/latte-target";

/**
 * 생성 단계의 구조화 응답 파싱·검증.
 *
 * "모르겠습니다" 같은 문구를 정규식으로 찾지 않고, 모델이 answerable 필드로 직접 답한다.
 * 다만 모델이 answerable=true라고 해도 usedChunkIds가 실제로 건네준 청크에 속하는지
 * 서버에서 다시 대조한다(없는 근거를 지어내면 답변으로 쓰지 않는다).
 */

export class StructuredAnswerParseError extends Error {
  readonly fieldPath: string;
  readonly validationKind: string;
  constructor(fieldPath = "$", validationKind = "invalid_structure") {
    super("Structured answer could not be parsed.");
    this.name = "StructuredAnswerParseError";
    this.fieldPath = fieldPath;
    this.validationKind = validationKind;
  }
}

export const SUPPORT_KINDS = ["procedure", "permission", "timing", "method", "facts", "location", "conditions", "duration", "referral"] as const;
export const COVERAGE_VALUES = ["direct", "partial", "policy_only", "clarification"] as const;
export const SUPPORT_VALUES = ["direct", "policy_only", "missing"] as const;
export const EVIDENCE_ROLES = [...SUPPORT_KINDS, "referral_policy"] as const;
export const TARGET_RELATIONS = ["same", "covers_requested", "subset", "unrelated"] as const;
export type SupportKind = typeof SUPPORT_KINDS[number];
export type EvidenceRole = typeof EVIDENCE_ROLES[number];

export function normalizeTargetText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export function questionContainsTargetSequence(question: string, target: string): boolean {
  const stripParticle = (word: string) => normalizeTargetText(word).replace(/(?:되었을|됐을|되었던|됐던|되었다|됐다|되는|된|되면|될|되어|돼|되|에서는|이라면|이라서|이면|에는|에서|으로|이랑|랑|과|와|로|은|는|이|가|을|를|에|의|도)$/u, "");
  const normalizeWord = (word: string) => {
    const stripped = stripParticle(word);
    if (/^(?:아이스|ICE|ICED)$/iu.test(stripped)) return "ICE";
    if (/^(?:핫|HOT)$/iu.test(stripped)) return "HOT";
    return stripped;
  };
  const questionWords = normalizeTargetText(question).split(/[^\p{L}\p{N}]+/u).map(normalizeWord).filter(Boolean);
  const targetWords = normalizeTargetText(target).split(/[^\p{L}\p{N}]+/u).map(normalizeWord).filter(Boolean);
  if (!targetWords.length) return false;
  let next = 0;
  for (const word of questionWords) {
    if (word === targetWords[next]) next++;
    if (next === targetWords.length) return true;
  }
  return false;
}

export function sameDeclaredSourceTarget(requested: string, evidence: string, quote: string): boolean {
  const requestedText = normalizeTargetText(requested);
  const evidenceText = normalizeTargetText(evidence);
  if (requestedText === evidenceText) return true;
  if (sameLatteEntityTarget(requestedText, evidenceText)) return true;
  const targetItems = (value: string): string[] => value
    .split(/(?:이랑|랑|및|[,&·])|(?<=\S)(?:과|와)(?=\s)/u)
    .map(item => normalizeTargetText(item).replace(/(?:은|는|을|를)$/u, ""))
    .filter(Boolean);
  const requestedItems = targetItems(requestedText);
  const evidenceItems = targetItems(evidenceText);
  if (requestedItems.length > 1 && requestedItems.length === evidenceItems.length
    && requestedItems.every(item => evidenceItems.includes(item))) return true;
  const withoutParticle = (value: string) => value.replace(/(?:은|는|을|를)$/u, "");
  if (withoutParticle(requestedText).length >= 2 && withoutParticle(requestedText) === withoutParticle(evidenceText)
    && normalizeTargetText(quote).includes(withoutParticle(requestedText))) return true;
  return quote.split(/\r?\n/u).some(line => {
    const declaration = line.match(/^\s*동일 품목\s*:\s*([^=:\n]{1,200})\s*=\s*([^=:\n]{1,200})\s*$/u);
    if (!declaration) return false;
    const names = declaration.slice(1).map(normalizeTargetText);
    return names.includes(requestedText) && names.includes(evidenceText);
  });
}

export function sourceContainsDeclaredTarget(source: string, target: string): boolean {
  const anchored = normalizeTargetText(target).replace(/[.!?。？！]+$/u, "").trim();
  if (!anchored) return false;
  return normalizeTargetText(source).includes(anchored)
    || anchored.split(/[^\p{L}\p{N}]+/u).filter(Boolean).length > 1 && questionContainsTargetSequence(source, anchored);
}

export type StructuredAnswer = {
  answerable: boolean;
  answer: string;
  usedChunkIds: string[];
  coverage?: typeof COVERAGE_VALUES[number];
  supportAssessment?: {
    requestedTarget?: string;
    requirements: {
      kind: SupportKind;
      support: typeof SUPPORT_VALUES[number];
      evidence: { chunkId: string; quote: string; role?: EvidenceRole; target?: string;
        targetRelation?: typeof TARGET_RELATIONS[number] }[];
    }[];
  };
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

/** 파싱 실패는 근거 부족이 아니라 시스템 오류다. 호출부가 구분할 수 있도록 예외를 던진다. */
export function parseStructuredAnswer(raw: unknown, requireCoverage = false, requireSupportAssessment = false, requireEvidenceScope = false): StructuredAnswer {
  function fail(fieldPath: string, kind: string): never { throw new StructuredAnswerParseError(fieldPath, kind); }
  if (typeof raw !== "string" || !raw.trim()) {
    fail("$", "empty_response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("$", "invalid_json");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("$", "invalid_type");
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.answerable !== "boolean") {
    fail("answerable", "invalid_type");
  }

  const answer = typeof record.answer === "string" ? record.answer.trim() : "";

  if (record.answerable && !answer) {
    fail("answer", "missing_or_empty");
  }
  if (requireCoverage && record.answerable && record.coverage === undefined) {
    fail("coverage", "missing_field");
  }

  if (record.coverage !== undefined && !(COVERAGE_VALUES as readonly unknown[]).includes(record.coverage)) {
    fail("coverage", "invalid_enum");
  }
  let supportAssessment: StructuredAnswer["supportAssessment"];
  if (requireSupportAssessment && record.answerable && record.supportAssessment === undefined) fail("supportAssessment", "missing_field");
  if (record.supportAssessment !== undefined && !(record.answerable === false && record.supportAssessment === null)) {
    const assessment = record.supportAssessment as Record<string, unknown>;
    if (!assessment || typeof assessment !== "object" || !Array.isArray(assessment.requirements)) fail("supportAssessment.requirements", "invalid_type");
    if (assessment.requirements.length === 0 || assessment.requirements.length > 10) fail("supportAssessment.requirements", "invalid_length");
    if (requireEvidenceScope && (typeof assessment.requestedTarget !== "string" || !assessment.requestedTarget.trim() || assessment.requestedTarget.length > 200)) fail("supportAssessment.requestedTarget", "missing_or_invalid_target");
    supportAssessment = { ...(typeof assessment.requestedTarget === "string" ? { requestedTarget: assessment.requestedTarget.trim() } : {}),
      requirements: assessment.requirements.map((value: unknown, requirementIndex: number) => {
      const field = `supportAssessment.requirements[${requirementIndex}]`;
      const item = value as Record<string, unknown>;
      if (!item || typeof item !== "object") fail(field, "invalid_type");
      if (!(SUPPORT_KINDS as readonly unknown[]).includes(item.kind)) fail(`${field}.kind`, "invalid_enum");
      if (!(SUPPORT_VALUES as readonly unknown[]).includes(item.support)) fail(`${field}.support`, "invalid_enum");
      if (!Array.isArray(item.evidence)) fail(`${field}.evidence`, "invalid_type");
      if (item.evidence.length > 10 || item.support !== "missing" && item.evidence.length === 0
        || item.support === "missing" && item.evidence.length !== 0) fail(`${field}.evidence`, "support_evidence_mismatch");
      const evidence = item.evidence.map((entry: unknown, evidenceIndex: number) => {
        const entryField = `${field}.evidence[${evidenceIndex}]`;
        const quote = entry as Record<string, unknown>;
        if (!quote || typeof quote !== "object") fail(entryField, "invalid_type");
        if (typeof quote.chunkId !== "string" || !quote.chunkId.trim()) fail(`${entryField}.chunkId`, "missing_or_empty");
        if (typeof quote.quote !== "string" || !quote.quote.trim() || quote.quote.length > 1200) fail(`${entryField}.quote`, "missing_or_invalid_quote");
        const scoped = quote.role !== undefined || quote.target !== undefined || quote.targetRelation !== undefined;
        if (requireEvidenceScope || scoped) {
          if (!(EVIDENCE_ROLES as readonly unknown[]).includes(quote.role)) fail(`${entryField}.role`, "invalid_enum");
          if (typeof quote.target !== "string" || !quote.target.trim() || quote.target.length > 200) fail(`${entryField}.target`, "missing_or_invalid_target");
          if (!(TARGET_RELATIONS as readonly unknown[]).includes(quote.targetRelation)) fail(`${entryField}.targetRelation`, "invalid_enum");
        }
        return { chunkId: quote.chunkId.trim(), quote: quote.quote.trim(), ...(scoped ? { role: quote.role as EvidenceRole,
          target: (quote.target as string).trim(), targetRelation: quote.targetRelation as "same" | "covers_requested" | "subset" | "unrelated" } : {}) };
      });
      return { kind: item.kind as SupportKind,
        support: item.support as "direct" | "policy_only" | "missing", evidence };
    }) };
  }
  return { answerable: record.answerable, answer, usedChunkIds: toStringArray(record.usedChunkIds),
    ...(record.coverage !== undefined ? { coverage: record.coverage as StructuredAnswer["coverage"] } : {}),
    ...(supportAssessment ? { supportAssessment } : {}) };
}

/** 모델이 돌려준 근거 id 중 실제로 제공한 청크만 남긴다(순서는 제공 순서를 따른다). */
export function selectProvidedChunkIds(
  usedChunkIds: readonly string[],
  providedChunkIds: readonly string[],
): string[] {
  const used = new Set(usedChunkIds);
  return providedChunkIds.filter((chunkId) => used.has(chunkId));
}

export function recognizedStateConditions(text: string): string[] {
  const states: string[] = [];
  if (/유통기한(?:이)?\s*지난/u.test(text)) states.push("expired");
  if (/개봉(?:한|된)|개봉\s*후/u.test(text)) states.push("opened");
  if (/남은\s*(?:우유|재료|식재료|물품)/u.test(text)) states.push("remaining");
  return states;
}

export function hasExplicitConditionQuestion(question: string): boolean {
  return /조건|온도|습도|몇\s*도/u.test(question);
}

export function isLinkedStateUseProhibition(question: string, requestedTarget: string, evidenceTarget: string, quote: string, content: string): boolean {
  const statePattern = /유통기한(?:이)?\s*지난|개봉(?:한|된)|개봉\s*후|남은/gu;
  const states = recognizedStateConditions(question);
  const policyContext = content.split(/\r?\n/u).filter(line => {
    const text = line.trim();
    const uncertaintyReferral = /^[^.!?\n]+의\s+상태가\s+확실하지\s+않은\s+경우\s+[^.!?\n]+(?:확인|문의|보고)한다\.?$/u.test(text);
    return !uncertaintyReferral || /사용|허용|금지|예외|제외|유통기한|개봉|남은|다만|단[,\s]/u.test(text);
  }).join("\n");
  if (states.length !== 1 || /예외|제외|다만|단[,\s]|경우|때만|아니|않은|않는\s|또는|그리고|하지만|않다.*않|사용할\s*수|사용.*(?:가능|허용)|사용해도\s*(?:돼|되|된)/u.test(policyContext)) return false;
  const questionBody = normalizeTargetText(question.replace(statePattern, ""));
  const policyTarget = (value: string): string | null => {
    const text = normalizeTargetText(value);
    const qualifiers = recognizedStateConditions(text);
    if (!qualifiers.length) return text;
    if (qualifiers.length !== 1 || qualifiers[0] !== states[0]) return null;
    return text.replace(/^(?:유통기한(?:이)?\s*지난|개봉(?:한|된)|개봉\s*후|남은)\s+/u, "");
  };
  const target = policyTarget(requestedTarget);
  const sourceTarget = policyTarget(evidenceTarget);
  if (!target || !sourceTarget) return false;
  if (!questionBody.startsWith(target) || !/^(?:의|은|는|을|를)?\s*(?:써도|사용해도)\s*(?:돼|되나요|되나|됨|돼요)[?？.\s]*$/u.test(questionBody.slice(target.length))) return false;
  const lines = quote.trim().split(/\r?\n/u).map(line => line.trim());
  let linkedQuote = quote;
  if (lines.length === 2 && /^(?:#{1,6}\s+|\d+(?:-\d+)*[.)]\s+)/u.test(lines[0]) && /^[-*●]\s+사용\s*하지\s*않는다\.?$/u.test(lines[1])) {
    const heading = lines[0].replace(/^(?:#{1,6}\s+|\d+(?:-\d+)*[.)]\s+)/u, "");
    linkedQuote = `${heading}는 ${lines[1].replace(/^[-*●]\s+/u, "")}`;
  } else if (lines.length >= 3 && lines.every(line => line.startsWith("|") && line.endsWith("|"))) {
    const cells = lines.map(line => line.slice(1, -1).split("|").map(value => value.trim()));
    if (cells.every(row => row.length === 3) && cells[0].join("|") === "품목|상태|조치"
      && cells[1].every(cell => /^:?-{3,}:?$/u.test(cell))) {
      const matchingRows = cells.slice(2).filter(row => row[0] === sourceTarget
        && recognizedStateConditions(row[1]).length === 1 && recognizedStateConditions(row[1])[0] === states[0]
        && /^(?:유통기한(?:이)?\s*지난|개봉(?:한|된)|개봉\s*후|남은)$/u.test(row[1])
        && /^사용\s*하지\s*않는다\.?$/u.test(row[2]));
      if (matchingRows.length === 1) linkedQuote = `${matchingRows[0][1]} ${matchingRows[0][0]}는 ${matchingRows[0][2]}`;
    }
  }
  const policy = normalizeTargetText(linkedQuote).replace(/^[-*●]\s*/u, "");
  const clause = policy.match(/^(유통기한(?:이)?\s*지난|개봉(?:한|된)|개봉\s*후|남은)\s+([^.,!?\n]+?)(?:은|는|을|를)\s+사용\s*하지\s*않는다\.?$/u);
  if (!clause || recognizedStateConditions(clause[1])[0] !== states[0]) return false;
  const subject = normalizeTargetText(clause[2]);
  if ([`${target}를 포함한 식재료`, `${target}을 포함한 식재료`, `${target}를 포함한 재료`, `${target}을 포함한 재료`].includes(subject)
    && sourceTarget === target) return true;
  if (subject !== sourceTarget) return false;
  if (subject === target) return true;
  const foodTargets = ["우유", "요구르트", "요거트", "시럽", "식빵", "치즈", "크림", "버터", "계란", "달걀", "소스", "과일", "채소"];
  return ["식재료", "재료"].includes(subject) && foodTargets.includes(target);
}

export function explicitRequestedSupportKinds(question: string): SupportKind[] {
  const kinds: SupportKind[] = [];
  if (/(?:해도|써도)\s*(?:되|돼|됨)|(?:분해|사용|주문|발주).*?(?:가능|허용)|(?:금지|허용).*?(?:인가|인가요|되나요)/u.test(question)) kinds.push("permission");
  if (/누구|누가|문의\s*(?:대상|담당)|확인.*?(?:담당자|연락처)/u.test(question)) kinds.push("referral");
  if (/어디|위치|장소|곳/u.test(question)) kinds.push("location");
  if (hasExplicitConditionQuestion(question) || recognizedStateConditions(question).length) kinds.push("conditions");
  if (/기간|며칠|몇\s*(?:일|시간|개월)|얼마나(?:\s*오래)?\s*(?:보관|사용|두|먹|마시)/u.test(question)) kinds.push("duration");
  if (/순서|절차|(?:오픈|마감)(?:은|는|을|를)?\s*(?:어떻게|어케)\s*(?:하|해|함)/u.test(question)) kinds.push("procedure");
  else if (/어떻게|어케/u.test(question) || !kinds.includes("referral") && /방법|(?:보관|사용|세척|청소|관리|처리|조작|포장)법/u.test(question)) kinds.push("method");
  if (/언제|시점/u.test(question)) kinds.push("timing");
  return kinds;
}

export function hasExplicitSupportIntent(question: string): boolean {
  const kinds = explicitRequestedSupportKinds(question);
  return kinds.some(kind => kind !== "conditions") || hasExplicitConditionQuestion(question);
}

export function isClosingOrderDecisionQuestion(question: string): boolean {
  return /(?:마감|영업\s*종료).{0,24}(?:주문|접수)|(?:주문|접수).{0,24}(?:마감|영업\s*종료)/u.test(question)
    && /(?:(?:받아도|접수해도|수락해도)\s*(?:되나요|돼요|돼|되|됨|될까요)|받을\s*수\s*있나요|접수.*가능|수락.*가능)/u.test(question);
}

export function requestedSupportKinds(question: string): SupportKind[] {
  if (isClosingOrderDecisionQuestion(question)) return ["procedure"];
  const kinds = explicitRequestedSupportKinds(question);
  return hasExplicitSupportIntent(question) ? kinds : ["facts"];
}

export function needsExplicitTarget(question: string): boolean {
  return /^(?:이거|그거|저거|이것|그것|저것)(?:은|는|을|를|이|가)?\s*(?:(?:지금|그냥|바로)\s*)?(?:써도|사용해도|해도)\s*(?:되(?:나요|나|니)?|돼(?:요)?|됨)[?？.!\s]*$/u.test(normalizeTargetText(question));
}

export function buildGroundedAnswerResponseFormat(question: string, requirements?: readonly SupportKind[], verifiedRecipeItem?: string) {
  const kinds = requirements ? [...requirements] : requestedSupportKinds(question);
  const evidence = {
    type: "object",
    properties: {
      chunkId: { type: "string" }, quote: { type: "string" }, role: { type: "string", enum: [...EVIDENCE_ROLES] },
      target: { type: "string", ...(verifiedRecipeItem ? { enum: [verifiedRecipeItem] } : {}) },
      targetRelation: { type: "string", enum: [...TARGET_RELATIONS] },
    },
    required: ["chunkId", "quote", "role", "target", "targetRelation"], additionalProperties: false,
  };
  const assessment = {
    type: "object",
    properties: {
      requestedTarget: { type: "string", ...(verifiedRecipeItem ? { enum: [verifiedRecipeItem] } : {}) },
      requirements: {
        type: "array", minItems: kinds.length, maxItems: kinds.length,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: kinds }, support: { type: "string", enum: [...SUPPORT_VALUES] },
            evidence: { type: "array", maxItems: 10, items: evidence },
          },
          required: ["kind", "support", "evidence"], additionalProperties: false,
        },
      },
    },
    required: ["requestedTarget", "requirements"], additionalProperties: false,
  };
  return {
    type: "json_schema" as const,
    json_schema: {
      name: "rag_grounded_answer", strict: true,
      schema: {
        type: "object",
        properties: {
          answerable: { type: "boolean" }, answer: { type: "string" },
          usedChunkIds: { type: "array", items: { type: "string" } },
          coverage: { type: "string", enum: [...COVERAGE_VALUES] },
          supportAssessment: { anyOf: [assessment, { type: "null" }] },
        },
        required: ["answerable", "answer", "usedChunkIds", "coverage", "supportAssessment"], additionalProperties: false,
      },
    },
  };
}
