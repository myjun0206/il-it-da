/**
 * Approval Request Types
 */

import type { UserRole } from "./user";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
  requesterRole: UserRole;
  requesterPhone?: string;
  storeId: string;
  storeName: string;
  storeAddress?: string;
  brandName?: string;
  requestedAt: Date;
  status: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: Date;
  rejectionReason?: string;
}
