import { readFileSync } from "node:fs";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTF8_BOM_CHAR_CODE = 0xfeff;
const ALL_STORES_KEYWORD = "all";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stripUtf8Bom(text) {
  return text.charCodeAt(0) === UTF8_BOM_CHAR_CODE ? text.slice(1) : text;
}

function pushError(errors, { index, name, field, code }) {
  errors.push({ index, name, field, code });
}

function validateEntry(errors, entry, index, seenNames, seenIds) {
  const name = isNonEmptyString(entry?.name) ? entry.name : null;

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    pushError(errors, { index, name, field: "root", code: "ITEM_NOT_OBJECT" });
    return;
  }

  if (!isNonEmptyString(entry.name)) {
    pushError(errors, { index, name, field: "name", code: "REQUIRED_FIELD_MISSING" });
  } else if (seenNames.has(entry.name)) {
    pushError(errors, { index, name: entry.name, field: "name", code: "DUPLICATE_NAME" });
  } else {
    seenNames.set(entry.name, index);
  }

  // Never echo the actual id value in an error: only report presence/shape problems.
  if (!isNonEmptyString(entry.id)) {
    pushError(errors, { index, name, field: "id", code: "REQUIRED_FIELD_MISSING" });
  } else if (!UUID_REGEX.test(entry.id)) {
    pushError(errors, { index, name, field: "id", code: "INVALID_UUID" });
  } else if (seenIds.has(entry.id)) {
    pushError(errors, { index, name, field: "id", code: "DUPLICATE_ID" });
  } else {
    seenIds.set(entry.id, index);
  }
}

/** Validates a parsed store-map value ([{name, id}]) without mutating it. */
export function validateStoreMap(value) {
  const errors = [];

  if (!Array.isArray(value)) {
    pushError(errors, { index: null, name: null, field: "root", code: "TOP_LEVEL_NOT_ARRAY" });
    return { valid: false, errors, data: null };
  }

  const seenNames = new Map();
  const seenIds = new Map();

  value.forEach((entry, index) => {
    validateEntry(errors, entry, index, seenNames, seenIds);
  });

  return { valid: errors.length === 0, errors, data: value };
}

/** Reads a UTF-8 store-map JSON file and validates it; throws for read/JSON errors. */
export function loadStoreMap(filePath) {
  let raw;

  try {
    raw = readFileSync(filePath, "utf8");
  } catch (cause) {
    const error = new Error("Failed to read store map file.");
    error.code = "STORE_MAP_READ_ERROR";
    error.cause = cause;
    throw error;
  }

  let parsed;

  try {
    parsed = JSON.parse(stripUtf8Bom(raw));
  } catch (cause) {
    const error = new Error("Store map file is not valid JSON.");
    error.code = "STORE_MAP_JSON_SYNTAX_ERROR";
    error.cause = cause;
    throw error;
  }

  return validateStoreMap(parsed);
}

/** Builds a name -> id lookup Map from validated store-map entries, without mutating input. */
export function createStoreMap(entries) {
  const map = new Map();

  for (const entry of entries) {
    map.set(entry.name, entry.id);
  }

  return map;
}

/** Resolves a target_store value ("all" or an exact store name) to [{name, id}]. */
export function resolveTargetStores(targetStore, storeMap) {
  if (targetStore === ALL_STORES_KEYWORD) {
    return Array.from(storeMap, ([name, id]) => ({ name, id }));
  }

  if (storeMap.has(targetStore)) {
    return [{ name: targetStore, id: storeMap.get(targetStore) }];
  }

  const error = new Error("Unknown target_store: no matching entry in the store map.");
  error.code = "UNKNOWN_TARGET_STORE";
  throw error;
}
