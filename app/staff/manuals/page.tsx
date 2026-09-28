import StaffManualBrowser from "@/components/staff/StaffManualBrowser";

// 직원 공통 매뉴얼: 본사 공통 매뉴얼 조회/검색/상세 (읽기 전용)
export default function StaffCommonManualsPage() {
  return <StaffManualBrowser scope="common" />;
}
