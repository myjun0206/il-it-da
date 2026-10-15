import type { ManualChunkMatch } from "@/lib/rag/types";
import { extractLatteTargets, sameLatteTarget } from "@/lib/rag/latte-target";

export type RecipeEvidenceSupport = {
  version: 1;
  outcome: "full" | "partial" | "insufficient" | "conflict" | "unknown";
  verified: { ingredient: string; quantity: string; unit: string; basis?: string }[];
  missing: string[];
  reason: string;
};

type Fact = { ingredient: string; quantity: string; unit: string; basis?: string; shotCount?: string };
type SourceFact = Fact & { originalText: string; start: number; end: number };
export type VerifiedRecipeSourceFact = {
  menu: string; temperature: string; serving: string; ingredient: string; quantity: string; unit: string;
  lower: number; upper: number; approximate: boolean; basis?: string; originalText: string;
  source: { manualId: string; chunkId: string; title: string; category: string; scope: string; sectionStart: number;
    factStart: number; factEnd: number; citationQuote: string };
};
type ExtractedFact = Fact & { numericFragment?: string };
export type RecipeFactDiagnostic = {
  version: 1;
  menu: string;
  temperature: string;
  ingredient: string;
  requested: boolean;
  expected: { quantity: string; unit: string; approximate: boolean; lower: number; upper: number; basis?: string };
  extracted: { quantity: string; unit: string; approximate: boolean; lower: number; upper: number; basis?: string } | null;
  rule: "MATCH" | "MISSING" | "VALUE_OR_RANGE_MISMATCH" | "UNIT_MISMATCH" | "BASIS_MISMATCH" | "APPROXIMATION_MISMATCH";
  numericFragment: string | null;
};
type Section = { menu: string; temperature: string; serving: string; facts: SourceFact[]; text: string; scope: string; scopeExplicit: boolean; chunkId: string;
  manualId: string; title: string; category: string; sectionStart: number };

export function recipeSupportStorageEnabled(): boolean {
  return typeof process !== "undefined" && process.env.RAG_RECIPE_SUPPORT_STORAGE === "1";
}

export function parseRecipeEvidenceSupport(value: unknown): RecipeEvidenceSupport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || !["full", "partial", "insufficient", "conflict", "unknown"].includes(row.outcome as string)
    || typeof row.reason !== "string" || !/^RECIPE_[A-Z_]{1,80}$/u.test(row.reason)
    || !Array.isArray(row.verified) || row.verified.length > 16 || !Array.isArray(row.missing) || row.missing.length > 16) return null;
  const verified: Fact[] = [];
  for (const value of row.verified) {
    if (!value || typeof value !== "object") return null;
    const fact = value as Record<string, unknown>;
    if (typeof fact.ingredient !== "string" || !fact.ingredient.trim() || fact.ingredient.length > 80
      || typeof fact.quantity !== "string" || !/^(?:약 )?\d+(?:\.\d+)?(?:[~～-]\d+(?:\.\d+)?)?$/u.test(fact.quantity)
      || !["ml", "g", "℃", "%"].includes(fact.unit as string)) return null;
    if (fact.basis !== undefined && (fact.unit !== "%" || typeof fact.basis !== "string" || !fact.basis.trim() || fact.basis.length > 80)) return null;
    verified.push({ ingredient: fact.ingredient, quantity: fact.quantity, unit: fact.unit as string,
      ...(typeof fact.basis === "string" ? { basis: fact.basis } : {}) });
  }
  if (!row.missing.every(value => typeof value === "string" && value.trim().length > 0 && value.length <= 80)) return null;
  if (row.outcome === "full" && (row.reason !== "RECIPE_BOUNDED_FACTS_VERIFIED" || !verified.length || row.missing.length)) return null;
  if (row.outcome === "partial" && (!verified.length || !row.missing.length)) return null;
  return { version: 1, outcome: row.outcome as RecipeEvidenceSupport["outcome"], verified, missing: [...row.missing], reason: row.reason };
}
const normalize = (text: string) => text.normalize("NFC").replace(/\s+/gu, " ").trim();
const compact = (text: string) => normalize(text).replace(/\s/gu, "");
const temperature = (text: string) => [...new Set([
  /\bHOT\b|핫|따뜻한|뜨거운/iu.test(text) ? "HOT" : "",
  /\bICE(?:D)?\b|아이스|차가운/iu.test(text) ? "ICE" : "",
].filter(Boolean))];
const amountPattern = /^(.*?)\s+(약\s+)?(\d+(?:\.\d+)?(?:\s*[~～-]\s*\d+(?:\.\d+)?)?)\s*(ml|g|℃|%)$/iu;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

