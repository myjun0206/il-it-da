/**
 * User Types
 */

export type UserRole = "hq" | "owner" | "staff";

export type UserStatus = "active" | "pending" | "rejected" | "suspended";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone?: string;
  profileImage?: string;
  createdAt: Date;
  status: UserStatus;
  companyEmail?: string; // HQ only
  brandId?: string;      // HQ only
}

export interface UserStoreRelation {
  userId: string;
  storeId: string;
  role: UserRole;
  status: "active" | "pending" | "rejected";
  joinedAt: Date;
  approvedAt?: Date;
  approvedBy?: string;
}
