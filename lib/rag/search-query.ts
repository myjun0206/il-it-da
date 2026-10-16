import { normalizeManualQuestion } from "@/lib/rag/normalize-manual-question";

const INTENT_EXPANSIONS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/몇\s*시|언제\s*열어|언제\s*닫아|언제부터\s*언제까지|문\s*여나요/u, ["영업시간", "운영시간", "오픈", "마감"]],
  [/어디(?:에|야)?/u, ["위치"]],
  [/보관(?:되어)?/u, ["보관 위치", "재고", "재고/발주"]],
  [/머신|커피\s*머신/u, ["장비", "장비관리"]],
  [/제빙기|비품/u, ["장비", "장비관리"]],
  [/손\s*위생|손(?:을)?\s*씻/u, ["위생", "개인위생", "손 씻기"]],
];
const DOMAIN_KEYWORDS = [
  "평일",
  "주말",
  "오픈",
  "마감",
  "청소",
  "재고",
  "발주",
  "원두",
  "딸기청",
  "제빙기",
] as const;
const DOMAIN_EXPANSIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["환불", ["취소", "결제", "영수증", "결제 내역", "처리", "정책"]],
  ["발주", ["주문", "입고", "수량", "평균 사용량", "기준"]],
  ["원두", ["재고", "발주", "입고", "사용량"]],
  ["청소", ["세척", "소독", "위생", "점검"]],
  ["오픈", ["영업 시작", "준비", "점검", "체크리스트"]],
  ["마감", ["영업 종료", "청소", "위생", "점검"]],
];
const STOPWORDS = new Set([
  "오늘",
  "어떻게",
  "되나요",
  "하나요",
  "알려줘",
  "알려주세요",
  "언제부터",
  "언제까지",
  "어디",
  "있나요",
  "매뉴얼",
  "없는",
  "임의",
  "질문",
  "답해줘",
  "답해주세요",
  "상황",
  "경우",
  "사항",
]);
const TRAILING_PARTICLES = /(에서는|에는|에서|으로|로|은|는|이|가|을|를|에|의|도)$/u;
const MAX_KEYWORD_COUNT = 16;
const STOCK_SHORTAGE_PATTERN = /부족|(?:재고|재료|물품|소모품|비품).{0,30}(?:없|떨어)|거의\s*(?:없|안\s*남)|얼마\s*안\s*남|다\s*떨어/u;
const PROCUREMENT_REQUEST_PATTERN = /발주|주문(?:을|은)?\s*(?:(?:바로|직접|먼저|좀)\s*)?(?:넣|해|하|할)/u;
const BUNDLE_PATTERN = /세트|팩|묶음|콤보/u;
const QUANTITY_INTENT_PATTERN = /구성|수량|몇\s*(?:개|잔|인분)|개씩|얼마나\s*(?:챙|담)/u;
const DELIVERY_OMISSION_PATTERN = /(?:배달(?:\s*앱)?).{0,20}(?:누락|빠지(?:었|는|고|면)?|빠졌|빠진|빠짐|미접수|안\s*오)|(?:누락|빠지(?:었|는|고|면)?|빠졌|빠진|빠짐|미접수|안\s*오).{0,20}배달/u;

function getIntentExpansions(question: string): string[] {
  const closingOrderQuestion = /마감.{0,24}(?:주문|받아|접수)|(?:주문|받아|접수).{0,24}마감/u.test(question);
  const intentExpansions = INTENT_EXPANSIONS
    .filter(([pattern]) => pattern.test(question))
    .flatMap(([, terms]) => terms);
  const domainExpansions = DOMAIN_EXPANSIONS
    .filter(([keyword]) => question.includes(keyword) && !(closingOrderQuestion && keyword === "마감"))
    .flatMap(([, terms]) => terms);
  const contextualExpansions: string[] = [];
  if (closingOrderQuestion) contextualExpansions.push("마감시간 전 마지막 주문 여부", "POS에 표시된 주문 상태", "추가 주문이 가능한 시간", "담당자에게 확인");
  if (STOCK_SHORTAGE_PATTERN.test(question) && PROCUREMENT_REQUEST_PATTERN.test(question)) {
    contextualExpansions.push("재고", "재고 확인", "발주", "입고");
  }
  if (BUNDLE_PATTERN.test(question) && QUANTITY_INTENT_PATTERN.test(question)) {
    contextualExpansions.push("구성", "수량");
  }
  if (DELIVERY_OMISSION_PATTERN.test(question)) {
    contextualExpansions.push("배달 주문 누락", "배달앱 주문", "미접수 주문", "주문 누락 확인", "주문·포장 오류");
  }
  const beverageRecipe = /라떼|우유|음료/u.test(question) && /양|얼마|몇|온도|스팀|데우|데워|제조|만들/u.test(question);
  const contrasted = /말고|아니|않|금지|안\s|하지\s*마/u.test(question);
  if (beverageRecipe && !contrasted) {
    if (/따뜻|뜨거|\bHOT\b/iu.test(question)) contextualExpansions.push("HOT", "따뜻한");
    if (/스팀|우유.{0,20}(?:데우|데워)|몇\s*도.{0,12}(?:데우|데워)/u.test(question)) contextualExpansions.push("스팀", "우유 데우기", "스팀 온도");
  }

  return [...new Set([...intentExpansions, ...domainExpansions, ...contextualExpansions])];
}

