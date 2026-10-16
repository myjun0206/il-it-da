import { normalizeTargetText, type StructuredAnswer } from "@/lib/rag/structured-answer";
import type { ManualChunkMatch } from "@/lib/rag/types";
import { extractVerifiedRecipeSourceFacts, renderVerifiedRecipeSourceFacts } from "@/lib/rag/recipe-fact-verification";

const compact = (text: string) => normalizeTargetText(text).replace(/\s+/gu, "").toLowerCase();

function uniqueAnswer(rows: { value: string; chunkId: string }[], conflict: string): StructuredAnswer | null {
  if (!rows.length) return null;
  const usedChunkIds = [...new Set(rows.map(row => row.chunkId))];
  if (new Set(rows.map(row => normalizeTargetText(row.value))).size !== 1) {
    return { answerable: true, answer: conflict, coverage: "clarification", usedChunkIds };
  }
  return { answerable: true, answer: rows[0].value, coverage: "direct", usedChunkIds };
}

function menuIdentity(label: string) {
  const normalized = normalizeTargetText(label);
  const prefix = normalized.match(/^(HOT|ICE(?:D)?|아이스|핫|따뜻한|차가운)\s*/iu);
  const mode = prefix ? /^(?:HOT|핫|따뜻한)/iu.test(prefix[1]) ? "HOT" : "ICE" : null;
  return { menu: compact(prefix ? normalized.slice(prefix[0].length) : normalized), mode };
}

function buildDeliveryOmissionAnswer(question: string, chunks: readonly ManualChunkMatch[]): StructuredAnswer | null {
  if (!/배달(?:\s*주문)?[\s\S]{0,20}누락|누락[\s\S]{0,20}배달/u.test(question)
    || !/어떻게|어케|방법|절차|대처|대응|처리/u.test(question)) return null;

  const requiredFacts = [
    /배달 주문 누락 연락.{0,40}주문번호.{0,40}누락된 메뉴·수량.{0,20}확인/u,
    /POS 주문 내역.{0,40}제조·포장 확인 내용.{0,40}비교하여 누락/u,
    /주문번호.{0,40}누락 메뉴·수량.{0,40}현재 배달 상태.{0,40}(?:점주|담당자).{0,12}보고/u,
    /직원은 임의로 재배달·환불·보상을 약속하지 않는다/u,
    /점주가 결정한 처리 방법에 따라 고객에게 안내/u,
    /카운터 업무용 태블릿.{0,40}배달 누락 기록.{0,60}주문번호.{0,100}처리 결과/u,
  ];
  const matched = chunks.flatMap(chunk => {
    if (normalizeTargetText(chunk.title) !== "배달 주문 누락 대응"
      || normalizeTargetText(chunk.category) !== "주문·결제"
      || chunk.content.length > 1200
      || !requiredFacts.every(pattern => pattern.test(chunk.content))) return [];
    return [{ chunk, quote: chunk.content.trim() }];
  });
  if (!matched.length) return null;

  return {
    answerable: true,
    answer: matched.map(({ quote }) => quote).join("\n\n"),
    coverage: "direct",
    usedChunkIds: [...new Set(matched.map(({ chunk }) => chunk.chunk_id))],
    supportAssessment: {
      requestedTarget: "배달 주문 누락",
      requirements: [{ kind: "method", support: "direct", evidence: matched.map(({ chunk, quote }) => ({
        chunkId: chunk.chunk_id, quote, role: "method", target: "배달 주문 누락", targetRelation: "same",
      })) }],
    },
  };
}

