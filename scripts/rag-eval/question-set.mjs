import { readFileSync } from "node:fs";

const QUESTION_TYPES = new Set([
  "normal",
  "paraphrase",
  "insufficient",
  "out_of_scope",
  "store_isolation",
]);
const TARGET_STORES = new Set(["all", "이수점", "숭실대점"]);
const EXPECTED_STATUSES = new Set(["answered", "cautious", "insufficient"]);
const MANUAL_SCOPES = new Set(["hq", "store", "none"]);
const PRIORITIES = new Set(["high", "medium", "low"]);
const MAX_QUESTION_LENGTH = 2_000;
const UTF8_BOM_CHAR_CODE = 0xfeff;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasEmptyStringEntry(values) {
  return values.some((item) => item.trim().length === 0);
}

function stripUtf8Bom(text) {
  return text.charCodeAt(0) === UTF8_BOM_CHAR_CODE ? text.slice(1) : text;
}

/** Normalizes text for case/whitespace-insensitive comparisons; non-string input yields "". */
export function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function pushError(errors, { index, questionId, field, code }) {
  errors.push({ index, questionId, field, code });
}

function validateRequiredEnumField(errors, item, index, questionId, field, allowedValues) {
  if (!isNonEmptyString(item[field])) {
    pushError(errors, { index, questionId, field, code: "REQUIRED_FIELD_MISSING" });
    return;
  }

  if (!allowedValues.has(item[field])) {
    pushError(errors, { index, questionId, field, code: "INVALID_ENUM_VALUE" });
  }
}

function validateQuestionField(errors, item, index, questionId) {
  if (typeof item.question !== "string") {
    pushError(errors, { index, questionId, field: "question", code: "REQUIRED_FIELD_MISSING" });
    return;
  }

  const trimmed = item.question.trim();

  if (trimmed.length === 0) {
    pushError(errors, { index, questionId, field: "question", code: "QUESTION_EMPTY" });
    return;
  }

  if (trimmed.length > MAX_QUESTION_LENGTH) {
    pushError(errors, { index, questionId, field: "question", code: "QUESTION_TOO_LONG" });
  }
}

function validateStringArrayField(errors, item, index, questionId, field) {
  if (item[field] === undefined) {
    return;
  }

  if (!isStringArray(item[field])) {
    pushError(errors, { index, questionId, field, code: "INVALID_ARRAY_OF_STRINGS" });
    return;
  }

  if (hasEmptyStringEntry(item[field])) {
    pushError(errors, { index, questionId, field, code: "EMPTY_STRING_IN_ARRAY" });
  }
}

function validateOptionalEnumField(errors, item, index, questionId, field, allowedValues) {
  if (item[field] === undefined) {
    return;
  }

  if (typeof item[field] !== "string" || !allowedValues.has(item[field])) {
    pushError(errors, { index, questionId, field, code: "INVALID_ENUM_VALUE" });
  }
}

function validateOptionalStringField(errors, item, index, questionId, field) {
  if (item[field] !== undefined && typeof item[field] !== "string") {
    pushError(errors, { index, questionId, field, code: "INVALID_TYPE" });
  }
}

function validateItem(errors, item, index, seenIds) {
  const questionId = isNonEmptyString(item?.question_id) ? item.question_id : null;

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    pushError(errors, { index, questionId, field: "root", code: "ITEM_NOT_OBJECT" });
    return;
  }

  if (!isNonEmptyString(item.question_id)) {
    pushError(errors, { index, questionId, field: "question_id", code: "REQUIRED_FIELD_MISSING" });
  } else if (seenIds.has(item.question_id)) {
    pushError(errors, { index, questionId: item.question_id, field: "question_id", code: "DUPLICATE_QUESTION_ID" });
  } else {
    seenIds.set(item.question_id, index);
  }

  validateRequiredEnumField(errors, item, index, questionId, "question_type", QUESTION_TYPES);
  validateRequiredEnumField(errors, item, index, questionId, "target_store", TARGET_STORES);
  validateQuestionField(errors, item, index, questionId);
  validateRequiredEnumField(errors, item, index, questionId, "expected_status", EXPECTED_STATUSES);

  validateOptionalEnumField(errors, item, index, questionId, "manual_scope", MANUAL_SCOPES);
  validateOptionalStringField(errors, item, index, questionId, "category");
  validateOptionalStringField(errors, item, index, questionId, "expected_result");
  validateStringArrayField(errors, item, index, questionId, "expected_keywords");
  validateStringArrayField(errors, item, index, questionId, "forbidden_content");
  validateOptionalEnumField(errors, item, index, questionId, "priority", PRIORITIES);
  validateOptionalStringField(errors, item, index, questionId, "note");
}

/**
 * Validates an already-parsed question set value against the QA schema.
 * Returns { valid, errors, data } and never mutates the input value.
 */
export function validateQuestionSet(value) {
  const errors = [];

  if (!Array.isArray(value)) {
    pushError(errors, { index: null, questionId: null, field: "root", code: "TOP_LEVEL_NOT_ARRAY" });
    return { valid: false, errors, data: null };
  }

  const seenIds = new Map();

  value.forEach((item, index) => {
    validateItem(errors, item, index, seenIds);
  });

  return { valid: errors.length === 0, errors, data: value };
}

/**
 * Reads a UTF-8 JSON question set file and validates it.
 * Throws for file-read or JSON syntax errors; schema errors are returned, not thrown.
 */
export function loadQuestionSet(filePath) {
  let raw;

  try {
    raw = readFileSync(filePath, "utf8");
  } catch (cause) {
    const error = new Error("Failed to read question set file.");
    error.code = "QUESTION_SET_READ_ERROR";
    error.cause = cause;
    throw error;
  }

  let parsed;

  try {
    parsed = JSON.parse(stripUtf8Bom(raw));
  } catch (cause) {
    const error = new Error("Question set file is not valid JSON.");
    error.code = "QUESTION_SET_JSON_SYNTAX_ERROR";
    error.cause = cause;
    throw error;
  }

  return validateQuestionSet(parsed);
}
