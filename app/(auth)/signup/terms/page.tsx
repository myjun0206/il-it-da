"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, X } from "lucide-react";
import { Button } from "@/components/common/Button";

type TermsKey = "service" | "privacy" | "marketing" | "store_connection" | "store_work";
type Role = "hq" | "owner" | "staff";

interface Term {
  id: TermsKey;
  title: string;
  required: boolean;
}

// 공통 약관
const commonTerms: Term[] = [
  {
    id: "service",
    title: "서비스 이용약관",
    required: true,
  },
  {
    id: "privacy",
    title: "개인정보 수집 및 이용 동의",
    required: true,
  },
  {
    id: "marketing",
    title: "서비스 및 혜택 정보 수신 동의",
    required: false,
  },
];

// 점주 추가 약관
const ownerAdditionalTerms: Term[] = [
  {
    id: "store_connection",
    title: "매장 운영 및 본사 연동 동의",
    required: true,
  },
];

// 직원 추가 약관
const staffAdditionalTerms: Term[] = [
  {
    id: "store_work",
    title: "근무 매장 연결 및 업무정보 이용 동의",
    required: true,
  },
];

// role에 따라 약관 배열 생성
const getTermsByRole = (role: Role): Term[] => {
  const terms: Term[] = [commonTerms[0], commonTerms[1]]; // 필수 2개

  if (role === "owner") {
    terms.push(ownerAdditionalTerms[0]);
  } else if (role === "staff") {
    terms.push(staffAdditionalTerms[0]);
  }

  terms.push(commonTerms[2]); // 선택 약관은 마지막에
  return terms;
};