function ratioBasis(text: string, fact: Fact): string | undefined {
  const amount = `${fact.quantity.startsWith("약 ") ? "약\\s*" : ""}${escaped(fact.quantity.replace(/^약 /u, ""))}\\s*%`;
  const subject = `${escaped(fact.ingredient)}(?:을|를|은|는)?`;
  const before = [...normalize(text).matchAll(new RegExp(`([가-힣A-Za-z]+)(?:에|의)\\s*${subject}\\s*${amount}`, "gu"))];
  const after = [...normalize(text).matchAll(new RegExp(`${subject}\\s*([가-힣A-Za-z]+)의\\s*${amount}`, "gu"))];
  const bases = [...new Set([...before, ...after].map(match => match[1]))];
  return bases.length === 1 ? bases[0] : undefined;
}

function explicitShotVolume(part: string, text: string, sectionStart: number): SourceFact | null {
  const declared = normalize(part).match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*샷(?:\s*\(\s*(?:약\s*)?\d+(?:\.\d+)?\s*ml\s*\))?$/iu);
  if (!declared) return null;
  const pattern = new RegExp(`${escaped(declared[1])}\\s+${escaped(declared[2])}\\s*샷\\s*\\(\\s*(약\\s*)?(\\d+(?:\\.\\d+)?)\\s*ml\\s*\\)`, "giu");
  const values = [...text.matchAll(pattern)].filter(found => {
    const lineStart = text.lastIndexOf("\n", found.index) + 1;
    const lineEnd = text.indexOf("\n", found.index);
    return !/추가|대신|변경|경우|옵션/u.test(text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd));
  });
  if (!values.length || new Set(values.map(found => `${found[1] ? "약 " : ""}${found[2]}`)).size !== 1) return null;
  const found = values[0];
  const start = sectionStart + found.index!;
  return { ingredient: declared[1], quantity: `${found[1] ? "약 " : ""}${found[2]}`, unit: "ml", shotCount: declared[2],
    originalText: found[0], start, end: start + found[0].length };
}

function sections(match: ManualChunkMatch): Section[] {
  const headings = [...match.content.matchAll(/^\s*(?:●\s*)?(HOT|ICE)\s+([^\r\n:]+)\s*$/gmu)];
  return headings.flatMap((heading, index) => {
    const text = match.content.slice(heading.index, headings[index + 1]?.index ?? match.content.length);
    const criteria = text.split(/\r?\n/u).find(line => /^기본 기준\s*:/u.test(line.trim()));
    if (!criteria) return [];
    const parts = criteria.replace(/^\s*기본 기준\s*:\s*/u, "").split("/").map(part => part.trim());
    const serving = parts.find(part => /^\d+oz$/iu.test(part)) ?? "";
    const facts = parts.flatMap(part => {
      const found = normalize(part).match(amountPattern);
      if (!found) {
        const explicit = explicitShotVolume(part, text, heading.index!);
        return explicit ? [explicit] : [];
      }
      const start = heading.index! + text.indexOf(criteria) + criteria.indexOf(part);
      const fact: SourceFact = { ingredient: found[1], quantity: `${found[2] ? "약 " : ""}${found[3].replace(/\s/gu, "")}`, unit: found[4].toLowerCase(),
        originalText: part, start, end: start + part.length };
      if (fact.unit === "%") {
        const inline = fact.ingredient.match(/^(.*?)\s+([가-힣A-Za-z]+)의$/u);
        if (inline) { fact.ingredient = inline[1]; fact.basis = ratioBasis(text, fact); }
        else fact.basis = ratioBasis(text, fact);
      }
      return [fact];
    });
    return facts.length ? [{ menu: heading[2].trim(), temperature: heading[1], serving, facts, text,
      scope: `${match.diagnostic_scope ?? "unknown"}:${match.diagnostic_scope_id ?? match.manual_id}`,
      scopeExplicit: Boolean(match.diagnostic_scope_id), chunkId: match.chunk_id,
      manualId: match.manual_id, title: match.title, category: match.category, sectionStart: heading.index! }] : [];
  });
}

