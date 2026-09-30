export type SignupProfileRole = "hq" | "owner" | "staff";

export interface SignupProfileRowInput {
  userId: string;
  email: string;
  fullName: string;
  role: SignupProfileRole;
  phone?: string | null;
  companyEmail?: string | null;
  brandId?: string | null;
  now?: Date;
}

/** /api/auth/signup이 만드는 마스터 profiles 행. 023 이후 user_id는 NOT NULL이며 id와 같은 auth 사용자를 가리킨다. */
export function buildSignupProfileRow(input: SignupProfileRowInput) {
  const isHq = input.role === "hq";

  return {
    id: input.userId,
    user_id: input.userId,
    email: input.email,
    full_name: input.fullName,
    role: input.role,
    phone: input.phone || null,
    company_email: input.companyEmail || null,
    brand_id: isHq ? input.brandId || null : null,
    approval_status: isHq ? "approved" : "pending",
    approved_at: isHq ? (input.now ?? new Date()).toISOString() : null,
  };
}