function buildStockProcurementAnswer(question: string, chunks: readonly ManualChunkMatch[]): StructuredAnswer | null {
  const asksWhetherStaffShouldOrder = /(?:내가|제가|직원(?:이|은|는)?|알바(?:가|는)?).{0,20}(?:주문|발주).{0,12}(?:해야|해도|하면|할까요)|(?:주문|발주).{0,12}(?:해야|해도|하면|할까요).{0,20}(?:내가|제가|직원|알바)/u.test(question);
  if (!/재고/u.test(question) || !asksWhetherStaffShouldOrder) return null;

  const policies = chunks.flatMap(chunk => {
    if (!/재고|발주/u.test(`${chunk.title} ${chunk.category}`)) return [];
    const lines = chunk.content.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
    const noOrder = lines.find(line => /직원.{0,50}(?:주문|발주).{0,50}(?:않|지\s*않|하지\s*말|안\s|금지)/u.test(line));
    const report = lines.find(line => /(?:점주|사장님|담당자|발주 담당자).{0,35}(?:보고|알리|알린|알려|문의)|품목.{0,35}(?:점주|사장님|담당자|발주 담당자).{0,20}(?:보고|알리|알린|알려|문의)/u.test(line));
    if (!noOrder || !report) return [];
    return [{ chunk, noOrder, report }];
  });
  if (!policies.length) return null;

  return {
    answerable: true,
    answer: "직원이 임의로 발주하지 말고, 부족한 품목을 점주 또는 담당자에게 보고하세요.",
    coverage: "direct",
    usedChunkIds: [...new Set(policies.map(item => item.chunk.chunk_id))],
    supportAssessment: {
      requestedTarget: "재고",
      requirements: [{ kind: "permission", support: "direct", evidence: policies.flatMap(({ chunk, noOrder, report }) => [
        { chunkId: chunk.chunk_id, quote: noOrder, role: "permission", target: "재고", targetRelation: "same" },
        { chunkId: chunk.chunk_id, quote: report, role: "referral_policy", target: "재고", targetRelation: "same" },
      ]) }],
    },
  };
}

