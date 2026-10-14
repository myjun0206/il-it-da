import { normalizeTargetText, sameDeclaredSourceTarget, type StructuredAnswer } from "@/lib/rag/structured-answer";
import type { ManualChunkMatch } from "@/lib/rag/types";

type LocationReference = { id: string; target: string; requestedTarget: string; location: string; quote: string; chunkId: string };

export function buildLocationReferenceAnswer(question: string, chunks: readonly ManualChunkMatch[]): StructuredAnswer | null {
  const normalizedQuestion = normalizeTargetText(question).replace(/[?？.!。！]+$/u, "").trim();
  const compoundQuestionTarget = normalizedQuestion.match(/^(.+?)(?:\s+(?:재고|비품|소모품))?\s+(?:어디|어느(?:\s*곳|\s*위치))/u)?.[1]?.trim();
  const references: LocationReference[] = [];
  for (const chunk of chunks) {
    if (!/위치/u.test(chunk.title)) continue;
    chunk.content.split(/\r?\n/u).forEach((line, index) => {
      const row = line.match(/^\s*[-*]?\s*([^:：\n]{1,200})[:：]\s*(\S.*)$/u);
      if (!row) return;
      const target = normalizeTargetText(row[1]);
      const requestedTarget = normalizedQuestion.startsWith(target) ? target : compoundQuestionTarget;
      if (!requestedTarget || !sameDeclaredSourceTarget(requestedTarget, target, line.trim())) return;
      const rest = normalizedQuestion.slice(requestedTarget.length);
      const direct = /^(?:은|는|이|가)?\s*(?:재고\s*)?어디(?:에|에서)?\s*(?:보관(?:하나요|해요|하죠|합니까|해야\s*하나요)|있(?:나요|어요|어|습니까)|두(?:나요|어요|어|죠)|둬(?:요)?|놓(?:나요|아요)|찾(?:나요|아요)|배치(?:하나요|합니까))$/u.test(rest);
      const scoped = rest.match(/^(?:은|는|이|가)?\s*([^\s?？.!]{2,40})\s+어디(?:에)?\s*(?:칸|선반|자리)(?:임|이야|인가요|야)$/u);
      if (!direct && !(scoped && normalizeTargetText(row[2]).includes(scoped[1]))) return;
      references.push({ id: `${chunk.chunk_id}:${index}`, target, requestedTarget,
        location: row[2].trim(), quote: line.trim(), chunkId: chunk.chunk_id });
    });
  }
  if (!references.length) return null;
  const targets = new Set(references.map(reference => reference.target));
  const locations = new Set(references.map(reference => normalizeTargetText(reference.location)));
  if (targets.size !== 1) return null;
  if (locations.size !== 1) return { answerable: false, coverage: "clarification", usedChunkIds: [],
    answer: "승인된 근거에 서로 다른 위치가 있어 현재 위치를 확정할 수 없습니다. 매장 관리자에게 확인해 주세요." };
  const selected = references[0];
  return { answerable: true, answer: `${selected.target}의 보관 위치는 ${selected.location}입니다.`, coverage: "direct", usedChunkIds: [selected.chunkId],
    supportAssessment: { requestedTarget: selected.requestedTarget, requirements: [{ kind: "location", support: "direct", evidence: [
      { chunkId: selected.chunkId, quote: selected.quote, role: "location", target: selected.target, targetRelation: "same" },
    ] }] } };
}