import { pathToFileURL } from "node:url";

import {
  ERROR_CODES,
  VERBOSE_WARNING,
  buildErrorResult,
  buildReviewWarnings,
  buildSummaryRow,
  buildVerboseDetail,
  formatScore,
  getSafeEndpointOrigin,
} from "./rag-eval/evaluate-rag-log.mjs";

const BASE_URL = process.env.RAG_EVAL_BASE_URL ?? "http://localhost:3000/api/rag/query";

const STORES = {
  isu: {
    name: "이수점",
    storeId: "57181130-4449-4299-a864-25a2098147e4",
  },
  soongsil: {
    name: "숭실대점",
    storeId: "f9bc865b-5722-40b3-8548-1c181f5ad7fb",
  },
};

const POSITIVE_CASES = [
  [
    "isu",
    "이수점은 평일에 언제부터 언제까지 하나요?",
    "지점운영",
    "이수점의 평일 영업시간은 오전 9시부터 오후 10시까지입니다.",
  ],
  [
    "isu",
    "이수점에서 딸기청은 어디 보관되어 있나요?",
    "재고/발주",
    "딸기청은 냉장고 오른쪽 두 번째 선반에 보관합니다.",
  ],
  [
    "isu",
    "이수점 커피머신은 어디에 있나요?",
    "장비관리",
    "커피 머신은 제조대 왼쪽에 있습니다.",
  ],
  [
    "isu",
    "이수점은 평일 중 언제 손님이 제일 많이 몰리나요?",
    "지점운영",
    "평일 12시부터 14시까지와 오후 16시부터 18시까지 주문이 증가할 수 있습니다.",
  ],
  [
    "isu",
    "이수점 비품 위치가 바뀐 것 같은데 예전 위치대로 그냥 써도 되나요?",
    "장비관리",
    "현재 매뉴얼만으로 정확한 위치 변경 여부를 판단할 수 없으므로 임의로 옮기지 말고 사장님 또는 매니저에게 확인해야 합니다.",
  ],
  [
    "soongsil",
    "숭실대점은 주말에 언제부터 문 여나요?",
    "지점운영",
    "숭실대점은 주말 오전 9시에 영업을 시작합니다.",
  ],
  [
    "soongsil",
    "숭실대점에서 원두는 어디 보관하나요?",
    "재고/발주",
    "원두는 제조대 아래쪽의 지정된 보관 공간에 보관합니다.",
  ],
  [
    "soongsil",
    "숭실대점 제빙기는 어디에 있나요?",
    "장비관리",
    "제빙기는 제조대 오른쪽에 있습니다.",
  ],
  [
    "soongsil",
    "숭실대점은 하루 중 언제 학생 손님이 많아지나요?",
    "지점운영",
    "오후 17시부터 20시까지 학생과 포장 주문이 증가할 수 있습니다.",
  ],
  [
    "soongsil",
    "숭실대점 오픈 근무자는 영업 시작 전에 언제까지 출근해야 하나요?",
    "지점운영",
    "영업 시작 30분 전까지 출근합니다. 평일은 오전 7시 30분, 주말은 오전 8시 30분까지입니다.",
  ],
];

const OUT_OF_SCOPE_QUESTIONS = [
  "오늘 날씨가 어떻게 되나요?",
  "오늘 스포츠 경기 결과를 알려줘.",
  "오늘 주식 가격이 어떻게 되나요?",
  "지금 교통 상황이 어떤가요?",
  "요즘 개인적인 고민이 있는데 어떻게 해야 하나요?",
  "매뉴얼에 없는 임의의 질문에 답해줘.",
];

function createCase(storeKey, question, expectedCategory, positive, expectedAnswer = "-") {
  const store = STORES[storeKey];
  return {
    store: store.name,
    storeId: store.storeId,
    question,
    expectedCategory,
    expectedAnswer,
    positive,
  };
}

const CASES = [
  ...POSITIVE_CASES.map(([storeKey, question, expectedCategory, expectedAnswer]) =>
    createCase(storeKey, question, expectedCategory, true, expectedAnswer),
  ),
  ...Object.keys(STORES).flatMap((storeKey) =>
    OUT_OF_SCOPE_QUESTIONS.map((question) =>
      createCase(storeKey, question, "범위 밖", false),
    ),
  ),
].map((testCase, index) => ({ ...testCase, caseId: index + 1 }));

function getTopMatch(payload) {
  if (!payload || !Array.isArray(payload.matches)) return null;
  const topMatch = payload.matches[0];
  return topMatch && typeof topMatch === "object" ? topMatch : null;
}

