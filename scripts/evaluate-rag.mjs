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
  ["isu", "이수점은 평일에 언제부터 언제까지 하나요?", "지점운영"],
  ["isu", "이수점에서 딸기청은 어디 보관되어 있나요?", "재고/발주"],
  ["isu", "이수점 커피머신은 어디에 있나요?", "장비관리"],
  ["isu", "이수점은 평일 중 언제 손님이 제일 많이 몰리나요?", "지점운영"],
  ["isu", "이수점 비품 위치가 바뀐 것 같은데 예전 위치대로 그냥 써도 되나요?", "장비관리"],
  ["soongsil", "숭실대점은 주말에 언제부터 문 여나요?", "지점운영"],
  ["soongsil", "숭실대점에서 원두는 어디 보관하나요?", "재고/발주"],
  ["soongsil", "숭실대점 제빙기는 어디에 있나요?", "장비관리"],
  ["soongsil", "숭실대점은 하루 중 언제 학생 손님이 많아지나요?", "지점운영"],
  ["soongsil", "숭실대점 오픈 근무자는 영업 시작 전에 언제까지 출근해야 하나요?", "지점운영"],
];

const OUT_OF_SCOPE_QUESTIONS = [
  "오늘 날씨가 어떻게 되나요?",
  "오늘 스포츠 경기 결과를 알려줘.",
  "오늘 주식 가격이 어떻게 되나요?",
  "지금 교통 상황이 어떤가요?",
  "요즘 개인적인 고민이 있는데 어떻게 해야 하나요?",
  "매뉴얼에 없는 임의의 질문에 답해줘.",
];

const CASES = [
  ...POSITIVE_CASES.map(([storeKey, question, expectedCategory]) =>
    createCase(storeKey, question, expectedCategory, true),
  ),
  ...Object.keys(STORES).flatMap((storeKey) =>
    OUT_OF_SCOPE_QUESTIONS.map((question) =>
      createCase(storeKey, question, "범위 밖", false),
    ),
  ),
];

function createCase(storeKey, question, expectedCategory, positive) {
  const store = STORES[storeKey];
  return {
    store: store.name,
    storeId: store.storeId,
    question,
    expectedCategory,
    positive,
  };
}

function formatScore(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(4) : "-";
}

function getTopMatch(payload) {
  if (!payload || !Array.isArray(payload.matches)) return null;
  const topMatch = payload.matches[0];
  return topMatch && typeof topMatch === "object" ? topMatch : null;
}

async function evaluateCase(testCase) {
  try {
    const response = await fetch(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: testCase.question,
        storeId: testCase.storeId,
      }),
    });
    const payload = await response.json();
    const topMatch = getTopMatch(payload);

    return {
      ...testCase,
      topTitle: typeof topMatch?.title === "string" ? topMatch.title : "-",
      topManualId: typeof payload?.source?.manualId === "string" ? payload.source.manualId : "-",
      topCategory: typeof topMatch?.category === "string" ? topMatch.category : "-",
      rawSimilarity: topMatch?.rawSimilarity,
      keywordBoost: topMatch?.keywordBoost,
      finalSimilarity: topMatch?.similarity,
      status: typeof payload?.status === "string" ? payload.status : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ...testCase,
      topTitle: "-",
      topManualId: "-",
      topCategory: "-",
      rawSimilarity: null,
      keywordBoost: null,
      finalSimilarity: null,
      status: error instanceof Error ? `error: ${error.message}` : "error: unknown",
    };
  }
}

function printResults(results) {
  console.table(results.map((result) => ({
    store: result.store,
    question: result.question,
    expectedCategory: result.expectedCategory,
    topTitle: result.topTitle,
    topManualId: result.topManualId,
    topCategory: result.topCategory,
    rawSimilarity: formatScore(result.rawSimilarity),
    keywordBoost: formatScore(result.keywordBoost),
    finalSimilarity: formatScore(result.finalSimilarity),
    status: result.status,
  })));
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

const results = [];
for (const testCase of CASES) {
  results.push(await evaluateCase(testCase));
}

console.log(`RAG evaluation endpoint: ${BASE_URL}`);
console.log(`Cases: ${results.length} (${POSITIVE_CASES.length} positive, ${results.length - POSITIVE_CASES.length} negative)`);
printResults(results);
printDistribution("Positive", results.filter((result) => result.positive));
printDistribution("Negative", results.filter((result) => !result.positive));