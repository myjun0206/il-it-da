/**
 * Store Types
 */

export interface Store {
  id: string;
  brandId: string;
  brandName: string;
  franchiseId?: string;
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
  managerId?: string;
  phone?: string;
  createdAt: Date;
  manualCount: number;
  memberCount: number;
  status: "active" | "inactive";
}

export interface StoreMarker {
  storeId: string;
  name: string;
  latitude: number;
  longitude: number;
  selected?: boolean;
}

/** 본사 지점 관리(GET /api/hq/stores) 응답 항목 */
export interface HqStoreSummary {
  id: string;
  name: string;
  createdAt: string | null;
  ownerNames: string[];
  staffCount: number;
  manualCount: number;
}
