"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export default function OwnerAccountDeletionForm() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");

  const resetForm = () => {
    setIsOpen(false);
    setCurrentPassword("");
    setConfirmation("");
    setError("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isDeleting) return;
    if (confirmation !== "탈퇴") {
      setError("확인란에 '탈퇴'를 입력해주세요.");
      return;
    }

    setIsDeleting(true);
    setError("");
    try {
      const response = await fetch("/api/boss/delete-account", {
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
        setError(result?.message || "회원 탈퇴를 처리하지 못했습니다. 다시 시도해주세요.");
        return;
      }

      try {
        await createClient().auth.signOut({ scope: "local" });
      } catch {
        // The Auth account has already been deleted; still leave the settings page.
      }
      router.replace("/");
    } catch {
      setError("네트워크 오류가 발생했습니다. 계정 상태를 확인한 뒤 다시 시도해주세요.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="mt-6 border-t border-red-200 pt-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-red-800">점주 계정 탈퇴</h3>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            매장과 등록된 매뉴얼은 시스템 보존 계정으로 이전됩니다.
          </p>
        </div>
        {!isOpen && (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="inline-flex min-h-[44px] items-center justify-center self-start rounded-lg border-2 border-red-200 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 sm:self-auto"
          >
            회원 탈퇴
          </button>
        )}
      </div>

      {isOpen && (
        <form onSubmit={handleSubmit} noValidate className="mt-5 max-w-xl space-y-4">
          <p className="text-sm text-red-800">
            탈퇴 후에는 이 계정으로 매장과 매뉴얼을 관리할 수 없습니다. 본인 확인을 위해 현재 비밀번호와 확인 문구를 입력해주세요.
          </p>
          <div>
            <label htmlFor="owner-delete-password" className="mb-2 block text-sm font-medium text-[var(--color-text-secondary)]">
              현재 비밀번호
            </label>
            <input
              id="owner-delete-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              disabled={isDeleting}
              required
              className="h-11 w-full rounded-lg border-2 border-[var(--color-border)] bg-white px-4 text-base text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="owner-delete-confirmation" className="mb-2 block text-sm font-medium text-[var(--color-text-secondary)]">
              확인 문구: 탈퇴
            </label>
            <input
              id="owner-delete-confirmation"
              type="text"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={isDeleting}
              required
              className="h-11 w-full rounded-lg border-2 border-[var(--color-border)] bg-white px-4 text-base text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 disabled:opacity-60"
            />
          </div>
          {error && (
            <p role="alert" className="flex items-center gap-2 text-sm text-red-700">
              <AlertCircle size={16} aria-hidden="true" /> {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isDeleting || !currentPassword || confirmation !== "탈퇴"}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-red-700 px-4 text-sm font-medium text-white hover:bg-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDeleting ? "탈퇴 처리 중..." : "계정 삭제"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={isDeleting}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] disabled:opacity-60"
            >
              취소
            </button>
          </div>
        </form>
      )}
    </div>
  );
}