"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { SIGNUP_DOCUMENTS, type SignupConsentKey, type SignupDocumentKey } from "@/lib/auth/signup-terms-content";

type Role = "hq" | "owner" | "staff";

interface Term {
  id: SignupConsentKey;
  title: string;
  required: boolean;
}

const commonTerms: Term[] = [
  { id: "service", title: SIGNUP_DOCUMENTS.service.title, required: true },
  { id: "privacy", title: SIGNUP_DOCUMENTS.privacy.title, required: true },
];

const ownerAdditionalTerms: Term[] = [
  { id: "store_connection", title: SIGNUP_DOCUMENTS.store_connection.title, required: true },
];

const staffAdditionalTerms: Term[] = [
  { id: "store_work", title: SIGNUP_DOCUMENTS.store_work.title, required: true },
];

const getTermsByRole = (role: Role): Term[] => {
  const terms: Term[] = [...commonTerms];

  if (role === "owner") {
    terms.push(ownerAdditionalTerms[0]);
  } else if (role === "staff") {
    terms.push(staffAdditionalTerms[0]);
  }

  return terms;
};

const getInitialTermsState = (role: Role): Record<SignupConsentKey, boolean> => {
  const terms = getTermsByRole(role);
  const state: Record<SignupConsentKey, boolean> = {
    service: false,
    privacy: false,
    store_connection: false,
    store_work: false,
  };

  terms.forEach((term) => {
    state[term.id] = false;
  });

  return state;
};

