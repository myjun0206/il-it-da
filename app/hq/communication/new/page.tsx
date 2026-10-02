"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft } from "lucide-react";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";
import { buildHqNoticeTarget, type HqNoticeAudience } from "@/lib/notices/build-hq-notice-target";
import { createClient } from "@/lib/supabase/client";
import type { HqStoreSummary } from "@/lib/types/store";

type TargetType = "all" | "store";

const NOTICE_LIST_HREF = "/hq/communication";
const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 5000;

const fieldClass =
  "w-full rounded-lg border-2 border-[var(--color-border)] bg-white px-4 text-base text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30";

export default function NewNoticePage() {
  const router = useRouter();
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("프랜차이즈");
  const [stores, setStores] = useState<HqStoreSummary[]>([]);
  const [storesError, setStoresError] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("all");
  const [audience, setAudience] = useState<HqNoticeAudience>("all_members");
  const [targetStoreId, setTargetStoreId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadPage = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const name = data.session?.user?.user_metadata?.name;
      if (name) {
        setUserName(name);
        const firstName = name.split(" ")[0];
        if (firstName) setFranchiseName(firstName);
      }

      // 특정 지점 선택지는 서버에서 franchise 범위로 제한된 지점 목록만 사용한다.
      try {
        const response = await fetch("/api/hq/stores");
        const result = (await response.json()) as { stores?: HqStoreSummary[]; error?: string };
        if (!response.ok) throw new Error(result.error || "지점 목록을 불러오지 못했습니다.");
        setStores(result.stores ?? []);
      } catch (error) {
        setStoresError(error instanceof Error ? error.message : "지점 목록을 불러오지 못했습니다.");
      }
    };

    void loadPage();
  }, []);

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      router.push("/");
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (targetType === "store" && !targetStoreId) {
      setErrorMessage("공지를 받을 지점을 선택해주세요.");
      return;
    }
    if (!trimmedTitle) {
      setErrorMessage("제목을 입력해주세요.");
      return;
    }
    if (!trimmedContent) {
      setErrorMessage("내용을 입력해주세요.");
      return;
    }

    setErrorMessage("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/hq/notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildHqNoticeTarget(targetType, targetStoreId, audience),
          title: trimmedTitle,
          content: trimmedContent,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || "공지를 등록하지 못했습니다.");
      }
      router.push(NOTICE_LIST_HREF);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "공지를 등록하지 못했습니다.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <HQSidebar
        userName={userName}
        franchiseName={franchiseName}
        onLogout={handleLogout}
        activeMenu="notice"
      />

      <div className="lg:ml-[240px]">
        <HQHeader userName={userName} franchiseName={franchiseName} onLogout={handleLogout} />

        <main className="p-6 lg:p-8 max-w-7xl mx-auto">
          <Link
            href={NOTICE_LIST_HREF}
            aria-label="공지사항 목록으로 돌아가기"
            className="-ml-3 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-light)]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            공지사항
          </Link>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">새 공지 작성</h1>
            <p className="text-base text-[var(--color-text-secondary)]">지점과 점주에게 전달할 공지를 작성합니다.</p>
          </div>

          <form
            onSubmit={handleSubmit}
            noValidate
            className="w-full bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm lg:p-8"
          >
            <fieldset>
              <legend className="mb-2.5 text-sm font-semibold text-[var(--color-text-primary)]">
                공지 대상 <span className="text-red-700" aria-hidden="true">*</span>
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(
                  [
                    { value: "all", label: "전체 지점", description: "모든 지점에 전달합니다." },
                    { value: "store", label: "특정 지점", description: "선택한 지점에만 전달합니다." },
                  ] as { value: TargetType; label: string; description: string }[]
                ).map((option) => {
                  const isSelected = targetType === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-primary)] has-[:focus-visible]:ring-offset-2 ${
                        isSelected
                          ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/30"
                          : "border-[var(--color-border)] bg-white hover:border-[var(--color-primary)]/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="targetType"
                        value={option.value}
                        checked={isSelected}
                        onChange={() => setTargetType(option.value)}
                        className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                      />
                      <span>
                        <span
                          className={`block text-base font-semibold ${
                            isSelected ? "text-[var(--color-primary)]" : "text-[var(--color-text-primary)]"
                          }`}
                        >
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-sm text-[var(--color-text-secondary)]">{option.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>

              {targetType === "store" && (
                <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-default)] p-4">
                  <label htmlFor="notice-store" className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
                    지점 선택 <span className="text-red-700" aria-hidden="true">*</span>
                  </label>
                  {storesError ? (
                    <p className="text-sm text-red-700" role="alert">{storesError}</p>
                  ) : stores.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-secondary)]">선택할 수 있는 지점이 없습니다.</p>
                  ) : (
                    <select
                      id="notice-store"
                      value={targetStoreId}
                      onChange={(event) => setTargetStoreId(event.target.value)}
                      className={`${fieldClass} h-11`}
                    >
                      <option value="">지점을 선택해주세요</option>
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </fieldset>

            <fieldset className="mt-6">
              <legend className="mb-2.5 text-sm font-semibold text-[var(--color-text-primary)]">
                수신 대상 <span className="text-red-700" aria-hidden="true">*</span>
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(
                  [
                    { value: "owner", label: "점주만", description: "승인된 점주에게만 전달합니다." },
                    { value: "all_members", label: "점주 + 직원", description: "승인된 점주와 직원에게 전달합니다." },
                  ] as { value: HqNoticeAudience; label: string; description: string }[]
                ).map((option) => {
                  const isSelected = audience === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-primary)] has-[:focus-visible]:ring-offset-2 ${
                        isSelected
                          ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/30"
                          : "border-[var(--color-border)] bg-white hover:border-[var(--color-primary)]/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="audience"
                        value={option.value}
                        checked={isSelected}
                        onChange={() => setAudience(option.value)}
                        className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                      />
                      <span>
                        <span
                          className={`block text-base font-semibold ${
                            isSelected ? "text-[var(--color-primary)]" : "text-[var(--color-text-primary)]"
                          }`}
                        >
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-sm text-[var(--color-text-secondary)]">
                          {option.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-8">
              <label htmlFor="notice-title" className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
                제목 <span className="text-red-700" aria-hidden="true">*</span>
              </label>
              <input
                id="notice-title"
                type="text"
                value={title}
                maxLength={TITLE_MAX_LENGTH}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="공지 제목을 입력해주세요."
                aria-required="true"
                className={`${fieldClass} h-11`}
              />
              <p className="mt-1 text-right text-sm text-[var(--color-text-tertiary)]">
                {title.length} / {TITLE_MAX_LENGTH}
              </p>
            </div>

            <div className="mt-4">
              <label htmlFor="notice-content" className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">
                내용 <span className="text-red-700" aria-hidden="true">*</span>
              </label>
              <textarea
                id="notice-content"
                value={content}
                maxLength={CONTENT_MAX_LENGTH}
                onChange={(event) => setContent(event.target.value)}
                placeholder="공지 내용을 입력해주세요."
                aria-required="true"
                className={`${fieldClass} h-60 resize-y py-3 leading-6`}
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
                disabled={isSubmitting}
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[var(--color-primary)] px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "등록 중..." : "공지 등록"}
              </button>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}
