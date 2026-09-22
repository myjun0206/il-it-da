/**
 * Mock Franchise Data
 * 개발 환경에서만 사용되는 테스트용 본사 데이터
 * production에서는 실제 API에서 조회됨
 */

export interface MockFranchise {
  id: string;
  name: string;
  domain: string;
  logo?: string | null; // 실제 로고가 없으면 null
}

export const mockFranchises: MockFranchise[] = [
  {
    id: "franchise-mega",
    name: "메가MGC커피",
    domain: "megamgc.com",
    logo: null,
  },
  {
    id: "franchise-burgerking",
    name: "버거킹",
    domain: "burgerking.com",
    logo: null,
  },
  {
    id: "franchise-kyochon",
    name: "교촌치킨",
    domain: "kyochon.com",
    logo: null, // 실제 로고 asset이 없으면 null 유지
  },
  {
    id: "franchise-bhc",
    name: "BHC 치킨",
    domain: "bhc.com",
    logo: null,
  },
  {
    id: "franchise-nene",
    name: "네네치킨",
    domain: "nene.com",
    logo: null,
  },
  {
    id: "franchise-companion",
    name: "Companion Group",
    domain: "companiongroup.com",
    logo: null,
  },
];

/**
 * 도메인으로 프랜차이즈 찾기
 * @param domain 이메일 도메인 (예: "kyochon.com")
 * @returns 프랜차이즈 정보 또는 undefined
 */
export function getFranchiseByDomain(
  domain: string
): MockFranchise | undefined {
  return mockFranchises.find(
    (f) => f.domain.toLowerCase() === domain.toLowerCase()
  );
}

/**
 * 개발 환경 테스트용 이메일 목록
 * development 환경에서만 이 이메일들이 테스트 인증을 통과함
 * 메가MGC커피 테스트 계정 3개 + 버거킹 테스트 계정 3개
 */
export const DEV_TEST_EMAILS = [
  // 메가MGC커피 테스트 계정
  "hq@ilitda.test",
  "boss@ilitda.test",
  "staff@ilitda.test",
  // 버거킹 테스트 계정
  "bk.hq@ilitda.test",
  "bk.boss@ilitda.test",
  "bk.staff@ilitda.test",
  // 기타 테스트
  "hq.signup.test01@gmail.com",
  "admin@kyochon.com",
  "admin@bhc.com",
  "admin@nene.com",
  "admin@companiongroup.com",
  "test@kyochon.com",
  "test@bhc.com",
];

/**
 * 개발 환경 테스트용 인증번호
 * development 환경에서만 사용됨
 */
export const DEV_TEST_VERIFICATION_CODE = "123456";

/**
 * 개발 환경 테스트용 이메일 → 프랜차이즈 매핑 (키는 정규화된 소문자 이메일)
 * 테스트 계정에 대해서만 특정 브랜드로 인식되도록 설정
 * production에서는 사용되지 않음
 */
export const DEV_TEST_EMAIL_FRANCHISE_MAP: Record<string, { name: string; id: string }> = {
  // 메가MGC커피 테스트 계정
  "hq@ilitda.test": { name: "메가MGC커피", id: "brand_mega" },
  "boss@ilitda.test": { name: "메가MGC커피", id: "brand_mega" },
  "staff@ilitda.test": { name: "메가MGC커피", id: "brand_mega" },
  // 버거킹 테스트 계정
  "bk.hq@ilitda.test": { name: "버거킹", id: "brand_burgerking" },
  "bk.boss@ilitda.test": { name: "버거킹", id: "brand_burgerking" },
  "bk.staff@ilitda.test": { name: "버거킹", id: "brand_burgerking" },
  // 기존 테스트
  "hq.signup.test01@gmail.com": { name: "메가MGC커피", id: "brand_mega" },
};

/**
 * 개발 환경 테스트용 이메일 → role 매핑
 * 테스트 계정은 고정된 role을 가지므로, 회원가입 시 role 검증용
 * production에서는 사용되지 않음
 *
 * 메가MGC커피 + 버거킹 총 6개 DEV 테스트 계정
 */
export const DEV_TEST_EMAIL_ROLE_MAP: Record<string, "hq" | "owner" | "staff"> = {
  // 메가MGC커피 테스트 계정
  "hq@ilitda.test": "hq",
  "boss@ilitda.test": "owner",
  "staff@ilitda.test": "staff",
  // 버거킹 테스트 계정
  "bk.hq@ilitda.test": "hq",
  "bk.boss@ilitda.test": "owner",
  "bk.staff@ilitda.test": "staff",
};

/**
 * 개발 환경 테스트용 계정 비밀번호
 * 모든 테스트 계정이 동일한 비밀번호를 사용
 * production에서는 사용되지 않음
 */
export const DEV_TEST_PASSWORD = "Ilitda!2026Test";
