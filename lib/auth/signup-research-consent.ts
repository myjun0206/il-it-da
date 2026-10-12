export const RESEARCH_CONSENT_KEY = "signupResearchConsent";
export const RESEARCH_CONSENT_VERSION = "research-invitation-review-v1";
export const RESEARCH_CONSENT_TITLE = "서비스 개선을 위한 선택 설문·인터뷰 참여 안내 수신 동의";

export function acceptsResearchInvitations(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).accepted === true;
}

export function createResearchConsent(value: unknown, now = new Date()) {
  return {
    accepted: value === true,
    documentVersion: RESEARCH_CONSENT_VERSION,
    recordedAt: now.toISOString(),
  };
}

export function requiredSignupConsent(value: unknown) {
  const terms = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  return {
    service: terms.service === true,
    privacy: terms.privacy === true,
    store_connection: terms.store_connection === true,
    store_work: terms.store_work === true,
  };
}