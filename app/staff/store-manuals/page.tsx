import StaffManualBrowser from "@/components/staff/StaffManualBrowser";

// 직원 지점 매뉴얼: 현재 근무 매장(approved)의 매뉴얼만 조회/검색/상세 (읽기 전용)
export default function StaffStoreManualsPage() {
  return <StaffManualBrowser scope="store" />;
}
