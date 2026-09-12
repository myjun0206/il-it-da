export type ChunkManualOptions = {
  targetSize?: number;
  maxSize?: number;
  overlapSize?: number;
};

const DEFAULT_TARGET_SIZE = 800;
const DEFAULT_MAX_SIZE = 1_200;
const DEFAULT_OVERLAP_SIZE = 120;
const MAX_RAW_TEXT_LENGTH = 50_000;

const MIN_TARGET_SIZE = 200;
const MAX_TARGET_SIZE = 2_000;
const ABSOLUTE_MAX_SIZE = 4_000;

function validateAndNormalizeText(text: unknown): string {
  if (typeof text !== "string") {
    throw new Error("Manual text must be a string.");
  }

  const rawNormalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!rawNormalized) {
    throw new Error("Manual text cannot be empty.");
  }

  if (rawNormalized.length > MAX_RAW_TEXT_LENGTH) {
    throw new Error(
      `Manual text exceeds maximum allowed length of ${MAX_RAW_TEXT_LENGTH} characters.`,
    );
  }

  return rawNormalized;
}

type ResolvedOptions = {
  targetSize: number;
  maxSize: number;
  overlapSize: number;
};

function resolveOptions(options?: ChunkManualOptions): ResolvedOptions {
  const targetSize = options?.targetSize ?? DEFAULT_TARGET_SIZE;
  const maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
  const overlapSize = options?.overlapSize ?? DEFAULT_OVERLAP_SIZE;

  if (
    typeof targetSize !== "number" ||
    !Number.isInteger(targetSize) ||
    targetSize < MIN_TARGET_SIZE ||
    targetSize > MAX_TARGET_SIZE
  ) {
    throw new Error(
      `targetSize must be an integer between ${MIN_TARGET_SIZE} and ${MAX_TARGET_SIZE}.`,
    );
  }

  if (
    typeof maxSize !== "number" ||
    !Number.isInteger(maxSize) ||
    maxSize < targetSize ||
    maxSize > ABSOLUTE_MAX_SIZE
  ) {
    throw new Error(
      `maxSize must be an integer between targetSize (${targetSize}) and ${ABSOLUTE_MAX_SIZE}.`,
    );
  }

  if (
    typeof overlapSize !== "number" ||
    !Number.isInteger(overlapSize) ||
    overlapSize < 0 ||
    overlapSize >= targetSize
  ) {
    throw new Error(
      `overlapSize must be a non-negative integer less than targetSize (${targetSize}).`,
    );
  }

  return { targetSize, maxSize, overlapSize };
}

function findBestCutIndex(segment: string, targetSize: number): number {
  if (segment.length <= targetSize) {
    return segment.length;
  }

  const minAcceptable = Math.floor(targetSize * 0.5);

  const searchWindow = segment.slice(0, targetSize);

  const paragraphIdx = searchWindow.lastIndexOf("\n\n");
  if (paragraphIdx >= minAcceptable) {
    return paragraphIdx + 2;
  }

  const newlineIdx = searchWindow.lastIndexOf("\n");
  if (newlineIdx >= minAcceptable) {
    return newlineIdx + 1;
  }

  const sentenceRegex = /[.?!。]\s/g;
  let match: RegExpExecArray | null;
  let lastSentenceEnd = -1;

  while ((match = sentenceRegex.exec(searchWindow)) !== null) {
    const endPos = match.index + match[0].length;
    if (endPos >= minAcceptable && endPos <= targetSize) {
      lastSentenceEnd = endPos;
    }
  }

  if (lastSentenceEnd !== -1) {
    return lastSentenceEnd;
  }

  const spaceIdx = searchWindow.lastIndexOf(" ");
  if (spaceIdx >= minAcceptable) {
    return spaceIdx + 1;
  }

  return targetSize;
}

function getOverlapStart(chunk: string, overlapSize: number): number {
  if (overlapSize <= 0 || chunk.length <= overlapSize) {
    return 0;
  }

  const rawStart = chunk.length - overlapSize;
  const searchSection = chunk.slice(rawStart);

  const paragraphIdx = searchSection.indexOf("\n\n");
  if (paragraphIdx !== -1 && rawStart + paragraphIdx + 2 < chunk.length) {
    return rawStart + paragraphIdx + 2;
  }

  const newlineIdx = searchSection.indexOf("\n");
  if (newlineIdx !== -1 && rawStart + newlineIdx + 1 < chunk.length) {
    return rawStart + newlineIdx + 1;
  }

  const sentenceRegex = /[.?!。]\s/g;
  const match = sentenceRegex.exec(searchSection);
  if (match && rawStart + match.index + match[0].length < chunk.length) {
    return rawStart + match.index + match[0].length;
  }

  const spaceIdx = searchSection.indexOf(" ");
  if (spaceIdx !== -1 && rawStart + spaceIdx + 1 < chunk.length) {
    return rawStart + spaceIdx + 1;
  }

  return rawStart;
}

export function chunkManualText(
  text: string,
  options?: ChunkManualOptions,
): string[] {
  const normalizedText = validateAndNormalizeText(text);
  const { targetSize, maxSize, overlapSize } = resolveOptions(options);

  if (normalizedText.length <= targetSize) {
    return [normalizedText];
  }

  const chunks: string[] = [];
  let cursor = 0;
  const totalLength = normalizedText.length;

  while (cursor < totalLength) {
    const previousCursor = cursor;
    const remainingLength = totalLength - cursor;

    if (remainingLength <= maxSize) {
      const finalChunk = normalizedText.slice(cursor).trim();
      if (finalChunk) {
        chunks.push(finalChunk);
      }
      break;
    }

    const availableSlice = normalizedText.slice(cursor, cursor + maxSize);
    let cutLen = findBestCutIndex(availableSlice, targetSize);

    if (cutLen > maxSize) {
      cutLen = maxSize;
    }

    const candidateChunk = availableSlice.slice(0, cutLen).trim();

    if (!candidateChunk) {
      cursor += Math.max(1, cutLen);
      continue;
    }

    chunks.push(candidateChunk);

    const nextBasePos = cursor + cutLen;

    if (overlapSize > 0) {
      const overlapOffset = getOverlapStart(candidateChunk, overlapSize);
      const overlapLen = candidateChunk.length - overlapOffset;
      const nextPosWithOverlap = nextBasePos - overlapLen;

      if (nextPosWithOverlap > cursor && nextPosWithOverlap < totalLength) {
        cursor = nextPosWithOverlap;
      } else {
        cursor = nextBasePos;
      }
    } else {
      cursor = nextBasePos;
    }

    if (cursor <= previousCursor) {
      cursor = previousCursor + 1;
    }
  }

  if (chunks.length === 0) {
    throw new Error("Failed to produce valid chunks from manual text.");
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (typeof chunk !== "string" || !chunk.trim()) {
      throw new Error(`Invalid empty chunk produced at index ${i}.`);
    }

    if (chunk.length > maxSize) {
      throw new Error(
        `Chunk at index ${i} exceeds maximum allowed size of ${maxSize}.`,
      );
    }

    if (chunk !== chunk.trim()) {
      throw new Error(`Chunk at index ${i} has untrimmed whitespace.`);
    }
  }

  return chunks;
}
