import "server-only";

const OPENAI_EMBEDDING_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EXPECTED_EMBEDDING_DIMENSION = 1536;
const TIMEOUT_MS = 30_000;
const MAX_INPUT_COUNT = 100;
const MAX_INPUT_LENGTH = 8_000;
const MAX_TOTAL_INPUT_LENGTH = 100_000;

function getOpenAiApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }
  return apiKey;
}

function validateAndNormalizeInputs(inputs: unknown): string[] {
  if (!Array.isArray(inputs)) {
    throw new Error("Inputs must be an array.");
  }

  if (inputs.length === 0) {
    throw new Error("Inputs array cannot be empty.");
  }

  if (inputs.length > MAX_INPUT_COUNT) {
    throw new Error(`Inputs array exceeds maximum allowed limit of ${MAX_INPUT_COUNT}.`);
  }

  const normalized: string[] = [];
  let totalLength = 0;

  for (let i = 0; i < inputs.length; i++) {
    const item = inputs[i];
    if (typeof item !== "string") {
      throw new Error(`Input at index ${i} must be a string.`);
    }

    const trimmed = item.trim();
    if (!trimmed) {
      throw new Error(`Input at index ${i} cannot be empty.`);
    }

    if (trimmed.length > MAX_INPUT_LENGTH) {
      throw new Error(
        `Input at index ${i} exceeds maximum allowed length of ${MAX_INPUT_LENGTH} characters.`,
      );
    }

    totalLength += trimmed.length;
    if (totalLength > MAX_TOTAL_INPUT_LENGTH) {
      throw new Error(
        `Total inputs length exceeds maximum allowed limit of ${MAX_TOTAL_INPUT_LENGTH} characters.`,
      );
    }

    normalized.push(trimmed);
  }

  return normalized;
}

function parseAndSortOpenAiEmbeddings(payload: unknown, expectedCount: number): number[][] {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid response format from OpenAI Embeddings API.");
  }

  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.data)) {
    throw new Error("OpenAI Embeddings response data is not an array.");
  }

  if (record.data.length !== expectedCount) {
    throw new Error(
      `OpenAI Embeddings returned ${record.data.length} embeddings, expected ${expectedCount}.`,
    );
  }

  const sortedEmbeddings: Array<number[] | undefined> = new Array(expectedCount);

  for (let i = 0; i < record.data.length; i++) {
    const item = record.data[i];
    if (!item || typeof item !== "object") {
      throw new Error(`Invalid item at position ${i} in OpenAI Embeddings data.`);
    }

    const itemRecord = item as Record<string, unknown>;
    const index = itemRecord.index;

    if (typeof index !== "number" || !Number.isInteger(index)) {
      throw new Error(`Missing or invalid integer index at position ${i} in OpenAI Embeddings data.`);
    }

    if (index < 0 || index >= expectedCount) {
      throw new Error(`Index ${index} in OpenAI Embeddings response is out of range.`);
    }

    if (sortedEmbeddings[index] !== undefined) {
      throw new Error(`Duplicate index ${index} encountered in OpenAI Embeddings response.`);
    }

    if (!Array.isArray(itemRecord.embedding)) {
      throw new Error(`Embedding array missing at index ${index} in OpenAI Embeddings data.`);
    }

    const embedding = itemRecord.embedding;
    if (embedding.length !== EXPECTED_EMBEDDING_DIMENSION) {
      throw new Error(
        `Embedding dimension mismatch at index ${index}: expected ${EXPECTED_EMBEDDING_DIMENSION}, received ${embedding.length}.`,
      );
    }

    for (let j = 0; j < embedding.length; j++) {
      const val = embedding[j];
      if (typeof val !== "number" || !Number.isFinite(val)) {
        throw new Error(
          `Embedding at index ${index} contains non-finite number at vector offset ${j}.`,
        );
      }
    }

    sortedEmbeddings[index] = embedding as number[];
  }

  for (let i = 0; i < expectedCount; i++) {
    if (sortedEmbeddings[i] === undefined) {
      throw new Error(`Missing embedding for expected index ${i} in OpenAI Embeddings response.`);
    }
  }

  return sortedEmbeddings as number[][];
}

export async function createEmbeddings(inputs: string[]): Promise<number[][]> {
  const normalizedInputs = validateAndNormalizeInputs(inputs);
  const apiKey = getOpenAiApiKey();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_EMBEDDING_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: normalizedInputs,
        encoding_format: "float",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI Embeddings API request failed with status ${response.status}.`);
    }

    const payload: unknown = await response.json();
    return parseAndSortOpenAiEmbeddings(payload, normalizedInputs.length);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenAI Embeddings API request timed out after ${TIMEOUT_MS / 1000} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function createEmbedding(input: string): Promise<number[]> {
  const embeddings = await createEmbeddings([input]);
  const single = embeddings[0];
  if (!single) {
    throw new Error("Failed to generate embedding for single input.");
  }
  return single;
}
