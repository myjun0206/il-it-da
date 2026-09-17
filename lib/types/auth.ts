/**
 * Authentication Types
 */

import type { User, UserRole } from "./user";

export type LoginResponse = {
  user: User;
  token: string;
};

export type SignupStep = 1 | 2 | 3 | 4 | 5 | 6;

export interface SignupFormData {
  step: SignupStep;
  role?: UserRole;
  email?: string;
  password?: string;
  passwordConfirm?: string;
  name?: string;
  phone?: string;
  companyEmail?: string; // HQ only
  selectedBrandId?: string; // HQ only
  selectedStoreIds?: string[]; // Owner/Staff
  termsAgree?: boolean;
  privacyAgree?: boolean;
}

export type SignupProgress = "in-progress" | "pending-approval" | "completed" | "rejected";