export default function SignupTermsPage() {
  const router = useRouter();
  
  // Initialize terms based on role from sessionStorage
  const getInitialTermsData = () => {
    if (typeof window === 'undefined') {
      return { role: "hq" as Role, terms: getTermsByRole("hq"), accepted: getInitialTermsState("hq") };
    }
    const storedRole = sessionStorage.getItem("signupRole") as Role | null;
    if (storedRole && ["hq", "owner", "staff"].includes(storedRole)) {
      return { role: storedRole, terms: getTermsByRole(storedRole), accepted: getInitialTermsState(storedRole) };
    }
    return { role: "hq" as Role, terms: getTermsByRole("hq"), accepted: getInitialTermsState("hq") };
  };

  const initialData = getInitialTermsData();
  const [currentTerms] = useState<Term[]>(initialData.terms);
  const [termsAccepted, setTermsAccepted] = useState<Record<SignupConsentKey, boolean>>(initialData.accepted);
  const [selectedTermModal, setSelectedTermModal] = useState<SignupDocumentKey | null>(null);
  const closeDocumentButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!selectedTermModal) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeDocumentButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedTermModal(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [selectedTermModal]);

  // 동적으로 required 약관이 모두 동의되었는지 확인
  const requiredAccepted = currentTerms
    .filter((term) => term.required)
    .every((term) => termsAccepted[term.id]);

  // 모든 약관이 동의되었는지 확인
  const allAccepted = currentTerms.every((term) => termsAccepted[term.id]);

  // 전체 동의 토글
  const handleAllAccept = () => {
    if (allAccepted) {
      // 모두 해제
      const newState: Record<SignupConsentKey, boolean> = { ...termsAccepted };
      currentTerms.forEach((term) => {
        newState[term.id] = false;
      });
      setTermsAccepted(newState);
    } else {
      // 모두 동의
      const newState: Record<SignupConsentKey, boolean> = { ...termsAccepted };
      currentTerms.forEach((term) => {
        newState[term.id] = true;
      });
      setTermsAccepted(newState);
    }
  };

  // 개별 약관 체크 토글
  const handleTermChange = (id: SignupConsentKey) => {
    setTermsAccepted((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleNext = () => {
    if (requiredAccepted) {
      sessionStorage.setItem("signupTerms", JSON.stringify(termsAccepted));
      router.push("/signup/profile");
    }
  };

  const handlePrevious = () => {
    router.push("/signup/role");
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      {/* Header */}
      <header className="relative border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
        <div className="flex items-center justify-between px-5 sm:px-8 lg:px-12 xl:px-16 h-16 lg:h-[68px]">
          {/* LEFT: Back Link */}
          <button
            onClick={handlePrevious}
            className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors flex-shrink-0 bg-none border-none cursor-pointer"
          >
            <ChevronLeft size={24} className="flex-shrink-0" />
            <span className="text-base sm:text-lg lg:text-[17px] font-semibold hidden sm:inline">이전</span>
            <span className="text-base font-semibold sm:hidden">이전</span>
          </button>

          {/* CENTER: Logo (Absolute Centered) - Wordmark */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex-shrink-0">
            <img
              src="/logo/ilitda-wordmark.png"
              alt="일잇다"
              className="w-[76px] sm:w-[88px] lg:w-[100px] h-auto object-contain"
            />
          </div>

        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center py-12 sm:py-16 lg:py-20 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-6xl">
          {/* Title Section */}
          <div className="mb-8 sm:mb-12 lg:mb-16 text-center">
            <h1
              className="mb-4 sm:mb-5 lg:mb-6 font-bold text-[var(--color-text-primary)]"
              style={{
                fontSize: "clamp(32px, 2.5vw, 42px)",
                fontWeight: 800,
              }}
            >
              서비스 이용을 위해 약관에 동의해주세요
            </h1>
            <p
              className="text-[var(--color-text-secondary)]"
              style={{
                fontSize: "clamp(16px, 1.2vw, 20px)",
              }}
            >
              필수 약관을 확인하고 동의해주세요.
            </p>
            <p role="status" className="mx-auto mt-5 max-w-[820px] rounded border border-[#f59e0b] bg-[#fffbeb] px-4 py-3 text-left text-sm text-[#713f12] dark:border-[#a16207] dark:bg-[#332b18] dark:text-[#fde68a]">
              아래 약관과 개인정보 문서는 운영 검토 초안입니다. 운영주체, 시행일, 문의처, 보유기간과 외부 처리 조건을 확정하고 법률 검토를 마친 뒤 공개해야 합니다.
            </p>
          </div>

          {/* Terms Container */}
          <div className="mx-auto w-full max-w-[820px] mb-8 sm:mb-12">
            {/* Individual Terms */}
            <div className="space-y-3 mb-8 sm:mb-10">
              {currentTerms.map((term) => (
                <div key={term.id} className="flex w-full items-center gap-3 rounded border border-[var(--color-border-light)] bg-white p-4 sm:p-5">
                  <button
                    type="button"
                    aria-pressed={termsAccepted[term.id]}
                    aria-label={`${term.required ? "필수" : "선택"} ${term.title} 동의`}
                    onClick={() => handleTermChange(term.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border-2 ${termsAccepted[term.id] ? "border-[var(--color-primary)] bg-[var(--color-primary)]" : "border-[var(--color-border)] bg-white"}`}>
                      {termsAccepted[term.id] && <Check size={16} className="text-white dark:text-[var(--color-text-inverse)]" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="mb-1 inline-block rounded bg-[var(--color-primary)] px-2 py-1 text-xs font-semibold text-white">필수</span>
                      <span className="block break-words font-semibold text-sm sm:text-base text-[var(--color-text-primary)]">{term.title}</span>
                    </span>
                  </button>
                  <button type="button" aria-label={`${term.title} 전문 보기`} onClick={() => setSelectedTermModal(term.id)} className="flex-shrink-0 rounded px-2 py-2 text-sm text-[var(--color-text-secondary)] underline underline-offset-2 hover:text-[var(--color-text-primary)]">
                    전문 보기
                  </button>
                </div>
              ))}

              <div className="flex w-full items-center justify-between gap-3 rounded border border-[var(--color-border-light)] bg-white p-4 sm:p-5">
                <div className="min-w-0">
                  <span className="mb-1 inline-block rounded bg-[var(--color-border-light)] px-2 py-1 text-xs font-semibold text-[var(--color-text-secondary)]">안내</span>
                  <span className="block break-words font-semibold text-sm sm:text-base text-[var(--color-text-primary)]">{SIGNUP_DOCUMENTS.privacy_policy.title}</span>
                  <span className="mt-1 block text-sm text-[var(--color-text-secondary)]">별도 동의 항목이 아닌 개인정보 처리 안내입니다.</span>
                </div>
                <button type="button" aria-label={`${SIGNUP_DOCUMENTS.privacy_policy.title} 전문 보기`} onClick={() => setSelectedTermModal("privacy_policy")} className="flex-shrink-0 rounded px-2 py-2 text-sm text-[var(--color-text-secondary)] underline underline-offset-2 hover:text-[var(--color-text-primary)]">
                  전문 보기
                </button>
              </div>
            </div>

            {/* Consent Choice Buttons */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleAllAccept}
                className={`w-full sm:w-auto flex items-center justify-center gap-3 py-4 px-5 rounded border-2 transition-all duration-200 ${
                  allAccepted
                    ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/30"
                    : "border-[var(--color-border-light)] bg-white hover:border-[var(--color-border)]"
                }`}
              >
                {allAccepted && (
                  <div className="w-5 h-5 rounded-full bg-[var(--color-primary)] flex items-center justify-center flex-shrink-0">
                    <Check size={14} className="text-white dark:text-[var(--color-text-inverse)]" strokeWidth={3} />
                  </div>
                )}
                <span className="font-semibold text-base text-[var(--color-text-primary)]">
                  전체 동의
                </span>
              </button>
            </div>
          </div>

          {/* Next Button */}
          <div className="flex justify-center">
            <Button
              onClick={handleNext}
              disabled={!requiredAccepted}
              variant="primary"
              size="lg"
              className="w-full sm:w-auto min-h-14 lg:min-h-16 px-8 lg:px-12 text-lg lg:text-xl font-semibold"
            >
              다음
            </Button>
          </div>
        </div>
      </div>

      {/* Terms Detail Modal */}
      {selectedTermModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="signup-document-title"
          onClick={(event) => { if (event.target === event.currentTarget) setSelectedTermModal(null); }}
        >
          <div className="flex max-h-[90vh] max-h-[90dvh] w-full flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] sm:max-h-[80vh] sm:max-w-2xl sm:rounded-lg">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-[var(--color-border-light)]">
              <h2 id="signup-document-title" className="min-w-0 break-words font-semibold text-base sm:text-lg text-[var(--color-text-primary)]">
                {SIGNUP_DOCUMENTS[selectedTermModal].title}
              </h2>
              <button
                type="button"
                ref={closeDocumentButtonRef}
                aria-label="전문 닫기"
                onClick={() => setSelectedTermModal(null)}
                className="p-1 hover:bg-[var(--color-bg-surface)] rounded transition-colors"
              >
                <X size={24} className="text-[var(--color-text-secondary)]" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-6">
              <div className="space-y-6 text-sm leading-relaxed text-[var(--color-text-secondary)] sm:text-base">
                {SIGNUP_DOCUMENTS[selectedTermModal].sections.map((section) => (
                  <section key={section.heading}>
                    <h3 className="mb-2 font-semibold text-[var(--color-text-primary)]">{section.heading}</h3>
                    <p className="whitespace-pre-line">{section.body}</p>
                  </section>
                ))}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-[var(--color-border-light)] px-5 sm:px-6 py-4">
              <button
                type="button"
                onClick={() => setSelectedTermModal(null)}
                className="w-full py-3 bg-[var(--color-primary)] text-white rounded-lg font-semibold hover:bg-[var(--color-primary-hover)] transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