function removeTrailingParticles(token: string): string {
  return token.replace(TRAILING_PARTICLES, "");
}

function isStoreName(keyword: string): boolean {
  return keyword.endsWith("점");
}

export function isClearlyOutOfScopeQuestion(question: string): boolean {
  const text = question.trim().toLowerCase();
  const hasStoreContext = /(?:매장|지점|가게|근무|출근|퇴근|영업|운영|오픈|마감|포스|pos|결제|환불|취소|영수증|주문|발주|재고|비품|위생|소독|청소|세척|레시피|음료|커피|라떼|아메리카노|원두|시럽|우유|얼음|제빙기|머신|테이블|의자|화장실|손님|고객|배송|입고|유통기한|폐기|알바|직원|점주|사장|기준|규정|방법|위치|절차)/u.test(text);
  if (hasStoreContext) return false;
  if (/(?:오늘\s*|내일\s*|지금\s*)?(?:날씨|기온|미세먼지|황사|일기예보)(?:가|는|은|도)?\s*(?:어때|어떻|알려|어떠|어떨|궁금)/u.test(text)
    || /^(?:오늘\s*|내일\s*)?비\s*(?:와|올까|오니|오나요|내려)/u.test(text)) return true;
  if (/(?:주식|비트코인|코인\s*시세|로또\s*번호|복권|운세|타로|사주|오늘의\s*운세)/u.test(text)) return true;
  if (/^(?:너|당신|자기)?\s*(?:누구(?:야|예요|인가요)|이름이\s*뭐|몇\s*살이야|심심해|노래\s*불러|농담\s*해줘|영화\s*추천|맛집\s*추천)/u.test(text)
    || /(?:심심해|놀아줘|심심한데)/u.test(text)) return true;
  return /(?:영어\s*번역|일본어\s*번역|중국어\s*번역|수학\s*문제|코딩\s*해줘|파이썬\s*코드|자바스크립트\s*코드)/u.test(text);
}

export function expandSearchQuestion(question: string): string {
  const normalizedQuestion = normalizeManualQuestion(question);
  return [normalizedQuestion, ...getIntentExpansions(normalizedQuestion)].join(" ");
}

export function extractSearchKeywords(question: string): string[] {
  const normalizedQuestion = normalizeManualQuestion(question);
  const tokens = normalizedQuestion
    .toLocaleLowerCase("ko-KR")
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((original) => {
      const normalized = removeTrailingParticles(original).trim();
      if (STOPWORDS.has(original) || STOPWORDS.has(normalized) || isStoreName(original) || isStoreName(normalized)) return [];
      return [...new Set([normalized, original])].filter((keyword) => keyword.length >= 2);
    });
  const domainKeywords = DOMAIN_KEYWORDS.filter((keyword) => normalizedQuestion.includes(keyword));
  const intentKeywords = getIntentExpansions(normalizedQuestion);

  return [...new Set([...tokens, ...domainKeywords, ...intentKeywords])]
    .filter((keyword) => keyword.trim().length >= 2 && !STOPWORDS.has(keyword))
    .slice(0, MAX_KEYWORD_COUNT);
}

export function formatSearchEmbeddingInput(question: string): string {
  const normalizedQuestion = normalizeManualQuestion(question);
  const expandedQuestion = expandSearchQuestion(normalizedQuestion);

  return `매뉴얼 검색 질문: ${expandedQuestion}`;
}