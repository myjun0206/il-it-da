/**
 * Store Types
 */

export interface Store {
  id: string;
  brandId: string;
  brandName: string;
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