// role에 따른 초기 상태 생성
const getInitialTermsState = (role: Role): Record<TermsKey, boolean> => {
  const terms = getTermsByRole(role);
  const state: Record<TermsKey, boolean> = {
    service: false,
    privacy: false,
    marketing: false,
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
  const [mounted] = useState(() => typeof window !== 'undefined');
  
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
  const [currentTerms, setCurrentTerms] = useState<Term[]>(initialData.terms);
  const [termsAccepted, setTermsAccepted] = useState<Record<TermsKey, boolean>>(initialData.accepted);
  const [selectedTermModal, setSelectedTermModal] = useState<TermsKey | null>(null);

  if (!mounted) {
    return null;
  }

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
      const newState: Record<TermsKey, boolean> = { ...termsAccepted };
      currentTerms.forEach((term) => {
        newState[term.id] = false;
      });
      setTermsAccepted(newState);
    } else {
      // 모두 동의
      const newState: Record<TermsKey, boolean> = { ...termsAccepted };
      currentTerms.forEach((term) => {
        newState[term.id] = true;
      });
      setTermsAccepted(newState);
    }
  };

  // 필수 약관만 동의
  const handleAcceptRequired = () => {
    const newState: Record<TermsKey, boolean> = { ...termsAccepted };
    currentTerms.forEach((term) => {
      if (term.required) {
        newState[term.id] = true;
      } else {
        newState[term.id] = false;
      }
    });
    setTermsAccepted(newState);
  };

  // 개별 약관 체크 토글
  const handleTermChange = (id: TermsKey) => {
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

          {/* RIGHT: Progress */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <span className="text-base sm:text-lg lg:text-[17px] font-semibold text-[var(--color-text-secondary)]">
              {initialData.role === "hq" ? "2 / 3" : "2 / 5"}
            </span>
            {/* Progress Bar */}
            <div className="w-20 sm:w-28 h-2 bg-[var(--color-border-light)] rounded-full overflow-hidden flex-shrink-0">
              <div
                className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-300"
                style={{ width: initialData.role === "hq" ? "66%" : "40%" }}
              />
            </div>
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
          </div>

          {/* Terms Container */}
          <div className="mx-auto w-full max-w-[820px] mb-8 sm:mb-12">
            {/* Individual Terms */}
            <div className="space-y-3 mb-8 sm:mb-10">
              {currentTerms.map((term) => (
                <button
                  key={term.id}
                  onClick={() => handleTermChange(term.id)}
                  className="w-full flex items-center gap-4 p-5 sm:p-6 rounded-lg border border-[var(--color-border-light)] bg-white hover:bg-[var(--color-bg-surface)] transition-colors text-left"
                >
                  {/* Checkbox */}
                  <div
                    className={`w-6 h-6 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                      termsAccepted[term.id]
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
                        : "border-[var(--color-border)] bg-white"
                    }`}
                  >
                    {termsAccepted[term.id] && (
                      <Check size={16} className="text-white" strokeWidth={3} />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-xs sm:text-sm font-semibold px-2 py-1 rounded ${
                            term.required
                              ? "bg-[var(--color-primary)] text-white"
                              : "bg-[var(--color-border-light)] text-[var(--color-text-secondary)]"
                          }`}
                        >
                          {term.required ? "필수" : "선택"}
                        </span>
                        <span className="font-semibold text-sm sm:text-base text-[var(--color-text-primary)]">
                          {term.title}
                        </span>
                      </div>
                    </div>

                    {/* View Button */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTermModal(term.id);
                      }}
                      className="flex-shrink-0 text-xs sm:text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors whitespace-nowrap cursor-pointer"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          setSelectedTermModal(term.id);
                        }
                      }}
                    >
                      내용 보기 &gt;
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Consent Choice Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {/* Required Only Button */}
              <button
                onClick={handleAcceptRequired}
                className={`w-full flex items-center justify-center gap-3 py-4 sm:py-5 px-4 sm:px-6 rounded-lg border-2 transition-all duration-200 ${
                  !allAccepted && requiredAccepted
                    ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/30"
                    : "border-[var(--color-border-light)] bg-white hover:border-[var(--color-border)]"
                }`}
              >
                {!allAccepted && requiredAccepted && (
                  <div className="w-5 h-5 rounded-full bg-[var(--color-primary)] flex items-center justify-center flex-shrink-0">
                    <Check size={14} className="text-white" strokeWidth={3} />
                  </div>
                )}
                <span className="font-semibold text-base sm:text-lg text-[var(--color-text-primary)]">
                  필수 약관만 동의
                </span>
              </button>

              {/* All Accept Button */}
              <button
                onClick={handleAllAccept}
                className={`w-full flex items-center justify-center gap-3 py-4 sm:py-5 px-4 sm:px-6 rounded-lg border-2 transition-all duration-200 ${
                  allAccepted
                    ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/30"
                    : "border-[var(--color-border-light)] bg-white hover:border-[var(--color-border)]"
                }`}
              >
                {allAccepted && (
                  <div className="w-5 h-5 rounded-full bg-[var(--color-primary)] flex items-center justify-center flex-shrink-0">
                    <Check size={14} className="text-white" strokeWidth={3} />
                  </div>
                )}
                <span className="font-semibold text-base sm:text-lg text-[var(--color-text-primary)]">
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
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] sm:max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-[var(--color-border-light)]">
              <h2 className="font-semibold text-base sm:text-lg text-[var(--color-text-primary)]">
                {currentTerms.find((t) => t.id === selectedTermModal)?.title}
              </h2>
              <button
                onClick={() => setSelectedTermModal(null)}
                className="p-1 hover:bg-[var(--color-bg-surface)] rounded transition-colors"
              >
                <X size={24} className="text-[var(--color-text-secondary)]" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-6">
              <div className="text-sm sm:text-base text-[var(--color-text-secondary)] leading-relaxed">
                {selectedTermModal === "service" && (
                  <p>
                    이 약관은 일잇다 서비스의 이용에 관한 기본적인 사항을 정하는 약관입니다.
                    사용자는 이 약관에 동의함으로써 일잇다 서비스를 이용할 수 있습니다.
                  </p>
                )}
                {selectedTermModal === "privacy" && (
                  <p>
                    일잇다는 사용자의 개인정보를 보호하기 위해 최선을 다합니다.
                    사용자가 제공하는 개인정보는 서비스 제공 및 개선을 위해서만 사용됩니다.
                  </p>
                )}
                {selectedTermModal === "marketing" && (
                  <p>
                    선택사항입니다. 동의하시면 일잇다의 새로운 서비스, 이벤트, 혜택 정보를
                    받아보실 수 있습니다.
                  </p>
                )}
                {selectedTermModal === "store_connection" && (
                  <p>
                    점주 계정은 선택하신 매장 및 본사와 연결되며, 매장 운영에 필요한 정보가
                    본사와 연동되는 구조로 운영됩니다. 이에 동의하시면 효율적인 매장 관리
                    서비스를 이용하실 수 있습니다.
                  </p>
                )}
                {selectedTermModal === "store_work" && (
                  <p>
                    직원 계정은 선택하신 근무 매장과 연결되며, 업무 매뉴얼 및 서비스 내
                    업무정보를 이용할 수 있습니다. 이에 동의하시면 일잇다 서비스를
                    활용한 직원 업무 관리가 가능합니다.
                  </p>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-[var(--color-border-light)] px-5 sm:px-6 py-4">
              <button
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
