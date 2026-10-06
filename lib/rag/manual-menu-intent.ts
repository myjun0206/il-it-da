import { getNumberedManualItemHeading, splitTextIntoManualItems } from "@/lib/manuals/detect-manual-item";
import type { ManualChunkMatch } from "@/lib/rag/types";

function latteNames(text: string): string[] {
  const names = [...text.matchAll(/[가-힣A-Za-z]+(?:[ \t]+카페)?[ \t]*라떼/gu)].map((match) => match[0]
    .replace(/[ \t]/g, "").toLowerCase()
    .replace(/^(?:따뜻한|따듯한|뜨거운|차가운|일반|기본|iced|ice|hot)/u, ""));
  return [...new Set(names.filter((name) => name !== "라떼"))];
}

function isLatteRecipeQuestion(question: string): boolean {
  return question.includes("라떼") && /우유|스팀|온도|레시피|제조|얼마|몇|만들|넣|데우|데워/u.test(question)
    && !/재고|발주|부족|환불|결제|청소|세척|소독|할인|주문.{0,10}(?:넣|해|하)/u.test(question);
}

function hasContrast(question: string): boolean {
  return /말고|아니|않|금지|안\s|하지\s*마/u.test(question);
}

export function canUseFamilyPackHistory(question: string): boolean {
  return (isFamilyPackOperation(question) || isFamilyPackFollowUp(question)) && familyPackVariants(question).length === 0
    && !hasContrast(question) && !/다른|바꿔|새로운/u.test(question);
}

export function isFamilyPackFollowUp(question: string): boolean {
  return /^(?:(?:그럼|그러면|그리고|이어서)[,\s]*)?(?:그거|그것|그걸|그건|이거|그\s*메뉴|그\s*팩|해당\s*메뉴)/u.test(question.trim())
    && /어떻게|챙|준비|포장|담|만들|제조|순서|구성|수량/u.test(question)
    && !/라떼|우유|시럽|튀김기|청소|세척|재고|발주|부족|환불|결제|할인|급여|다른|바꿔|새로운/u.test(question)
    && !hasContrast(question);
}

export function priorFamilyPackVariant(question: string): string | undefined {
  const variants = familyPackVariants(question);
  return variants.length === 1 && !hasContrast(question)
    && !/라떼|시럽|튀김기|청소|세척|재고|발주|부족|환불|결제|할인|급여|또는|혹은|비교|차이/u.test(question) ? variants[0] : undefined;
}

export function familyPackVariants(text: string): string[] {
  return [...new Set([...text.matchAll(/([A-Za-z0-9]+)[ \t]*패밀리[ \t]*팩/gu)].map((match) => match[1].toUpperCase()))];
}

export function isFamilyPackOperation(question: string): boolean {
  return /패밀리\s*팩/u.test(question) && /구성|수량|몇|챙|제조|만들|준비|담|포장|어떻게/u.test(question)
    && !/재고|발주|부족|환불|결제|할인/u.test(question);
}

export function candidateMenuNames(match: Pick<ManualChunkMatch, "title" | "content">): string[] {
  const headings = splitTextIntoManualItems(match.content).flatMap((section) => section.split(/\r?\n/).map(getNumberedManualItemHeading))
    .filter((heading): heading is string => heading !== null);
  return [...new Set([...latteNames(match.title), ...headings.flatMap(latteNames)])];
}

export function selectMenuCandidates(question: string, matches: readonly ManualChunkMatch[]) {
  const requestedMenus = latteNames(question);
  const active = isLatteRecipeQuestion(question) && !hasContrast(question);
  const requestedPackVariants = isFamilyPackOperation(question) && !hasContrast(question) ? familyPackVariants(question) : [];
  const rejectedChunkIds: string[] = [];
  const selected = matches.filter((match) => {
    const menus = candidateMenuNames(match);
    const packKinds = familyPackVariants(`${match.title}\n${match.content}`);
    const packConflict = requestedPackVariants.length > 0 && packKinds.length > 0 && packKinds.every((kind) => !requestedPackVariants.includes(kind));
    const conflict = packConflict || active && requestedMenus.length > 0 && menus.length > 0
      && menus.every((menu) => !requestedMenus.includes(menu));
    if (conflict) rejectedChunkIds.push(match.chunk_id);
    return !conflict;
  });
  return { matches: selected, requestedMenus: active ? requestedMenus : [], requestedPackVariants, rejectedChunkIds };
}

export function buildMenuClarification(question: string, provided: readonly ManualChunkMatch[]) {
  if (isFamilyPackOperation(question) && familyPackVariants(question).length === 0) {
    const packs = provided.filter((match) => /패밀리\s*팩/u.test(`${match.title}\n${match.content}`));
    if (packs.length === 0) return { answerable: false, answer: "", usedChunkIds: [] as string[] };
    return { answerable: true, answer: "어떤 종류의 패밀리팩을 말씀하시나요? 정확한 종류를 알려주세요.", usedChunkIds: packs.map((match) => match.chunk_id) };
  }
  if (!isLatteRecipeQuestion(question) || latteNames(question).length > 0) return null;
  const identified = provided.filter((match) => candidateMenuNames(match).length > 0 || /라떼/u.test(`${match.title}\n${match.content}`));
  if (identified.length === 0) return { answerable: false, answer: "", usedChunkIds: [] as string[] };
  return {
    answerable: true,
    answer: "어떤 라떼 메뉴를 말씀하시나요? 정확한 메뉴명을 알려주세요.",
    usedChunkIds: identified.map((match) => match.chunk_id),
  };
}