import { NextRequest, NextResponse } from "next/server";

interface NaverSearchResult {
  title: string;
  address: string;
  roadAddress: string;
  category: string;
  lat: string;
  lng: string;
  link?: string;
}

interface NormalizedStore {
  id: string;
  name: string;
  address: string;
  roadAddress: string;
  category?: string;
  lat: number;
  lng: number;
}

// HTML 태그 제거
function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

// ID 생성 (이름 + 주소 + 좌표 기반)
function generateId(result: NaverSearchResult): string {
  const cleaned = stripHtmlTags(result.title);
  const addr = result.roadAddress || result.address;
  return `${cleaned}|${addr}|${result.lat}|${result.lng}`.replace(/\s+/g, "_");
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q");

  // 검증
  if (!query || query.trim().length === 0) {
    return NextResponse.json({ results: [] });
  }

  if (query.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  const clientId = process.env.NAVER_SEARCH_CLIENT_ID;
  const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[StoresSearch] Missing NAVER API credentials");
    return NextResponse.json(
      { error: "API 설정 오류" },
      { status: 500 }
    );
  }

  try {
    // NAVER API HUB - 지역 검색 (공식 명세 기준)
    // https://naverapihub.apigw.ntruss.com/search/v1/local
    const baseUrl = "https://naverapihub.apigw.ntruss.com";
    const apiPath = "/search/v1/local";
    const url = new URL(baseUrl + apiPath);
    url.searchParams.set("query", query);
    url.searchParams.set("display", "5");
    url.searchParams.set("start", "1");
    url.searchParams.set("sort", "random");
    url.searchParams.set("format", "json");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-NCP-APIGW-API-KEY-ID": clientId,
        "X-NCP-APIGW-API-KEY": clientSecret,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[StoresSearch] API Error: ${response.status} - ${text.substring(0, 200)}`
      );
      return NextResponse.json(
        { error: "검색 실패" },
        { status: response.status }
      );
    }

    const data = await response.json();

    // 응답 정규화
    const results: NormalizedStore[] = (data.items || [])
      .map((item: any) => {
        try {
          const title = stripHtmlTags(item.title || "");
          // NAVER Local Search API는 NAVER 좌표계(단위: 1/10,000,000)를 반환
          // WGS84로 변환: 값을 10,000,000으로 나눔
          const lat = parseFloat(item.mapy) / 10000000;
          const lng = parseFloat(item.mapx) / 10000000;

          // 좌표 검증 (WGS84 범위)
          if (isNaN(lat) || isNaN(lng)) {
            return null;
          }
          if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            console.warn(`[StoresSearch] Invalid coordinates: lat=${lat}, lng=${lng}`);
            return null;
          }

          return {
            id: generateId({
              title: item.title,
              address: item.address || "",
              roadAddress: item.roadAddress || "",
              category: item.category || "",
              lat: lat.toString(),
              lng: lng.toString(),
            }),
            name: title,
            address: item.address || "",
            roadAddress: item.roadAddress || "",
            category: item.category || undefined,
            lat,
            lng,
          };
        } catch (err) {
          console.warn("[StoresSearch] Failed to parse item:", item, err);
          return null;
        }
      })
      .filter(Boolean);

    // 중복 제거
    const uniqueResults = Array.from(
      new Map(results.map((r) => [r.id, r])).values()
    );

    return NextResponse.json({ results: uniqueResults.slice(0, 5) });
  } catch (error) {
    console.error("[StoresSearch] Error:", error);
    return NextResponse.json(
      { error: "검색 중 오류 발생" },
      { status: 500 }
    );
  }
}