// fetchImpl is injectable so tests can exercise every branch below without making a
// real network call. `npm run eval:rag` always uses the default global fetch.
async function evaluateCase(testCase, { fetchImpl = fetch, baseUrl = BASE_URL } = {}) {
  let response;
  try {
    response = await fetchImpl(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: testCase.question,
        storeId: testCase.storeId,
      }),
    });
  } catch {
    return buildErrorResult(testCase, { errorCode: ERROR_CODES.NETWORK_ERROR });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return buildErrorResult(testCase, {
      errorCode: ERROR_CODES.INVALID_JSON_RESPONSE,
      httpStatus: response.status,
    });
  }

  if (!response.ok) {
    return buildErrorResult(testCase, {
      errorCode: ERROR_CODES.HTTP_ERROR,
      httpStatus: response.status,
      ragStatus: typeof payload?.status === "string" ? payload.status : null,
    });
  }

  if (typeof payload?.answer !== "string" || typeof payload?.status !== "string") {
    return buildErrorResult(testCase, {
      errorCode: ERROR_CODES.MISSING_RESPONSE_FIELDS,
      httpStatus: response.status,
    });
  }

  const topMatch = getTopMatch(payload);

  return {
    ...testCase,
    actualAnswer: payload.answer,
    topTitle: typeof topMatch?.title === "string" ? topMatch.title : "-",
    topManualId: typeof payload?.source?.manualId === "string" ? payload.source.manualId : "-",
    topCategory: typeof topMatch?.category === "string" ? topMatch.category : "-",
    rawSimilarity: typeof topMatch?.rawSimilarity === "number" ? topMatch.rawSimilarity : null,
    keywordBoost: typeof topMatch?.keywordBoost === "number" ? topMatch.keywordBoost : null,
    finalSimilarity: typeof topMatch?.similarity === "number" ? topMatch.similarity : null,
    httpStatus: response.status,
    ragStatus: payload.status,
    errorCode: null,
  };
}

function printResults(results) {
  console.table(results.map(buildSummaryRow));
}

function printVerboseDetails(results) {
  console.warn(VERBOSE_WARNING);
  console.log("\nVerbose answer review (question/answer text only)");

  for (const result of results) {
    const detail = buildVerboseDetail(result);
    console.log(`\n[case ${detail.case}]`);
    console.log(`question: ${detail.question}`);
    console.log(`expectedAnswer: ${detail.expectedAnswer}`);
    console.log(`actualAnswer: ${detail.actualAnswer}`);
  }
}

function printReviewWarnings(results) {
  const warnings = results.filter((result) => result.positive).flatMap(buildReviewWarnings);
  for (const warning of warnings) {
    console.warn(warning);
  }
}

function printDistribution(label, results) {
  const scoreNames = ["rawSimilarity", "keywordBoost", "finalSimilarity"];
  console.log(`\n${label} score distribution`);

  for (const scoreName of scoreNames) {
    const scores = results
      .map((result) => result[scoreName])
      .filter((score) => typeof score === "number" && Number.isFinite(score));

    if (scores.length === 0) {
      console.log(`${scoreName}: no numeric results`);
      continue;
    }

    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    console.log(
      `${scoreName}: min=${Math.min(...scores).toFixed(4)} max=${Math.max(...scores).toFixed(4)} avg=${average.toFixed(4)} n=${scores.length}`,
    );
  }
}

async function main(argv = process.argv.slice(2)) {
  const verbose = argv.includes("--verbose");
  const safeOrigin = getSafeEndpointOrigin(BASE_URL);

  const results = [];
  for (const testCase of CASES) {
    results.push(await evaluateCase(testCase));
  }

  console.log(`RAG evaluation endpoint (origin/path only): ${safeOrigin ?? "[unavailable]"}`);
  console.log(`Cases: ${results.length} (${POSITIVE_CASES.length} positive, ${results.length - POSITIVE_CASES.length} negative)`);
  printResults(results);
  printReviewWarnings(results);

  if (verbose) {
    printVerboseDetails(results);
  }

  printDistribution("Positive", results.filter((result) => result.positive));
  printDistribution("Negative", results.filter((result) => !result.positive));
}

export {
  CASES,
  STORES,
  createCase,
  evaluateCase,
  formatScore,
  getTopMatch,
  main,
  printDistribution,
  printResults,
  printReviewWarnings,
  printVerboseDetails,
};

const isDirectlyExecuted = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectlyExecuted) {
  await main();
}