// 매뉴얼 파일 텍스트를 100% 로컬 규칙(정규식/문단 분할)으로 분석해
// 카테고리 > 타이틀 > 세부 매뉴얼(items) 3단계 구조로 자동 분류한다.
// 외부 API(OpenAI 등) 호출이 전혀 없으므로 비용이 발생하지 않고, OPENAI_API_KEY 유무와 무관하게 항상 동작한다.

import { splitTextIntoManualItems } from "@/lib/manuals/detect-manual-item";

export type AnalyzedManualGroup = {
  category: string;
  topic: string;
  items: string[];
};

const MAX_INPUT_CHARS = 200_000; // 과도하게 큰 파일로 인한 파싱 지연/DB 폭증을 막기 위한 상한
const MAX_GROUPS = 150;

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// "[카테고리명]" 한 줄로만 이루어진 행을 카테고리 경계로 인식한다.
const BRACKET_CATEGORY_PATTERN = /^[ \t]*\[(.+?)\][ \t]*$/gm;
// 마크다운 대제목(#, ##)을 카테고리 경계로 인식한다.
const MARKDOWN_CATEGORY_PATTERN = /^[ \t]{0,3}#{1,2}[ \t]+(.+?)[ \t]*$/gm;
// "가.", "나." 같은 한글 순서 표기를 카테고리 경계로 인식한다.
const KOREAN_ORDINAL_CATEGORY_PATTERN = /^[ \t]*[가나다라마바사아자차카타파하][.)][ \t]+(.+)$/gm;
// "I.", "II." 같은 로마 숫자 표기를 카테고리 경계로 인식한다.
const ROMAN_NUMERAL_CATEGORY_PATTERN = /^[ \t]*[IVXLCDM]{1,6}[.)][ \t]+(.+)$/gm;

// "1. ", "1) " 같은 평범한 정수 번호를 타이틀 경계로, 마크다운 소제목(###~######)도 타이틀 경계로 인식한다.
// "1-1." 처럼 하이픈이 낀 경우는 다음 문자가 "."/")" 가 아니므로 이 패턴과 절대 겹치지 않는다.
const NUMBERED_TITLE_PATTERN = /^[ \t]*\d{1,3}[.)][ \t]+(.+)$/gm;
const MARKDOWN_TITLE_PATTERN = /^[ \t]{0,3}#{3,6}[ \t]+(.+?)[ \t]*$/gm;


type LineBlock = { heading: string; body: string };

// 주어진 패턴(줄 시작 기준, capture group 1개)이 매치되는 줄들을 경계로 텍스트를 블록으로 나눈다.
// 매치가 2개 미만이면(경계로 쓰기엔 근거가 부족하면) 빈 배열을 반환해 호출자가 다음 우선순위 패턴을 시도하게 한다.
function splitByLineMatches(text: string, pattern: RegExp): LineBlock[] {
  const regex = new RegExp(pattern);
  const starts: { index: number; heading: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    starts.push({ index: match.index, heading: (match[1] ?? "").trim() });
    if (match.index === regex.lastIndex) {
      regex.lastIndex += 1;
    }
  }

  if (starts.length < 2) {
    return [];
  }

  return starts.map((start, i) => {
    const chunkEnd = i + 1 < starts.length ? starts[i + 1].index : text.length;
    const chunk = text.slice(start.index, chunkEnd);
    const firstNewline = chunk.indexOf("\n");
    const body = firstNewline === -1 ? "" : chunk.slice(firstNewline + 1).trim();
    return { heading: start.heading, body };
  });
}

// 빈 줄(\n\n) 기준 문단 분할. 인식 가능한 패턴이 전혀 없을 때의 최후 수단.
function splitByParagraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function detectCategoryBlocks(text: string): { category: string; body: string }[] {
  for (const pattern of [
    BRACKET_CATEGORY_PATTERN,
    MARKDOWN_CATEGORY_PATTERN,
    KOREAN_ORDINAL_CATEGORY_PATTERN,
    ROMAN_NUMERAL_CATEGORY_PATTERN,
  ]) {
    const blocks = splitByLineMatches(text, pattern);
    if (blocks.length >= 2) {
      return blocks.map((block) => ({ category: block.heading || "미분류", body: block.body }));
    }
  }

  return [{ category: "미분류", body: text }];
}

function detectTitleBlocks(body: string, fallbackPrefix: string): { title: string; body: string }[] {
  for (const pattern of [NUMBERED_TITLE_PATTERN, MARKDOWN_TITLE_PATTERN]) {
    const blocks = splitByLineMatches(body, pattern);
    if (blocks.length >= 2) {
      return blocks.map((block) => ({ title: block.heading.slice(0, 80), body: block.body }));
    }
  }

  const paragraphs = splitByParagraphs(body);

  if (paragraphs.length === 0) {
    return [];
  }

  return paragraphs.map((paragraph, index) => {
    const [firstLine, ...rest] = paragraph.split(/\r?\n/);
    const restBody = rest.join("\n").trim();
    return {
      title: (firstLine || `${fallbackPrefix} ${index + 1}`).trim().slice(0, 80),
      body: restBody || paragraph,
    };
  });
}

function detectItems(body: string): string[] {
  // 숫자가 여러 번 등장해도 임의로 쪼개지 않고(detect-manual-item.ts), 타이틀 본문 전체를 하나의 세부 매뉴얼로 유지한다.
  return splitTextIntoManualItems(body);
}

// 파일 하나 안에 섞여 있는 여러 카테고리/타이틀/세부 매뉴얼을 규칙 기반으로 분리한다.
// 인식 가능한 경계 패턴이 전혀 없는 일반 텍스트는 문단 단위로 안전하게 쪼개져 등록된다(에러 없음).
export function parseManualText(text: string): AnalyzedManualGroup[] {
  const trimmed = text.trim().slice(0, MAX_INPUT_CHARS);

  if (!trimmed) {
    return [];
  }

  const groups: AnalyzedManualGroup[] = [];

  for (const { category, body } of detectCategoryBlocks(trimmed)) {
    const resolvedCategory = getString(category) || "미분류";

    for (const { title, body: titleBody } of detectTitleBlocks(body, resolvedCategory)) {
      const topic = getString(title) || "제목 없음";
      const items = detectItems(titleBody).map(getString).filter(Boolean);

      if (!topic || items.length === 0) {
        continue;
      }

      // 카테고리와 타이틀이 우연히 같은 문자열로 감지된 경우 계층이 무너지지 않도록 보정한다.
      const finalCategory = normalizeForCompare(resolvedCategory) === normalizeForCompare(topic) ? "미분류" : resolvedCategory;

      groups.push({ category: finalCategory, topic, items });

      if (groups.length >= MAX_GROUPS) {
        return groups;
      }
    }
  }

  return groups;
}
