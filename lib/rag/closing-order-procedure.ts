import { isClosingOrderDecisionQuestion, type StructuredAnswer } from "@/lib/rag/structured-answer";
import type { ManualChunkMatch } from "@/lib/rag/types";

export function buildClosingOrderProcedureAnswer(
  question: string,
  chunks: readonly ManualChunkMatch[],
): StructuredAnswer | null {
  if (!isClosingOrderDecisionQuestion(question)) return null;

  const instructions = chunks.flatMap(chunk => chunk.content.split(/\r?\n/u)
    .map(line => ({ chunk, line: line.trim() }))
    .filter(({ line }) => /(?:마감시간|영업\s*종료\s*시간).*(?:마지막\s*주문|추가\s*주문)/u.test(line)
      && /POS.{0,30}주문\s*상태.{0,20}확인/u.test(line)
      && /애매.{0,20}(?:담당자|사장님).{0,15}확인/u.test(line)));
  const unique = new Map(instructions.map(item => [`${item.chunk.chunk_id}\n${item.line}`, item]));
  const values = [...unique.values()];
  const uniqueInstructions = new Set(values.map(item => item.line.replace(/\s+/gu, " ")));
  if (!values.length || uniqueInstructions.size !== 1) return null;
  return {
    answerable: true,
    answer: values[0].line.replace(/^[-*]\s*/u, ""),
    coverage: "direct",
    usedChunkIds: [...new Set(values.map(item => item.chunk.chunk_id))],
    supportAssessment: {
      requestedTarget: "주문",
      requirements: [{
        kind: "procedure",
        support: "direct",
        evidence: values.map(item => ({
          chunkId: item.chunk.chunk_id,
          quote: item.line,
          role: "procedure",
          target: "주문",
          targetRelation: "same",
        })),
      }],
    },
  };
}
