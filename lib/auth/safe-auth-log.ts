// 고정 오류 코드와 안전한 error name만 남기고, message/details/payload/이메일/인증번호는 출력하지 않는다.
export function logSafeAuthError(code: string, error: unknown): void {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(`[AUTH] ${code}`, { name });
}
