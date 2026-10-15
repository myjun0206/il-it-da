import type { ManualChunkMatch } from "@/lib/rag/types";

const compact = (text: string) => text.normalize("NFC").replace(/\s+/gu, "").trim();
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export function buildRecipeOptionQuantityAnswer(question: string, chunks: readonly ManualChunkMatch[]) {
  const query = compact(question);
  const options: { label: string; value: string; chunkId: string }[] = [];
  for (const chunk of chunks) {
    let optionCriteria = false;
    for (const line of chunk.content.split(/\r?\n/u)) {
      if (/^\s*(?:기본\s*)?옵션\s*기준\s*[:：]\s*$/u.test(line)) { optionCriteria = true; continue; }
      if (!optionCriteria || !line.trim()) continue;
      const row = line.match(/^\s*[-*]\s*([^:：\n]{2,80})\s*[:：]\s*(\S[^\n]{0,160})\s*$/u);
      if (!row) { optionCriteria = false; continue; }
      const label = row[1].trim();
      const value = row[2].trim();
      if (!/\s추가$/u.test(label)) continue;
      const shot = value.match(/^([가-힣A-Za-z]+(?:\s+[가-힣A-Za-z]+)*)\s+(\d+)\s*샷\s*\(\s*(?:약\s*)?\d+(?:\.\d+)?\s*ml\s*\)$/iu);
      const volume = /^(?:약\s*)?\d+(?:\.\d+)?\s*ml$/iu.test(value);
      if (!shot && !volume) continue;
      const ingredient = shot?.[1] ?? label.replace(/\s추가$/u, "");
      const labelPattern = label.split(/\s+/u).map(escapePattern).join("(?:을|를)?");
      const targetPattern = escapePattern(compact(ingredient));
      const pattern = new RegExp(`^${labelPattern}(?:시|할때|하면)?(?:${targetPattern}(?:은|는|을|를)?)?(?:몇(?:ml|밀리리터)(?:를)?|얼마나|얼마|정량(?:은|는)?)(?:추가(?:하나요|하면되나요|해요|해야해)|넣(?:으면(?:돼|되나요|되죠)|어야(?:돼|하나요)|나요|어)|야|인가요|예요|이에요|알려줘|알려주세요)?[?？.!]*$`, "iu");
      if (pattern.test(query)) options.push({ label, value, chunkId: chunk.chunk_id });
    }
  }
  if (!options.length) return null;
  const usedChunkIds = [...new Set(options.map(option => option.chunkId))];
  if (new Set(options.map(option => `${compact(option.label)}:${compact(option.value)}`)).size !== 1) {
    return { answerable: true, answer: "현재 제공된 옵션 기준에 서로 다른 수량이 있어요. 적용할 기준을 매장 관리자에게 확인해 주세요.",
      usedChunkIds, coverage: "clarification" as const };
  }
  return { answerable: true, answer: `${options[0].label}: ${options[0].value}`, usedChunkIds, coverage: "direct" as const };
}