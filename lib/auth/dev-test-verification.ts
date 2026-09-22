// 서버 전용(route handler)에서만 import한다. 이 파일은 "use client" 컴포넌트에서 import하지 않는다.
// 다른 repo 파일을 import하지 않는 순수 모듈로 유지한다(허용 이메일 목록은 호출부에서 주입).

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isDevelopmentEnvironment(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === "development";
}

export function isAllowedDevTestEmail(email: string, allowedEmails: readonly string[]): boolean {
  const normalized = normalizeEmail(email);
  return allowedEmails.some((candidate) => normalizeEmail(candidate) === normalized);
}

/**
 * 세 조건(개발 환경 + 허용된 테스트 이메일)이 모두 참일 때만 true.
 * production에서는 nodeEnv가 "development"가 아니므로 항상 false.
 */
export function shouldIssueDevTestVerificationCode(
  email: string,
  allowedEmails: readonly string[],
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return isDevelopmentEnvironment(nodeEnv) && isAllowedDevTestEmail(email, allowedEmails);
}