function requestedFact(question: string, ingredient: string): boolean {
  if (ingredient === "우유" && /(?:스팀|데우)/u.test(question) && /(?:몇\s*도|온도)/u.test(question)
    && !/(?:몇\s*(?:ml|g)|얼마|정량|수량|양|량)/u.test(question)) return false;
  const target = compact(question);
  const genericName = ingredient.split(" ").at(-1) ?? ingredient;
  return target.includes(compact(ingredient)) || genericName.length >= 2 && target.includes(genericName)
    || ingredient === "스팀 온도" && /스팀|몇\s*도|온도/u.test(question);
}

function answerFact(answer: string, ingredient: string): ExtractedFact | null {
  const normalized = normalize(answer);
  const shotVolume = normalized.match(new RegExp(`${escaped(ingredient)}(?:은|는|을|를)?\\s+(\\d+(?:\\.\\d+)?)\\s*샷\\s*\\(\\s*(약\\s*)?(\\d+(?:\\.\\d+)?)\\s*ml\\s*\\)`, "iu"));
  if (shotVolume) return { ingredient, shotCount: shotVolume[1], quantity: `${shotVolume[2] ? "약 " : ""}${shotVolume[3]}`, unit: "ml", numericFragment: shotVolume[0] };
  if (/온도$/u.test(ingredient)) {
    const prefix = `${escaped(ingredient)}(?:은|는|을|를|의|가|이)?\\s*`;
    const numeric = "\\d+(?:\\.\\d+)?";
    const rangePattern = `(약\\s*)?(?:섭씨\\s*)?(${numeric})\\s*(?:℃|°C|도)?\\s*(?:[~～–-]|에서)\\s*(${numeric})\\s*(?:℃|°C|도)`;
    const range = normalized.match(new RegExp(`${prefix}${rangePattern}`, "iu"))
      ?? (/스팀/u.test(normalized) ? normalized.match(new RegExp(rangePattern, "iu")) : null);
    if (range) return { ingredient, quantity: `${range[1] ? "약 " : ""}${range[2]}~${range[3]}`, unit: "℃",
      numericFragment: range[0].slice(range[0].indexOf(range[1] || range[2])).trim() };
  }
  const found = normalized.match(new RegExp(`(?:^|[^가-힣A-Za-z])${escaped(ingredient)}(?:량은|량|은|는|을|를|의|가|이)?\\s*(?:(?:정량|수량|양)(?:은|는|이|가)?\\s*)?(?:([가-힣A-Za-z]+)의\\s*)?(약\\s*)?(\\d+(?:\\.\\d+)?(?:\\s*[~～-]\\s*\\d+(?:\\.\\d+)?)?)\\s*(ml|g|℃|%)`, "iu"))
    ?? normalized.match(new RegExp(`(?:^|[,;:]\\s*|(?:에는|에|넣는|사용하는|필요한|와|과)\\s+)(?:([가-힣A-Za-z]+)의\\s*)?(약\\s*)?(\\d+(?:\\.\\d+)?(?:\\s*[~～-]\\s*\\d+(?:\\.\\d+)?)?)\\s*(ml|g|℃|%)(?:\\s*정도)?(?:의)?\\s*${escaped(ingredient)}(?=(?:은|는|을|를|이|가)(?:\\s|[,.]|$)|예요|에요|입니다|[\\s,.]|$)`, "iu"));
  return found ? { ingredient, quantity: `${found[2] ? "약 " : ""}${found[3].replace(/\s/gu, "")}`, unit: found[4].toLowerCase(),
    ...(found[1] ? { basis: found[1] } : {}), numericFragment: `${found[2] ?? ""}${found[3]}${found[4]}` } : null;
}

function diagnosticValue(fact: Fact) {
  const approximate = fact.quantity.startsWith("약 ");
  const values = fact.quantity.replace(/^약 /u, "").split(/[~～-]/u).map(Number);
  return { quantity: fact.quantity, unit: fact.unit, approximate, lower: values[0], upper: values[1] ?? values[0],
    ...(fact.basis ? { basis: fact.basis } : {}) };
}