export function buildManualReferenceAnswer(question: string, chunks: readonly ManualChunkMatch[], verifiedRecipeItem?: string): StructuredAnswer | null {
  const query = normalizeTargetText(question).replace(/[?？.!。！]+$/u, "").trim();
  const deliveryOmission = buildDeliveryOmissionAnswer(query, chunks);
  if (deliveryOmission) return deliveryOmission;
  const stockProcurement = buildStockProcurementAnswer(query, chunks);
  if (stockProcurement) return stockProcurement;
  if (verifiedRecipeItem) {
    const citations = chunks.flatMap(chunk => {
      const headings = [...chunk.content.matchAll(/^\s*(?:●\s*)?(?:HOT|ICE)\s+[^\r\n]+\s*$/gmu)];
      return headings.map((heading, index) => ({ chunkId: chunk.chunk_id,
        quote: chunk.content.slice(heading.index, headings[index + 1]?.index ?? chunk.content.length).trim() }));
    });
    const verified = extractVerifiedRecipeSourceFacts(question, chunks, citations);
    if (verified?.support.outcome === "full" && verified.sourceFacts?.length && verified.sourceFacts.every(fact => fact.source.citationQuote.length <= 1200)) {
      return { answerable: true, answer: renderVerifiedRecipeSourceFacts(verified.sourceFacts), coverage: "direct",
        usedChunkIds: [...new Set(verified.sourceFacts.map(fact => fact.source.chunkId))],
        supportAssessment: { requestedTarget: verifiedRecipeItem, requirements: [{ kind: "facts", support: "direct",
          evidence: verified.sourceFacts.map(fact => ({ chunkId: fact.source.chunkId, quote: fact.source.citationQuote,
            role: "facts", target: verifiedRecipeItem, targetRelation: "same" })) }] } };
    }
    return null;
  }
  const hours = compact(query).match(/^(평일|주말|공휴일)(?:의)?(?:운영|영업)시간(?:은|이)?(?:(?:알려줘|알려주세요|어떻게돼|몇시야|몇시인가요))?$/u);
  if (hours) {
    const rows = chunks.flatMap(chunk => chunk.content.split(/\r?\n/u).flatMap(line => {
      const row = line.match(/^\s*[-*]?\s*([^:：\n]+)[:：]\s*(\d{1,2}:\d{2}\s*[~～-]\s*\d{1,2}:\d{2})\s*$/u);
      return row && [hours[1] + "운영시간", hours[1] + "영업시간"].includes(compact(row[1]))
        ? [{ value: `${row[1].trim()}: ${row[2].trim()}`, chunkId: chunk.chunk_id }] : [];
    }));
    return uniqueAnswer(rows, "현재 제공된 운영시간 기준이 서로 달라요. 적용할 지점의 최신 운영시간을 담당자에게 확인해 주세요.");
  }

  const recipe = query.match(/^(.+?)(?:의)?\s*(?:레시피|제조법|제조\s*방법|만드는\s*법)(?:\s*(?:알려줘|알려주세요|알려\s*줘|알려\s*주세요|뭐야|어떻게\s*돼))?$/u);
  if (recipe) {
    const requested = menuIdentity(recipe[1].replace(/의$/u, "").trim());
    const selected = chunks.flatMap(chunk => {
      const headings = [...chunk.content.matchAll(/^\s*●\s*([^\r\n]{2,100})\s*$/gmu)];
      return headings.flatMap((heading, index) => {
        const identity = menuIdentity(heading[1]);
        if (identity.menu !== requested.menu || requested.mode && identity.mode !== requested.mode) return [];
        const value = chunk.content.slice(heading.index, headings[index + 1]?.index ?? chunk.content.length).trim();
        if (!/\d+(?:\.\d+)?\s*(?:ml|g|oz|℃|%|초|분|샷|개)/iu.test(value)) return [];
        return [{ value, chunkId: chunk.chunk_id, mode: identity.mode }];
      });
    });
    if (!selected.length) return null;
    const grouped = new Map<string | null, typeof selected>();
    for (const row of selected) grouped.set(row.mode, [...grouped.get(row.mode) ?? [], row]);
    const answers = [...grouped.values()].map(rows => uniqueAnswer(rows, "현재 제공된 같은 메뉴·온도의 레시피가 서로 달라요. 최신 적용 기준을 담당자에게 확인해 주세요."));
    if (answers.some(answer => answer?.coverage === "clarification")) return answers.find(answer => answer?.coverage === "clarification")!;
    return { answerable: true, answer: answers.map(answer => answer!.answer).join("\n\n"), coverage: "direct",
      usedChunkIds: [...new Set(selected.map(row => row.chunkId))] };
  }

  const cleaning = query.match(/^(.+?)(?:의)?\s*(?:세척법|세척\s*방법|청소법|청소\s*방법)(?:\s*(?:알려줘|알려주세요|알려\s*줘|알려\s*주세요))?$/u);
  if (!cleaning) return null;
  const target = compact(cleaning[1].replace(/의$/u, ""));
  const detailed = chunks.some(chunk => compact(chunk.title).includes(target) && /세척|청소/u.test(chunk.title)
    && /(?:^|\n)\s*(?:1[.)]|①)[\s\S]*(?:^|\n)\s*(?:2[.)]|②)/u.test(chunk.content));
  if (detailed) return null;
  const policies = chunks.filter(chunk => /장비|기기/u.test(chunk.title)).flatMap(chunk => chunk.content.split(/\r?\n/u).flatMap(line => {
    const row = line.match(/^\s*[-*]?\s*([^:：\n]+)[:：]\s*(\S.*)$/u);
    return row && compact(row[1]) === target && /등록된.*세척.*기준.*따른/u.test(row[2])
      ? [{ value: `${row[1].trim()}: ${row[2].trim()}`, chunkId: chunk.chunk_id }] : [];
  }));
  const policy = uniqueAnswer(policies, "현재 제공된 장비 관리 기준이 서로 달라요. 적용할 기준을 담당자에게 확인해 주세요.");
  if (!policy || policy.coverage === "clarification") return policy;
  return { ...policy, coverage: "policy_only", answer: `확인된 장비 관리 기준은 다음과 같습니다.\n${policy.answer}\n이 관리 항목에는 구체적인 세척 순서·세제 종류·사용량이 명시돼 있지 않습니다. 별도로 등록된 세척 방법을 담당자에게 확인해 주세요.` };
}