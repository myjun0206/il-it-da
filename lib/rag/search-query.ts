const INTENT_EXPANSIONS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/몇\s*시|언제\s*열어|언제\s*닫아|언제부터\s*언제까지|문\s*여나요/u, ["영업시간", "운영시간", "오픈", "마감"]],
  [/어디(?:에|야)?/u, ["위치"]],
  [/보관(?:되어)?/u, ["보관 위치", "재고", "재고/발주"]],
  [/머신|커피\s*머신/u, ["장비", "장비관리"]],
  [/제빙기|비품/u, ["장비", "장비관리"]],
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
]);
const TRAILING_PARTICLES = /(에서는|에는|에서|으로|로|은|는|이|가|을|를|에|의|도)$/u;
const MAX_KEYWORD_COUNT = 16;

function getIntentExpansions(question: string): string[] {
  const intentExpansions = INTENT_EXPANSIONS
    .filter(([pattern]) => pattern.test(question))
    .flatMap(([, terms]) => terms);
  const domainExpansions = DOMAIN_EXPANSIONS
    .filter(([keyword]) => question.includes(keyword))
    .flatMap(([, terms]) => terms);

  return [...new Set([...intentExpansions, ...domainExpansions])];
}

function removeTrailingParticles(token: string): string {
  return token.replace(TRAILING_PARTICLES, "");
}

function isStoreName(keyword: string): boolean {
  return keyword.endsWith("점");
}

export function expandSearchQuestion(question: string): string {
  const normalizedQuestion = question.trim();
  return [normalizedQuestion, ...getIntentExpansions(normalizedQuestion)].join(" ");
}

export function extractSearchKeywords(question: string): string[] {
  const normalizedQuestion = question.trim();
  const tokens = normalizedQuestion
    .toLocaleLowerCase("ko-KR")
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => ({ original: token, normalized: removeTrailingParticles(token).trim() }))
    .filter(({ original, normalized }) => (
      normalized.length >= 2 &&
      !STOPWORDS.has(original) &&
      !STOPWORDS.has(normalized) &&
      !isStoreName(normalized)
    ))
    .map(({ normalized }) => normalized);
  const domainKeywords = DOMAIN_KEYWORDS.filter((keyword) => normalizedQuestion.includes(keyword));
  const intentKeywords = getIntentExpansions(normalizedQuestion);

  return [...new Set([...tokens, ...domainKeywords, ...intentKeywords])]
    .filter((keyword) => keyword.trim().length >= 2 && !STOPWORDS.has(keyword))
    .slice(0, MAX_KEYWORD_COUNT);
}

export function formatSearchEmbeddingInput(question: string): string {
  const normalizedQuestion = question.trim();
  const expandedQuestion = expandSearchQuestion(normalizedQuestion);

  return `매뉴얼 검색 질문: ${expandedQuestion}`;
}