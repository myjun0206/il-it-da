/**
 * Mock data for HQ Admin Dashboard
 * 추후 실제 API로 교체 가능
 */

export interface DashboardStats {
  totalStores: number;
  openingSoon: number;
  pendingApprovals: number;
  unresolvedRequests: number;
}

export interface PendingTask {
  id: string;
  title: string;
  count: number;
}

export interface StoreStatus {
  id: string;
  name: string;
  status: "operating" | "opening_soon";
  inquiries: number;
}

export interface RecentNotice {
  id: string;
  title: string;
  target: "all" | "owner" | "staff";
  date: string;
}

export const mockDashboardStats: DashboardStats = {
  totalStores: 128,
  openingSoon: 4,
  pendingApprovals: 7,
  unresolvedRequests: 12,
};

export const mockPendingTasks: PendingTask[] = [
  {
    id: "task-1",
    title: "점주 가입 승인 요청",
    count: 3,
  },
  {
    id: "task-2",
    title: "신규 지점 연결 요청",
    count: 4,
  },
  {
    id: "task-3",
    title: "지점 문의 / 요청",
    count: 12,
  },
];

export const mockStoreStatus: StoreStatus[] = [
  {
    id: "store-1",
    name: "강남점",
    status: "operating",
    inquiries: 1,
  },
  {
    id: "store-2",
    name: "홍대점",
    status: "operating",
    inquiries: 0,
  },
  {
    id: "store-3",
    name: "성수점",
    status: "opening_soon",
    inquiries: 0,
  },
  {
    id: "store-4",
    name: "잠실점",
    status: "operating",
    inquiries: 2,
  },
];

export const mockRecentNotices: RecentNotice[] = [
  {
    id: "notice-1",
    title: "추석 연휴 매장 운영 안내",
    target: "all",
    date: "2026.09.16",
  },
  {
    id: "notice-2",
    title: "신메뉴 조리 매뉴얼 안내",
    target: "owner",
    date: "2026.09.14",
  },
  {
    id: "notice-3",
    title: "매장 위생 점검 일정 안내",
    target: "all",
    date: "2026.09.12",
  },
];

export interface HQAdminInfo {
  franchiseName: string;
  franchiseLogoUrl?: string;
  adminName?: string;
  adminRole: string;
}

export const mockHQAdminInfo: HQAdminInfo = {
  franchiseName: "메가MGC커피",
  franchiseLogoUrl: undefined, // 추후 실제 로고로 교체
  adminName: "본사 관리자",
  adminRole: "본사 관리자",
};