function citationIdentifiesSection(section: Section, citation: { chunkId: string; quote: string }, parsed: readonly Section[]): boolean {
  if (citation.chunkId !== section.chunkId || !normalize(section.text).includes(normalize(citation.quote))) return false;
  if (/스팀/u.test(citation.quote) && /\d+(?:\.\d+)?\s*(?:[~～–-]|에서)\s*\d+(?:\.\d+)?\s*(?:℃|°C|도)/iu.test(citation.quote)) {
    const matchingSections = parsed.filter(candidate => candidate.chunkId === citation.chunkId
      && normalize(candidate.text).includes(normalize(citation.quote)));
    if (matchingSections.length === 1) return matchingSections[0] === section;
  }
  if (compact(citation.quote).includes(compact(`${section.temperature} ${section.menu}`))) return true;
  const criteria = section.text.split(/\r?\n/u).find(line => /^기본 기준\s*:/u.test(line.trim()));
  const quoted = normalize(citation.quote);
  return Boolean(criteria && normalize(criteria) === quoted
    && parsed.filter(candidate => candidate.chunkId === section.chunkId
      && candidate.text.split(/\r?\n/u).some(line => /^기본 기준\s*:/u.test(line.trim()) && normalize(line) === quoted)).length === 1);
}

export function verifyRecipeFacts(question: string, answer: string, candidates: readonly ManualChunkMatch[],
  citations: readonly { chunkId: string; quote: string }[], onDiagnostic?: (diagnostic: RecipeFactDiagnostic) => void,
  options?: { sourceOnly?: boolean; renderingQualifierGate?: boolean }): { contradiction: boolean; support: RecipeEvidenceSupport; sourceFacts?: VerifiedRecipeSourceFact[] } | null {
  if (!/몇|얼마|정량|기준|양|량/u.test(question)) return null;
  const parsed = candidates.flatMap(sections);
  const requestedLatteTargets = extractLatteTargets(question);
  const menus = [...new Set(parsed.map(section => section.menu))].filter(menu => requestedLatteTargets.length
    ? requestedLatteTargets.some(target => sameLatteTarget(target.name, menu))
    : compact(question).includes(compact(menu)));
  if (!menus.length) return null;
  const unknown = (reason: string) => ({ contradiction: false, support: { version: 1 as const, outcome: "unknown" as const, verified: [], missing: [], reason } });
  const modes = temperature(question);
  if (menus.length !== 1 || modes.length !== 1) return unknown("RECIPE_REQUEST_STRUCTURE_UNVERIFIED");
  const relevant = parsed.filter(section => section.menu === menus[0] && section.temperature === modes[0]);
  const cited = relevant.filter(section => citations.some(citation => citationIdentifiesSection(section, citation, parsed)));
  if (!cited.length) {
    const wrongSection = parsed.some(section => section.menu === menus[0] && section.temperature !== modes[0]
      && citations.some(citation => citation.chunkId === section.chunkId && normalize(section.text).includes(normalize(citation.quote))));
    return wrongSection ? { contradiction: true, support: { version: 1, outcome: "unknown", verified: [], missing: [], reason: "RECIPE_CITATION_TEMPERATURE_MISMATCH" } }
      : unknown("RECIPE_CITATION_SECTION_UNVERIFIED");
  }
  const reference = cited[0];
  if (!reference.serving || cited.some(section => section.serving !== reference.serving || section.scope !== reference.scope)) return unknown("RECIPE_SERVING_OR_SCOPE_UNVERIFIED");
  const requestedServings = [...question.matchAll(/\b\d+oz\b/giu)].map(match => match[0].toLowerCase());
  if (requestedServings.some(serving => serving !== reference.serving.toLowerCase())) return unknown("RECIPE_SERVING_OR_SCOPE_UNVERIFIED");
  if (relevant.some(section => section.scope.startsWith("unknown:") && section.scope !== reference.scope)) return unknown("RECIPE_SCOPE_COMPARISON_UNVERIFIED");
  if (relevant.some(section => section.scope !== reference.scope && (!section.scopeExplicit || !reference.scopeExplicit))) return unknown("RECIPE_SCOPE_COMPARISON_UNVERIFIED");
  const compared = relevant.filter(section => section.scope === reference.scope && section.serving === reference.serving);
  const facts = new Map<string, Fact>();
  for (const section of compared) for (const fact of section.facts) {
    const previous = facts.get(fact.ingredient);
    if (previous && (previous.quantity !== fact.quantity || previous.unit !== fact.unit || previous.basis !== fact.basis)) {
      return { contradiction: false, support: { version: 1, outcome: "conflict", verified: [], missing: [], reason: "RECIPE_SOURCE_CONFLICT" } };
    }
    facts.set(fact.ingredient, fact);
  }
  const request = question.replaceAll(menus[0], " ").replace(/\b(?:HOT|ICE(?:D)?)\b/giu, " ");
  const expected = reference.facts.filter(fact => requestedFact(request, fact.ingredient));
  if (!expected.length) return unknown("RECIPE_REQUEST_INGREDIENTS_UNVERIFIED");
  const expectedQuantityByFact = new Map<Fact, string>();
  if (!options?.sourceOnly) for (const fact of expected) {
    if (fact.ingredient !== "스팀 온도" || fact.unit !== "℃") continue;
    const sourceRange = fact.quantity.replace(/^약 /u, "").split(/[~～-]/u).map(Number);
    for (const citation of citations) {
      if (!citationIdentifiesSection(reference, citation, parsed) || !/스팀/u.test(citation.quote)) continue;
      const cited = answerFact(citation.quote, fact.ingredient);
      const citedRange = cited?.quantity.replace(/^약 /u, "").split(/[~～-]/u).map(Number);
      if (cited?.unit === fact.unit && citedRange?.length === sourceRange.length
        && citedRange.every((value, index) => value === sourceRange[index])) {
        expectedQuantityByFact.set(fact, cited.quantity);
        break;
      }
    }
  }
  if (expected.some(fact => !compact(request).includes(compact(fact.ingredient))
    && reference.facts.filter(other => other.ingredient.split(" ").at(-1) === fact.ingredient.split(" ").at(-1)).length > 1)) return unknown("RECIPE_REQUEST_INGREDIENTS_UNVERIFIED");
  if (expected.some(fact => fact.unit === "%" && !fact.basis)) return unknown("RECIPE_RATIO_BASIS_UNVERIFIED");
  if (expected.some(fact => !citations.some(citation => {
    const quoted = answerFact(citation.quote, fact.ingredient);
    return citationIdentifiesSection(reference, citation, parsed) && quoted?.quantity === (expectedQuantityByFact.get(fact) ?? fact.quantity) && quoted.unit === fact.unit
      && (!quoted.basis || quoted.basis === fact.basis);
  }))) return unknown("RECIPE_CITED_FACT_UNVERIFIED");
  const knownIngredients = ["우유", "바닐라 시럽", "초콜릿 소스", "딸기 베이스", "뜨거운 물", "차가운 물", "얼음", "스팀 온도", "에스프레소"];
  const sourceMissing: string[] = [];
  for (const ingredient of knownIngredients) if (compact(request).includes(compact(ingredient)) && !reference.facts.some(fact => compact(fact.ingredient).includes(compact(ingredient)))) sourceMissing.push(ingredient);
  const namedRequests = [...request.matchAll(/([가-힣]{2,})(?:과|와|량|양)(?=\s|은|는|을|를|[?])/gu)].map(match => match[1].replace(/(?:량|양)$/u, ""));
  for (const ingredient of namedRequests) if (!reference.facts.some(fact => compact(fact.ingredient).includes(compact(ingredient)))
    && !compact(menus[0]).includes(compact(ingredient))) sourceMissing.push(ingredient);
  const compoundUnverified = /그리고|또한|및|와\s+.*(?:만드는|절차|방법)|순서|보관|기간|변경|추가/u.test(question);
  if (options?.sourceOnly) {
    if (sourceMissing.length) return unknown("RECIPE_REQUIRED_SOURCE_FACT_MISSING");
    if (compoundUnverified) return unknown("RECIPE_COMPOUND_OR_OPTION_UNVERIFIED");
    const sourceFacts = expected.map(fact => ({ menu: reference.menu, temperature: reference.temperature, serving: reference.serving,
      ingredient: fact.ingredient, ...diagnosticValue(fact), originalText: fact.originalText,
      source: { manualId: reference.manualId, chunkId: reference.chunkId, title: reference.title, category: reference.category, scope: reference.scope,
        sectionStart: reference.sectionStart, factStart: fact.start, factEnd: fact.end,
        citationQuote: citations.find(citation => citationIdentifiesSection(reference, citation, parsed)
          && answerFact(citation.quote, fact.ingredient)?.quantity === fact.quantity)!.quote } }));
    return { contradiction: false, support: { version: 1, outcome: "full", verified: expected.map(fact => ({ ingredient: fact.ingredient, quantity: fact.quantity, unit: fact.unit,
      ...(fact.basis ? { basis: fact.basis } : {}) })), missing: [], reason: "RECIPE_BOUNDED_FACTS_VERIFIED" }, sourceFacts };
  }
  const answerModes = temperature(answer);
  if (answerModes.some(mode => mode !== modes[0])) return { contradiction: true, support: { version: 1, outcome: "unknown", verified: [], missing: [], reason: "RECIPE_ANSWER_TEMPERATURE_MISMATCH" } };
  const answerServings = [...answer.matchAll(/\b\d+oz\b/giu)].map(match => match[0].toLowerCase());
  if (answerServings.some(serving => serving !== reference.serving.toLowerCase())) return { contradiction: true,
    support: { version: 1, outcome: "unknown", verified: [], missing: [], reason: "RECIPE_ANSWER_SERVING_MISMATCH" } };
  const answerLatteTargets = extractLatteTargets(answer);
  const declaredMenus = [...new Set(parsed.map(section => section.menu))].filter(menu => answerLatteTargets.length
    ? answerLatteTargets.some(target => sameLatteTarget(target.name, menu))
    : compact(answer).includes(compact(menu)));
  if (declaredMenus.some(menu => menu !== menus[0])) return { contradiction: true, support: { version: 1, outcome: "unknown", verified: [], missing: [], reason: "RECIPE_ANSWER_MENU_MISMATCH" } };
  const verified: Fact[] = [];
  const missing: string[] = [];
  for (const fact of reference.facts) {
    const expectedQuantity = expectedQuantityByFact.get(fact) ?? fact.quantity;
    const extracted = answerFact(answer, fact.ingredient);
    const supplied = extracted && (expected.includes(fact) || extracted.unit === fact.unit) ? extracted : null;
    if (supplied?.shotCount && fact.shotCount !== supplied.shotCount) return { contradiction: true,
      support: { version: 1, outcome: "unknown", verified: [], missing: [], reason: "RECIPE_ANSWER_AMOUNT_OR_UNIT_MISMATCH" } };
    if (expected.includes(fact) || supplied) {
      const expectedValue = diagnosticValue({ ...fact, quantity: expectedQuantity });
      const extractedValue = supplied ? diagnosticValue(supplied) : null;
      const rule: RecipeFactDiagnostic["rule"] = !extractedValue ? "MISSING" : extractedValue.unit !== expectedValue.unit ? "UNIT_MISMATCH"
        : extractedValue.basis && extractedValue.basis !== expectedValue.basis ? "BASIS_MISMATCH"
        : extractedValue.lower !== expectedValue.lower || extractedValue.upper !== expectedValue.upper ? "VALUE_OR_RANGE_MISMATCH"
        : extractedValue.approximate !== expectedValue.approximate ? "APPROXIMATION_MISMATCH"
        : extractedValue.quantity !== expectedValue.quantity ? "VALUE_OR_RANGE_MISMATCH" : "MATCH";
      try { onDiagnostic?.({ version: 1, menu: reference.menu, temperature: reference.temperature, ingredient: fact.ingredient,
        requested: expected.includes(fact), expected: expectedValue, extracted: extractedValue, rule, numericFragment: supplied?.numericFragment ?? null }); } catch {}
    }
    const approximationOnly = options?.renderingQualifierGate && supplied && supplied.quantity.replace(/^약 /u, "") === expectedQuantity.replace(/^약 /u, "")
      && supplied.unit === fact.unit && (!supplied.basis || supplied.basis === fact.basis);
    if (supplied && (!approximationOnly && supplied.quantity !== expectedQuantity || supplied.unit !== fact.unit || supplied.basis && supplied.basis !== fact.basis)) return { contradiction: true,
      support: { version: 1, outcome: "unknown", verified: [], missing: [], reason: "RECIPE_ANSWER_AMOUNT_OR_UNIT_MISMATCH" } };
    if (expected.includes(fact)) {
      if (supplied) verified.push({ ingredient: fact.ingredient, quantity: expectedQuantity, unit: fact.unit, ...(fact.basis ? { basis: fact.basis } : {}) });
      else missing.push(fact.ingredient);
    }
  }
  missing.push(...sourceMissing);
  const answerIdentityVerified = answerLatteTargets.length
    ? answerLatteTargets.some(target => sameLatteTarget(target.name, menus[0]))
    : compact(answer).includes(compact(menus[0]));
  if (!answerIdentityVerified || answerModes.length !== 1) return unknown("RECIPE_ANSWER_IDENTITY_UNVERIFIED");
  if (/대신|말고|아니|아닙|아닌|아님|않|금지|제외|넣지|필요\s*없|불필요|안\s*(?:넣|쓰|사용|돼|됩|됨)|안\s/u.test(answer)) return unknown("RECIPE_ANSWER_SEMANTICS_UNVERIFIED");
  if (!missing.length && compoundUnverified) return unknown("RECIPE_COMPOUND_OR_OPTION_UNVERIFIED");
  const shotCheckedAnswer = reference.facts.reduce((text, fact) => {
    const supplied = answerFact(answer, fact.ingredient);
    return fact.shotCount && supplied?.shotCount === fact.shotCount && supplied.numericFragment
      ? text.replace(supplied.numericFragment, `${fact.ingredient} ${supplied.quantity}${supplied.unit}`) : text;
  }, normalize(answer));
  const temperatureCheckedAnswer = reference.facts.filter(fact => /온도$/u.test(fact.ingredient) && answerFact(answer, fact.ingredient))
    .reduce((text, fact) => {
      const supplied = answerFact(answer, fact.ingredient);
      return supplied?.numericFragment ? text.replace(supplied.numericFragment, "") : text;
    }, shotCheckedAnswer).replace(/\b\d+oz\b/giu, "");
  if (!missing.length && /\d+(?:\.\d+)?\s*(?:L\b|리터|샷|oz\b|개|잔|도\b)/iu.test(temperatureCheckedAnswer)) return unknown("RECIPE_EXTRA_AMOUNT_UNVERIFIED");
  const supportedAmounts = reference.facts.filter(fact => {
    const extracted = answerFact(answer, fact.ingredient);
    return Boolean(extracted && (expected.includes(fact) || extracted.unit === fact.unit));
  }).length;
  const allAmounts = [...answer.matchAll(/\d+(?:\.\d+)?(?:\s*[~～-]\s*\d+(?:\.\d+)?)?\s*(?:ml|g|℃|%)/giu)].length;
  if (allAmounts > supportedAmounts) return unknown("RECIPE_EXTRA_AMOUNT_UNVERIFIED");
  return { contradiction: false, support: { version: 1, outcome: missing.length ? verified.length ? "partial" : "insufficient" : "full",
    verified, missing: [...new Set(missing)], reason: missing.length ? "RECIPE_REQUIRED_FACT_MISSING" : "RECIPE_BOUNDED_FACTS_VERIFIED" } };
}

