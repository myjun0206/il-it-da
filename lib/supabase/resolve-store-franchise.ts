import type { SupabaseClient } from "@supabase/supabase-js";

type FranchiseCandidate = { id: string; name: string | null };

export function normalizeStoreFranchiseName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function fuzzyPrefixScore(storeName: string, franchiseName: string): number {
  if (franchiseName.length < 3) return 0;

  const minimumLength = Math.max(2, franchiseName.length - 2);
  const maximumLength = Math.min(storeName.length, franchiseName.length + 2);
  let bestScore = 0;

  for (let length = minimumLength; length <= maximumLength; length += 1) {
    const prefix = storeName.slice(0, length);
    const distance = levenshteinDistance(prefix, franchiseName);
    const similarity = 1 - distance / Math.max(prefix.length, franchiseName.length);
    bestScore = Math.max(bestScore, similarity);
  }

  return bestScore;
}

/**
 * 매장명과 프랜차이즈명을 정규화해 정확한 접두어를 우선 매칭한다.
 * 정확히 맞지 않는 경우에도 충분히 높은 단일 유사 후보만 반환하며,
 * 모호한 후보는 임의 연결하지 않고 null을 반환해 수동 선택을 유도한다.
 */
export async function resolveFranchiseIdForStoreName(
  supabase: SupabaseClient,
  storeName: string,
): Promise<string | null> {
  const normalizedStoreName = normalizeStoreFranchiseName(storeName);

  if (!normalizedStoreName) {
    return null;
  }

  const { data: franchises, error } = await supabase
    .from("franchises")
    .select("id, name");

  if (error || !franchises) {
    return null;
  }

  const candidates = (franchises as FranchiseCandidate[])
    .map((franchise) => ({
      ...franchise,
      normalizedName: franchise.name ? normalizeStoreFranchiseName(franchise.name) : "",
    }))
    .filter((franchise) => franchise.normalizedName.length > 0);

  const exactMatches = candidates
    .filter((franchise) => normalizedStoreName.startsWith(franchise.normalizedName))
    .sort((a, b) => b.normalizedName.length - a.normalizedName.length);

  if (exactMatches[0]) {
    return exactMatches[0].id;
  }

  const fuzzyMatches = candidates
    .map((franchise) => ({
      ...franchise,
      score: fuzzyPrefixScore(normalizedStoreName, franchise.normalizedName),
    }))
    .filter((franchise) => franchise.score >= 0.78)
    .sort((a, b) => b.score - a.score || b.normalizedName.length - a.normalizedName.length);

  const bestMatch = fuzzyMatches[0];
  const secondBestScore = fuzzyMatches[1]?.score ?? 0;
  if (!bestMatch || (fuzzyMatches[1] && bestMatch.score - secondBestScore < 0.08)) {
    return null;
  }

  return bestMatch.id;
}
