type MappedText = { text: string; starts: number[]; ends: number[] };

function mapText(source: string, collapseWhitespace: boolean): MappedText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let offset = 0; offset < source.length;) {
    const start = offset;
    let character = source[offset++];
    if (collapseWhitespace && /[ \t\r\n]/.test(character)) {
      while (offset < source.length && /[ \t\r\n]/.test(source[offset])) offset += 1;
      character = " ";
    } else if (character === "\r") {
      if (source[offset] === "\n") offset += 1;
      character = "\n";
    }
    text += character;
    starts.push(start);
    ends.push(offset);
  }
  return { text, starts, ends };
}

function findSpan(source: string, quote: string, collapseWhitespace: boolean): string | undefined {
  const mapped = mapText(source, collapseWhitespace);
  const candidate = mapText(quote, collapseWhitespace).text.trim();
  if (!candidate) return undefined;
  const index = mapped.text.indexOf(candidate);
  if (index < 0) return undefined;
  return source.slice(mapped.starts[index], mapped.ends[index + candidate.length - 1]);
}

export function findVerifiedQuote(source: string, quote: string): string | undefined {
  const exact = findSpan(source, quote, false);
  if (exact !== undefined) return exact;
  const structural = /^\s*(?:#{1,6}(?:\s|$)|[-*+•●](?:\s|$)|\d+(?:[.-]\d+)*[.)]\s|>|\||```|~~~|[-=]{3,}\s*$)|\|.*\||:\s*$/u;
  const continuesSentence = (line: string) => /\s/u.test(line.trim()) && /(?:은|는|이|가|을|를|에|의|와|과|로|에서|에게|부터|까지|하고|하며|면|및|,)$/u.test(line.trim());
  let segmentStart = -1;
  let segmentEnd = 0;
  let previousLine = "";
  const segments: string[] = [];
  for (const match of source.matchAll(/[^\r\n]+|\r\n|[\r\n]/g)) {
    const line = match[0];
    if (/^[\r\n]+$/.test(line)) continue;
    const gap = segmentStart < 0 ? "" : source.slice(segmentEnd, match.index);
    const plain = Boolean(line.trim()) && !structural.test(line);
    const join = plain && segmentStart >= 0 && /^(?:\r\n|[\r\n])$/.test(gap) && continuesSentence(previousLine);
    if (!join && segmentStart >= 0) {
      segments.push(source.slice(segmentStart, segmentEnd));
      segmentStart = -1;
    }
    if (plain) {
      if (segmentStart < 0) segmentStart = match.index;
      segmentEnd = match.index + line.length;
      previousLine = line;
    }
  }
  if (segmentStart >= 0) segments.push(source.slice(segmentStart, segmentEnd));
  for (const segment of segments) {
    const verified = findSpan(segment, quote, true);
    if (verified !== undefined) return verified;
  }
  return undefined;
}