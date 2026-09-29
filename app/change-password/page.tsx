"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/common/Button";
import { PasswordInput } from "@/components/common/Input";
import { createClient } from "@/lib/supabase/client";

const PASSWORD_MIN_LENGTH = 8;

export default function ChangePasswordPage() {
  const router = useRouter();
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    let isActive = true;

    const checkAccess = async () => {
      try {
        const { data, error: userError } = await createClient().auth.getUser();
        if (!isActive) return;

        if (userError || !data.user) {
          router.replace("/");
          return;
        }

        if (data.user.app_metadata?.must_change_password !== true) {
          router.replace("/");
          return;
        }

        setHasAccess(true);
        setIsCheckingSession(false);
      } catch {
        if (isActive) router.replace("/");
      }
    };

    void checkAccess();

    return () => {
      isActive = false;
    };
  }, [router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || isComplete) return;

    if (!newPassword) {
      setError("새 비밀번호를 입력해주세요.");
      return;
    }
    if (!confirmPassword) {
      setError("새 비밀번호를 다시 입력해주세요.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(`비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`);
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const result: { success?: boolean; message?: string } = await response.json();

      if (!response.ok || !result.success) {
        if (response.status === 401) {
          router.replace("/");
          return;
        }
        setError(result.message || "비밀번호 변경에 실패했습니다. 다시 시도해주세요.");
        return;
      }

      setIsComplete(true);
      window.setTimeout(() => router.replace("/"), 900);
    } catch {
      setError("비밀번호 변경에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingSession || !hasAccess) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--color-bg-default)] px-5">
        <p className="text-sm text-[var(--color-text-secondary)]">계정을 확인하고 있습니다...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--color-bg-default)] px-5 py-12">
      <section className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-sm sm:p-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">비밀번호 변경</h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            임시 비밀번호로 로그인했습니다. 계속하려면 새로운 비밀번호를 설정해주세요.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <PasswordInput
            label="새 비밀번호"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
              setError("");
            }}
            className="h-[56px]"
          />
          <PasswordInput
            label="새 비밀번호 확인"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              setError("");
            }}
            className="h-[56px]"
          />
          <p className="text-sm text-[var(--color-text-tertiary)]">
            비밀번호는 {PASSWORD_MIN_LENGTH}자 이상이어야 합니다.
          </p>

          {error && (
            <p role="alert" className="text-sm text-[var(--color-status-error)]">
              {error}
            </p>
          )}
          {isComplete && (
            <p role="status" className="text-sm text-[var(--color-primary)]">
              비밀번호가 변경되었습니다.
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            isLoading={isSubmitting}
            disabled={isSubmitting || isComplete}
            className="w-full"
          >
            비밀번호 변경
          </Button>
        </form>
      </section>
    </main>
  );
}