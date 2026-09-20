import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

import { validateQuestionSet } from "./question-set.mjs";

const REQUIRED_COLUMNS = ["question_id", "question_type", "target_store", "question", "expected_status"];
const OPTIONAL_COLUMNS = [
  "manual_scope",
  "category",
  "expected_result",
  "expected_keywords",
  "forbidden_content",
  "priority",
  "note",
];
const KNOWN_COLUMNS = new Set([...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]);
const REQUIRED_COLUMN_SET = new Set(REQUIRED_COLUMNS);
const ARRAY_COLUMNS = new Set(["expected_keywords", "forbidden_content"]);
const HEADER_ROW_NUMBER = 1;
const UTF8_BOM_CHAR_CODE = 0xfeff;

function stripUtf8Bom(text) {
  return text.charCodeAt(0) === UTF8_BOM_CHAR_CODE ? text.slice(1) : text;
}

function pushCsvError(errors, { row, questionId, field, code }) {
  errors.push({ row, questionId, field, code });
}

function isBlankRow(row) {
  return row.every((cell) => typeof cell !== "string" || cell.trim().length === 0);
}

function splitArrayField(rawValue) {
  return rawValue
    .split("|")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function buildRecord(headers, row) {
  const record = {};

  headers.forEach((header, columnIndex) => {
    const rawValue = typeof row[columnIndex] === "string" ? row[columnIndex] : "";

    if (ARRAY_COLUMNS.has(header)) {
      const values = splitArrayField(rawValue);
      if (values.length > 0) {
        record[header] = values;
      }
      return;
    }

    const trimmed = rawValue.trim();

    // question_id must stay a string even if the cell only contains digits.
    if (header === "question_id") {
      record[header] = trimmed;
      return;
    }

    if (trimmed.length === 0 && !REQUIRED_COLUMN_SET.has(header)) {
      return;
    }

    record[header] = trimmed;
  });

  return record;
}

function validateHeaders(headers) {
  const errors = [];
  const seen = new Set();

  for (const header of headers) {
    if (seen.has(header)) {
      pushCsvError(errors, { row: HEADER_ROW_NUMBER, questionId: null, field: header, code: "DUPLICATE_HEADER" });
    } else {
      seen.add(header);
    }

    if (!KNOWN_COLUMNS.has(header)) {
      pushCsvError(errors, { row: HEADER_ROW_NUMBER, questionId: null, field: header, code: "UNKNOWN_HEADER" });
    }
  }

  for (const required of REQUIRED_COLUMNS) {
    if (!seen.has(required)) {
      pushCsvError(errors, {
        row: HEADER_ROW_NUMBER,
        questionId: null,
        field: required,
        code: "MISSING_REQUIRED_HEADER",
      });
    }
  }

  return errors;
}

/**
 * Converts raw CSV rows ([headerRow, ...dataRows]) into question-set records and validates them
 * by delegating to the existing validateQuestionSet (schema rules are never re-implemented here).
 * Returns { valid, errors, data }; errors are shaped as { row, questionId, field, code }.
 */
export function parseQuestionSetCsvRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    const error = new Error("CSV file has no header row.");
    error.code = "CSV_EMPTY_FILE";
    throw error;
  }

  const headers = rows[0].map((cell) => (typeof cell === "string" ? cell.trim() : cell));
  const headerErrors = validateHeaders(headers);

  if (headerErrors.length > 0) {
    return { valid: false, errors: headerErrors, data: null };
  }

  const records = [];
  const rowNumbers = [];
  const structuralErrors = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const csvRowNumber = rowIndex + 1;

    if (isBlankRow(row)) {
      continue;
    }

    if (row.length !== headers.length) {
      pushCsvError(structuralErrors, {
        row: csvRowNumber,
        questionId: null,
        field: "root",
        code: "CSV_COLUMN_COUNT_MISMATCH",
      });
      continue;
    }

    records.push(buildRecord(headers, row));
    rowNumbers.push(csvRowNumber);
  }

  const schemaResult = validateQuestionSet(records);
  const mappedSchemaErrors = schemaResult.errors.map((error) => ({
    row: typeof error.index === "number" ? rowNumbers[error.index] ?? null : null,
    questionId: error.questionId,
    field: error.field,
    code: error.code,
  }));

  const allErrors = [...structuralErrors, ...mappedSchemaErrors];

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    data: allErrors.length === 0 ? records : null,
  };
}

/** Parses an already-read CSV string (no BOM) into { valid, errors, data }. Throws on CSV syntax errors. */
export function parseQuestionSetCsv(csvText) {
  let rows;

  try {
    rows = parse(csvText, {
      columns: false,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: false,
    });
  } catch (cause) {
    const error = new Error("CSV file could not be parsed.");
    error.code = "CSV_SYNTAX_ERROR";
    error.cause = cause;
    throw error;
  }

  return parseQuestionSetCsvRows(rows);
}

/** Reads a UTF-8 (BOM optional) CSV question set file and converts + validates it. */
export function loadCsvQuestionSet(filePath) {
  let raw;

  try {
    raw = readFileSync(filePath, "utf8");
  } catch (cause) {
    const error = new Error("Failed to read CSV question set file.");
    error.code = "CSV_READ_ERROR";
    error.cause = cause;
    throw error;
  }

  return parseQuestionSetCsv(stripUtf8Bom(raw));
}
