import { isValidSignupEmail, normalizeSignupEmail, parseOwnerStaffRole, hasRequiredSignupTerms, validateOwnerStaffSignupProfile } from "@/lib/auth/owner-staff-signup";

export const DEFAULT_INCOMPLETE_SIGNUP_GRACE_HOURS = 24;

export function incompleteSignupGraceHours(value: unknown): number {
  if (value === undefined || value === "") return DEFAULT_INCOMPLETE_SIGNUP_GRACE_HOURS;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 1 || hours > 8760) throw new Error("INVALID_INCOMPLETE_SIGNUP_GRACE");
  return hours;
}

export type IncompleteSignupSnapshot = {
  user: { id: string; email?: string; created_at?: string; updated_at?: string; last_sign_in_at?: string | null;
    deleted_at?: string | null; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown>;
    identities?: Array<{ provider?: string }> };
  flow: { email: string; role: string; requested_at: string; available_at: string; expires_at: string;
    sent_at?: string | null; verified_at?: string | null; verified_user_id?: string | null;
    completed_at?: string | null; completed_user_id?: string | null; request_id: string } | null;
  profileCount: number | null;
  membershipCount: number | null;
};

export function previewIncompleteSignupCleanup(snapshot: IncompleteSignupSnapshot, options: { now: number; graceHours: number }) {
  const { user, flow } = snapshot;
  const reasons: string[] = [];
  const email = normalizeSignupEmail(user.email);
  const metadata = user.user_metadata ?? {};
  const role = parseOwnerStaffRole(metadata.role);
  if (!isValidSignupEmail(email) || !role || metadata.signup_flow !== "email_first") reasons.push("not_explicit_email_signup");
  if (user.deleted_at || user.app_metadata?.provider !== "email" ||
      !Array.isArray(user.identities) || !user.identities.length || user.identities.some(identity => identity.provider !== "email") ||
      (Array.isArray(user.app_metadata?.providers) && user.app_metadata.providers.some(provider => provider !== "email"))) reasons.push("social_or_unknown_identity");
  if (!flow || normalizeSignupEmail(flow.email) !== email || flow.role !== role || !flow.request_id) reasons.push("missing_or_mismatched_flow");
  if (flow?.completed_at || flow?.completed_user_id) reasons.push("completion_record_present");
  if (flow?.verified_user_id && flow.verified_user_id !== user.id) reasons.push("foreign_verified_identity");
  if (role && hasRequiredSignupTerms(metadata.signupTerms, role) &&
      !Object.keys(validateOwnerStaffSignupProfile({ name: metadata.name, phone: metadata.phone })).length) reasons.push("final_metadata_present_review");
  if (snapshot.profileCount !== 0) reasons.push("profile_present_or_unknown");
  if (snapshot.membershipCount !== 0) reasons.push("membership_present_or_unknown");
  const timestamps = [user.created_at, user.updated_at, user.last_sign_in_at,
    flow?.requested_at, flow?.sent_at, flow?.verified_at].filter(value => value != null);
  const parsed = timestamps.map(value => Date.parse(value as string));
  if (!user.created_at || !user.updated_at || !flow?.requested_at || parsed.some(value => !Number.isFinite(value))) reasons.push("unknown_progress_time");
  const availableAt = Date.parse(flow?.available_at ?? "");
  const expiresAt = Date.parse(flow?.expires_at ?? "");
  if (!Number.isFinite(availableAt) || !Number.isFinite(expiresAt) || Math.max(availableAt, expiresAt) > options.now) reasons.push("active_or_unknown_request");
  const lastProgress = parsed.length ? Math.max(...parsed) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(options.now) || !Number.isFinite(options.graceHours) || options.graceHours < 1 ||
      options.now - lastProgress < options.graceHours * 3600000) reasons.push("within_grace_or_active");
  return { eligible: reasons.length === 0, reasons, graceHours: options.graceHours };
}