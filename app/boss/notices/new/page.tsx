"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft } from "lucide-react";

import OwnerHeader from "@/components/owner/OwnerHeader";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import { resolveOwnerCurrentStore, type OwnerStore } from "@/lib/owner/current-store";
import { createClient } from "@/lib/supabase/client";

const NOTICE_LIST_HREF = "/boss/notices";
const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 5000;

const fieldClass =
  "w-full rounded-lg border-2 border-[var(--color-border)] bg-white px-4 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30";

export default function NewOwnerNoticePage() {
  const router = useRouter();
  const [userName, setUserName] = useState("점주");
  const [currentStore, setCurrentStore] = useState<OwnerStore | null>(null);
  const [isLoadingStore, setIsLoadingStore] = useState(true);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.push("/");
        return;
      }

      const displayName = data.user.user_metadata?.name;
      if (typeof displayName === "string" && !isCancelled) {
        setUserName(displayName);
      }

      const resolution = await resolveOwnerCurrentStore();
      if (isCancelled) return;
      if (resolution.status === "error") {
        setErrorMessage("매장 정보를 불러오지 못했습니다.");
      } else if (!resolution.current) {
        setErrorMessage("공지할 수 있는 승인된 매장이 없습니다.");
      } else {
        setCurrentStore(resolution.current);
      }
      setIsLoadingStore(false);
    })();

    return () => {
      isCancelled = true;
    };
  }, [router]);

  const handleLogout = async () => {
    try {
      await createClient().auth.signOut();
    } finally {
      router.push("/");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || !currentStore) return;

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle || !trimmedContent) {
      setErrorMessage("제목과 내용을 입력해주세요.");
      return;
    }

    setErrorMessage("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/boss/notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          storeId: currentStore.storeId,
          title: trimmedTitle,
          content: trimmedContent,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || "직원 공지를 등록하지 못했습니다.");
      }
      router.push(NOTICE_LIST_HREF);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "직원 공지를 등록하지 못했습니다.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex">
      <OwnerSidebar activeMenu="notice" onLogout={handleLogout} />

      <div className="flex-1 flex flex-col lg:ml-[240px]">
        <OwnerHeader userName={userName} storeName={currentStore?.storeName ?? ""} onLogout={handleLogout} />

        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="mx-auto max-w-4xl">
            <Link
              href={NOTICE_LIST_HREF}
              aria-label="공지사항 목록으로 돌아가기"
              className="-ml-3 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-light)]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <ArrowLeft size={16} aria-hidden="true" /> 공지사항
            </Link>

            <div className="mb-8">
              <h1 className="mb-2 text-2xl font-bold text-[var(--color-text-primary)]">직원 공지 작성</h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                현재 매장의 승인된 직원에게만 전달됩니다.
              </p>
            </div>

            {isLoadingStore ? (
              <div className="rounded-lg border border-[var(--color-border)] bg-white p-8 text-center">
                <p className="text-sm text-[var(--color-text-secondary)]" role="status">현재 매장을 확인하는 중...</p>
              </div>
            ) : (
              <form
                onSubmit={handleSubmit}
                noValidate
                className="w-full rounded-lg border border-[var(--color-border)] bg-white p-6 shadow-sm lg:p-8"
              >
                {currentStore && (
                  <div className="mb-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-default)] p-4">
                    <p className="mb-1 text-sm font-semibold text-[var(--color-text-secondary)]">현재 매장</p>
                    <p className="text-base font-semibold text-[var(--color-text-primary)]">{currentStore.storeName}</p>
                  </div>
                )}

                <div>
                  <label htmlFor="owner-notice-title" className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
                    제목 <span className="text-red-700" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="owner-notice-title"
                    type="text"
                    value={title}
                    maxLength={TITLE_MAX_LENGTH}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="공지 제목을 입력해주세요."
                    aria-required="true"
                    className={`${fieldClass} h-11`}
                    disabled={!currentStore}
                  />
                  <p className="mt-1 text-right text-sm text-[var(--color-text-tertiary)]">
                    {title.length} / {TITLE_MAX_LENGTH}
                  </p>
                </div>

                <div className="mt-4">
                  <label htmlFor="owner-notice-content" className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
                    내용 <span className="text-red-700" aria-hidden="true">*</span>
                  </label>
                  <textarea
                    id="owner-notice-content"
                    value={content}
                    maxLength={CONTENT_MAX_LENGTH}
                    onChange={(event) => setContent(event.target.value)}
                    placeholder="직원에게 전달할 공지 내용을 입력해주세요."
                    aria-required="true"
                    className={`${fieldClass} h-60 resize-y py-3 leading-6`}
                    disabled={!currentStore}
                  />
                  <p className="mt-1 text-right text-sm text-[var(--color-text-tertiary)]">
                    {content.length} / {CONTENT_MAX_LENGTH}
                  </p>
                </div>

                {errorMessage && (
                  <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
                    <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-700" aria-hidden="true" />
                    <p className="text-sm text-red-700">{errorMessage}</p>
                  </div>
                )}

                <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] pt-6">
                  <Link
                    href={NOTICE_LIST_HREF}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-[var(--color-border)] bg-white px-5 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-bg-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                  >
                    취소
                  </Link>
                  <button
                    type="submit"
                    disabled={!currentStore || isSubmitting}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[var(--color-primary)] px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? "등록 중..." : "직원 공지 등록"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}