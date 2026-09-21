import { QUESTION_SET_ENUMS } from "./question-set.mjs";

const RATE_DECIMAL_PLACES = 4;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function seedCounts(values) {
  return Object.fromEntries(values.map((value) => [value, 0]));
}

function incrementCount(distribution, value) {
  if (!isNonEmptyString(value)) {
    return;
  }
  distribution[value] = (distribution[value] ?? 0) + 1;
}

/** Rounds count/total to a fixed precision; 0 when total is not a positive number (never NaN/Infinity). */
export function computeRate(count, total) {
  if (!(total > 0)) {
    return 0;
  }
  const factor = 10 ** RATE_DECIMAL_PLACES;
  return Math.round((count / total) * factor) / factor;
}

function makeDatasetWarning(code, count) {
  return { code, severity: "warning", count };
}

function makeGroupWarning(code, questionIds) {
  const sortedIds = [...new Set(questionIds)].sort();
  return { code, severity: "warning", count: sortedIds.length, questionIds: sortedIds };
}

/**
 * Computes de-identified distribution/completeness statistics and quality warnings for a
 * validated question set. Pure function: never mutates its input, never returns question/answer/
 * expected_result/keyword/forbidden-content text or storeId/UUID values — only counts and questionIds.
 */
export function analyzeQuestionSet(questionSet) {
  const items = Array.isArray(questionSet) ? questionSet : [];
  const total = items.length;

  const distributions = {
    questionType: seedCounts(QUESTION_SET_ENUMS.questionType),
    targetStore: {},
    expectedStatus: seedCounts(QUESTION_SET_ENUMS.expectedStatus),
    manualScope: {},
    category: {},
    priority: {},
  };

  const completeness = {
    withExpectedKeywords: 0,
    withoutExpectedKeywords: 0,
    withForbiddenContent: 0,
    withoutForbiddenContent: 0,
    withExpectedResult: 0,
    withoutExpectedResult: 0,
    withCategory: 0,
    withoutCategory: 0,
    withNote: 0,
    withoutNote: 0,
  };

  const questionIdOccurrences = new Map();
  const answeredWithoutKeywords = new Set();
  const cautiousWithoutKeywords = new Set();
  const insufficientWithKeywords = new Set();
  const categoryMissing = new Set();
  const priorityMissing = new Set();

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const questionId = isNonEmptyString(item.question_id) ? item.question_id : null;
    if (questionId) {
      questionIdOccurrences.set(questionId, (questionIdOccurrences.get(questionId) ?? 0) + 1);
    }

    incrementCount(distributions.questionType, item.question_type);
    incrementCount(distributions.targetStore, item.target_store);
    incrementCount(distributions.expectedStatus, item.expected_status);
    incrementCount(distributions.manualScope, item.manual_scope);
    incrementCount(distributions.category, item.category);
    incrementCount(distributions.priority, item.priority);

    const hasExpectedKeywords = isNonEmptyStringArray(item.expected_keywords);
    const hasForbiddenContent = isNonEmptyStringArray(item.forbidden_content);
    const hasExpectedResult = isNonEmptyString(item.expected_result);
    const hasCategory = isNonEmptyString(item.category);
    const hasNote = isNonEmptyString(item.note);
    const hasPriority = isNonEmptyString(item.priority);

    completeness.withExpectedKeywords += hasExpectedKeywords ? 1 : 0;
    completeness.withoutExpectedKeywords += hasExpectedKeywords ? 0 : 1;
    completeness.withForbiddenContent += hasForbiddenContent ? 1 : 0;
    completeness.withoutForbiddenContent += hasForbiddenContent ? 0 : 1;
    completeness.withExpectedResult += hasExpectedResult ? 1 : 0;
    completeness.withoutExpectedResult += hasExpectedResult ? 0 : 1;
    completeness.withCategory += hasCategory ? 1 : 0;
    completeness.withoutCategory += hasCategory ? 0 : 1;
    completeness.withNote += hasNote ? 1 : 0;
    completeness.withoutNote += hasNote ? 0 : 1;

    if (questionId) {
      if (item.expected_status === "answered" && !hasExpectedKeywords) {
        answeredWithoutKeywords.add(questionId);
      }
      if (item.expected_status === "cautious" && !hasExpectedKeywords) {
        cautiousWithoutKeywords.add(questionId);
      }
      if (item.expected_status === "insufficient" && hasExpectedKeywords) {
        insufficientWithKeywords.add(questionId);
      }
      if (!hasCategory) {
        categoryMissing.add(questionId);
      }
      if (!hasPriority) {
        priorityMissing.add(questionId);
      }
    }
  }

  const warnings = [];

  if (total === 0) {
    warnings.push(makeDatasetWarning("EMPTY_DATASET", 0));
  } else {
    const missingStatuses = QUESTION_SET_ENUMS.expectedStatus.filter(
      (status) => distributions.expectedStatus[status] === 0,
    );
    if (missingStatuses.length > 0) {
      warnings.push(makeDatasetWarning("STATUS_NOT_COVERED", missingStatuses.length));
    }

    const missingTypes = QUESTION_SET_ENUMS.questionType.filter((type) => distributions.questionType[type] === 0);
    if (missingTypes.length > 0) {
      warnings.push(makeDatasetWarning("QUESTION_TYPE_NOT_COVERED", missingTypes.length));
    }

    const specificStores = Object.keys(distributions.targetStore).filter((store) => store !== "all");
    if (specificStores.length === 0) {
      warnings.push(makeDatasetWarning("STORE_NOT_COVERED", 1));
    }
  }

  if (answeredWithoutKeywords.size > 0) {
    warnings.push(makeGroupWarning("ANSWERED_WITHOUT_KEYWORDS", answeredWithoutKeywords));
  }
  if (cautiousWithoutKeywords.size > 0) {
    warnings.push(makeGroupWarning("CAUTIOUS_WITHOUT_KEYWORDS", cautiousWithoutKeywords));
  }
  if (insufficientWithKeywords.size > 0) {
    warnings.push(makeGroupWarning("INSUFFICIENT_WITH_EXPECTED_KEYWORDS", insufficientWithKeywords));
  }
  if (categoryMissing.size > 0) {
    warnings.push(makeGroupWarning("CATEGORY_MISSING", categoryMissing));
  }
  if (priorityMissing.size > 0) {
    warnings.push(makeGroupWarning("PRIORITY_MISSING", priorityMissing));
  }

  const duplicateIds = [...questionIdOccurrences.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  if (duplicateIds.length > 0) {
    warnings.push(makeGroupWarning("DUPLICATE_QUESTION_ID", duplicateIds));
  }

  return { total, distributions, completeness, warnings };
}
