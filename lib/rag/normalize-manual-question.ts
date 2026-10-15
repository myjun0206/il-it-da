const TERM_SPELLINGS: readonly [RegExp, string][] = [
  [/레\s*시\s*피|래\s*시\s*피|레\s*시\s*퓌/gu, "레시피"],
  [/라\s*떼|라\s*때|라\s*테|라\s*뗴/gu, "라떼"],
  [/딸\s*기/gu, "딸기"],
  [/바\s*닐\s*라/gu, "바닐라"],
  [/카\s*페/gu, "카페"],
  [/아\s*이\s*스/gu, "아이스"],
  [/에\s*스\s*프\s*레\s*소|에\s*스\s*프\s*래\s*소|에\s*스\s*프\s*레\s*쏘/gu, "에스프레소"],
  [/우\s*유/gu, "우유"],
  [/시\s*럽/gu, "시럽"],
  [/스\s*무\s*디/gu, "스무디"],
  [/제\s*빙\s*기/gu, "제빙기"],
  [/원\s*두/gu, "원두"],
];

export function normalizeManualQuestion(question: string): string {
  let normalized = question.normalize("NFC").replace(/\s+/gu, " ").trim();
  for (const [pattern, canonical] of TERM_SPELLINGS) normalized = normalized.replace(pattern, canonical);
  return normalized.replace(/(딸기|바닐라|카페)\s+라떼/gu, "$1라떼")
    .replace(/라떼\s*레시피/gu, "라떼 레시피");
}