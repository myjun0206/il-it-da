"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

type Feedback = { type: "success" | "error"; message: string } | null;
type PasswordStep = "closed" | "current" | "new";

const PASSWORD_MIN_LENGTH = 8;
const inputClass =
  "h-11 w-full rounded-lg border-2 border-[var(--color-border)] bg-white px-4 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30 disabled:opacity-60";
const buttonClass =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[var(--color-primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

function FeedbackMessage({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  const isSuccess = feedback.type === "success";
  const Icon = isSuccess ? CheckCircle2 : AlertCircle;
  return (
    <p role={isSuccess ? "status" : "alert"} className={`flex items-center gap-2 text-sm ${isSuccess ? "text-[var(--color-primary)]" : "text-red-700"}`}>
      <Icon size={16} aria-hidden="true" />
      {feedback.message}
    </p>
  );
}

export default function OwnerPasswordChangeForm() {
  const [step, setStep] = useState<PasswordStep>("closed");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const passwordsMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const resetForm = () => {
    setStep("closed");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setFeedback(null);
  };

  const handleVerifyCurrentPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isVerifying || !currentPassword) return;

    setIsVerifying(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/boss/verify-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword }),
      });
      const result = await response.json().catch(() => null) as {
        success?: boolean;
        message?: string;
      } | null;

      if (!response.ok || !result?.success) {
        setFeedback({ type: "error", message: result?.message || "현재 비밀번호를 확인하지 못했습니다." });
        return;
      }

      setStep("new");
      setFeedback({ type: "success", message: result.message || "현재 비밀번호를 확인했습니다." });
    } catch {
      setFeedback({ type: "error", message: "네트워크 오류가 발생했습니다. 연결을 확인한 뒤 다시 시도해주세요." });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setFeedback({ type: "error", message: `새 비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.` });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFeedback({ type: "error", message: "새 비밀번호와 확인 값이 일치하지 않습니다." });
      return;
    }
    if (currentPassword === newPassword) {
      setFeedback({ type: "error", message: "새 비밀번호는 현재 비밀번호와 달라야 합니다." });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/boss/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json().catch(() => null) as {
        success?: boolean;
        message?: string;
      } | null;

      if (!response.ok || !result?.success) {
        setFeedback({ type: "error", message: result?.message || "비밀번호를 변경하지 못했습니다. 다시 시도해주세요." });
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStep("closed");
      setFeedback({ type: "success", message: result.message || "비밀번호가 변경되었습니다." });
    } catch {
      setFeedback({ type: "error", message: "네트워크 오류가 발생했습니다. 연결을 확인한 뒤 다시 시도해주세요." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="owner-password-heading" className="mb-6 rounded-xl border border-[var(--color-border)] bg-white p-6 shadow-sm">
      <h2 id="owner-password-heading" className="text-xl font-bold text-[var(--color-text-primary)]">비밀번호 변경</h2>
      <p className="mt-1 mb-5 text-sm text-[var(--color-text-secondary)]">현재 비밀번호를 확인한 뒤 새 비밀번호로 변경합니다.</p>

      {step === "closed" && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              setFeedback(null);
              setStep("current");
            }}
            className={buttonClass}
          >
            비밀번호 변경하기
          </button>
          <FeedbackMessage feedback={feedback} />
        </div>
      )}

      {step === "current" && (
        <form onSubmit={handleVerifyCurrentPassword} noValidate className="max-w-xl space-y-4">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">현재 비밀번호를 입력하세요.</p>
          <div>
            <label htmlFor="owner-current-password" className="mb-2 block text-sm font-medium text-[var(--color-text-secondary)]">
              현재 비밀번호
            </label>
            <input
              id="owner-current-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              disabled={isVerifying}
              required
              className={inputClass}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={isVerifying || !currentPassword} className={buttonClass}>
              {isVerifying ? "확인 중..." : "확인"}
            </button>
            <button type="button" onClick={resetForm} disabled={isVerifying} className="min-h-[44px] rounded-lg border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] disabled:opacity-60">
              취소
            </button>
          </div>
          <FeedbackMessage feedback={feedback} />
        </form>
      )}

      {step === "new" && (
        <form onSubmit={handleChangePassword} noValidate className="max-w-xl space-y-4">
          <div>
            <label htmlFor="owner-new-password" className="mb-2 block text-sm font-medium text-[var(--color-text-secondary)]">
              새 비밀번호
            </label>
            <input
              id="owner-new-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
                setFeedback(null);
              }}
              disabled={isSubmitting}
              aria-describedby="owner-password-requirement"
              required
              className={inputClass}
            />
            <p id="owner-password-requirement" className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              {PASSWORD_MIN_LENGTH}자 이상 입력해주세요.
            </p>
          </div>

          <div>
            <label htmlFor="owner-confirm-password" className="mb-2 block text-sm font-medium text-[var(--color-text-secondary)]">
              비밀번호 확인
            </label>
            <input
              id="owner-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setFeedback(null);
              }}
              disabled={isSubmitting}
              aria-invalid={passwordsMismatch}
              aria-describedby={passwordsMismatch ? "owner-password-mismatch" : undefined}
              required
              className={`${inputClass} ${passwordsMismatch ? "border-red-500 focus:border-red-500 focus:ring-red-500/30" : ""}`}
            />
            {passwordsMismatch && (
              <p id="owner-password-mismatch" role="alert" className="mt-1 text-sm text-red-700">
                새 비밀번호와 확인 값이 일치하지 않습니다.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={isSubmitting || !newPassword || !confirmPassword || passwordsMismatch}
              className={buttonClass}
            >
              {isSubmitting ? "변경 중..." : "변경 완료"}
            </button>
            <button type="button" onClick={resetForm} disabled={isSubmitting} className="min-h-[44px] rounded-lg border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] disabled:opacity-60">
              취소
            </button>
          </div>
          <FeedbackMessage feedback={feedback} />
        </form>
      )}
    </section>
  );
}