export function extractVerifiedRecipeSourceFacts(question: string, candidates: readonly ManualChunkMatch[], citations: readonly { chunkId: string; quote: string }[]) {
  return verifyRecipeFacts(question, "", candidates, citations, undefined, { sourceOnly: true });
}

export function verifyRecipeModelForSourceRendering(question: string, answer: string, candidates: readonly ManualChunkMatch[], citations: readonly { chunkId: string; quote: string }[]) {
  return verifyRecipeFacts(question, answer, candidates, citations, undefined, { renderingQualifierGate: true });
}

export function renderVerifiedRecipeSourceFacts(facts: readonly VerifiedRecipeSourceFact[]): string {
  if (!facts.length) throw new Error("NO_VERIFIED_RECIPE_FACTS");
  const reference = facts[0];
  if (facts.some(fact => fact.menu !== reference.menu || fact.temperature !== reference.temperature || fact.serving !== reference.serving
    || fact.source.chunkId !== reference.source.chunkId || !fact.originalText)) throw new Error("INCOMPATIBLE_RECIPE_FACTS");
  return `${reference.temperature} ${reference.menu} (${reference.serving}) 매뉴얼 기준이에요.\n`
    + facts.map(fact => `${fact.originalText}${fact.basis ? ` (${fact.basis} 기준)` : ""}`).join("\n");
}