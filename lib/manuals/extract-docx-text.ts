// .docx(Word) 본문을 순수 텍스트로 변환한다. 외부 의존성 없이 document.xml 문자열만 다루므로 node:test로 바로 검증할 수 있다.
// zip 해제는 호출하는 쪽(API 라우트)에서 xlsx 패키지에 포함된 CFB 리더로 처리한다.

type DocxParagraph = { text: string; isHeading: boolean };

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeXml(value: string): string {
  return value
    .replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)));
}

// Word 기본 제목 스타일(Heading1, Title, 한글 Word의 "제목1" 등)을 소제목 경계로 사용한다.
function isHeadingStyle(paragraphXml: string): boolean {
  const match = paragraphXml.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/);
  if (!match) return false;
  return /heading|title|제목/i.test(match[1]);
}

export function parseDocxParagraphs(documentXml: string): DocxParagraph[] {
  const paragraphs: DocxParagraph[] = [];
  const paragraphPattern = /<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g;

  for (const match of documentXml.matchAll(paragraphPattern)) {
    const inner = match[1] ?? "";
    let text = "";
    const tokenPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g;

    for (const token of inner.matchAll(tokenPattern)) {
      if (token[1] !== undefined) {
        text += decodeXml(token[1]);
      } else if (token[0].startsWith("<w:tab")) {
        text += "\t";
      } else {
        text += "\n";
      }
    }

    paragraphs.push({ text: text.trim(), isHeading: isHeadingStyle(inner) });
  }

  return paragraphs;
}

/**
 * 문단 목록을 온보딩 파서가 이해하는 텍스트(빈 줄 = 항목 경계, 항목 첫 줄 = 소제목)로 만든다.
 * - 제목 스타일이 있으면: 제목마다 새 항목을 시작한다.
 * - 없고 빈 문단이 있으면: 원래 문서의 빈 줄 구조를 그대로 쓴다.
 * - 둘 다 없으면: 문단 하나를 항목 하나로 본다.
 */
export function docxParagraphsToText(paragraphs: DocxParagraph[]): string {
  const hasHeading = paragraphs.some((p) => p.isHeading && p.text);

  if (hasHeading) {
    const blocks: string[] = [];
    for (const p of paragraphs) {
      if (!p.text) continue;
      if (p.isHeading || blocks.length === 0) {
        blocks.push(p.text);
      } else {
        blocks[blocks.length - 1] += `\n${p.text}`;
      }
    }
    return blocks.join("\n\n");
  }

  const hasEmptyParagraph = paragraphs.some((p) => !p.text);
  if (hasEmptyParagraph) {
    return paragraphs
      .map((p) => p.text)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return paragraphs
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n\n");
}

export function extractDocxTextFromXml(documentXml: string): string {
  return docxParagraphsToText(parseDocxParagraphs(documentXml));
}
