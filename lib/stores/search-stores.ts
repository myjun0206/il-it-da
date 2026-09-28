import type { Store } from "@/lib/types/store";

// /api/stores/search 응답 한 건 (NAVER 지역 검색 결과를 서버에서 정리한 형태)
interface ApiStore {
  id: string;
  name: string;
  address: string;
  roadAddress: string;
  category?: string;
  lat: number;
  lng: number;
}

/**
 * 매장 검색 공통 호출. 회원가입 매장 검색(StoreSearchDropdown)과 직원 근무 매장 추가 화면이 함께 쓴다.
 * 실패하면 예외를 던지고, AbortSignal로 취소할 수 있다.
 */
export async function searchStores(query: string, signal?: AbortSignal): Promise<Store[]> {
  const response = await fetch(`/api/stores/search?q=${encodeURIComponent(query)}`, { signal });

  if (!response.ok) {
    throw new Error("검색 실패");
  }

  const data = (await response.json()) as { results?: ApiStore[] };
  return (data.results ?? []).map((result) => ({
    id: result.id,
    brandId: `brand_${result.id}`, // 임시 brandId
    brandName: result.name.split(" ")[0] || result.name, // 첫 단어를 브랜드명으로
    name: result.name,
    address: result.address,
    latitude: result.lat,
    longitude: result.lng,
    status: "active" as const,
    createdAt: new Date(),
    manualCount: 0,
    memberCount: 0,
  }));
}

/**
 * 화면 표시용 매장명. 검색 결과에 브랜드명이 연달아 중복된 경우("메가MGC커피 메가MGC커피 명동입구점")만
 * 한 번으로 줄인다. 신청/식별에는 항상 원본 name을 그대로 사용한다.
 */
export function formatStoreDisplayName(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length > 1 && words[0] === words[1]) {
    return words.slice(1).join(" ");
  }
  return name.trim();
}
